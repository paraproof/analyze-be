import fs from "fs";
import path from "path";
import { parseSolidityFiles } from "../verify/parser.js";
import { generateAndValidateInstrumentation } from "./orchestrator.js";
import { explainSolCMCFailure } from "../verify/ai.js";
// In memory database map
const jobStore = new Map();
// Menyimpan source files asli untuk fase /deploy nanti — PENTING: yang
// disimpen di sini SOURCE ASLI (bukan instrumented), karena yang di-deploy
// ke Monad harus kontrak asli tanpa assert() tambahan (overhead gas,
// nggak perlu ada di production).
const jobFilesStore = new Map();
export function createJob(request) {
    const jobId = `verify_${Math.random().toString(36).substring(2, 10)}`;
    const createdAt = new Date().toISOString();
    const initialSteps = [
        { step: "AST_EXTRACTION", status: "PENDING" },
        { step: "SPEC_GENERATION", status: "PENDING" },
        { step: "COMPILE_CHECK", status: "PENDING" },
        { step: "SOLCMC_VERIFICATION", status: "PENDING" },
    ];
    const jobData = {
        job_id: jobId,
        status: "PENDING",
        created_at: createdAt,
        entry_point: request.entry_point,
        steps: initialSteps,
    };
    jobStore.set(jobId, jobData);
    jobFilesStore.set(jobId, request);
    runVerificationTask(jobId, request).catch((err) => {
        console.error(`[Job Error] Unhandled exception on job ${jobId}:`, err);
    });
    return { jobId, createdAt };
}
export function getJob(jobId) {
    return jobStore.get(jobId);
}
export function getJobFiles(jobId) {
    return jobFilesStore.get(jobId);
}
function updateStepStatus(jobId, stepName, status) {
    const job = jobStore.get(jobId);
    if (!job || !job.steps)
        return;
    const step = job.steps.find((s) => s.step === stepName);
    if (step)
        step.status = status;
}
/**
 * Worker Asinkron: AST -> claude (generate assert JSON, POSISI splice tetap
 * deterministic) -> instrumented source -> SolCMC (solc model-checker)
 *
 * PERUBAHAN UTAMA dari versi Certora:
 * - Nggak ada spec file terpisah (.spec / t.sol) — assert() di-splice
 *   LANGSUNG ke source asli, dianalisis solc via flag --model-checker-*.
 * - Reentrancy nggak butuh setup summary tambahan (beda dari Certora yang
 *   defaultnya asumsi non-reentrant) — SolCMC otomatis explore reentrant
 *   call scenario by default.
 * - Retry loop SEKARANG genuinely berguna lagi (beda dari versi rule-based
 *   CVL) — claude generate ulang assertion, BUKAN cuma retry compile doang.
 *   Retry loop-nya sekarang nyakup 3 lapis: identifier validity (heuristik,
 *   gratis) -> syntax validity (re-parse, gratis) -> real compile-check
 *   (solc model-checker, MAHAL/lambat) — dikelola di orchestrator.ts.
 */
async function runVerificationTask(jobId, request) {
    const startTime = Date.now();
    const job = jobStore.get(jobId);
    job.status = "RUNNING";
    const jobDir = path.join(process.cwd(), "tmp", "jobs", jobId);
    try {
        // --------------------------------------------------------
        // STEP 1: AST Extraction
        // --------------------------------------------------------
        updateStepStatus(jobId, "AST_EXTRACTION", "RUNNING");
        fs.mkdirSync(path.join(jobDir, "src"), { recursive: true });
        for (const [relativePath, content] of Object.entries(request.files)) {
            const fullPath = path.join(jobDir, relativePath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content);
        }
        const astSummaries = parseSolidityFiles(request.files);
        if (!astSummaries.length) {
            throw {
                code: "COMPILE_FAILED",
                message: "Failed to parse contract definition from source code.",
            };
        }
        console.warn("AST Summaries:", astSummaries);
        const mainContract = astSummaries.find((c) => c.fileName === request.entry_point) ??
            astSummaries[0];
        updateStepStatus(jobId, "AST_EXTRACTION", "DONE");
        // --------------------------------------------------------
        // STEP 2: Spec Generation — claude generate assertion JSON, splice
        // deterministic, validasi berlapis (identifier -> syntax -> real
        // compile-check), retry otomatis di dalam orchestrator kalau gagal.
        // --------------------------------------------------------
        updateStepStatus(jobId, "SPEC_GENERATION", "RUNNING");
        updateStepStatus(jobId, "COMPILE_CHECK", "RUNNING");
        let instrumentResult;
        try {
            instrumentResult = await generateAndValidateInstrumentation(mainContract, 2, // maxRetries — sengaja nggak gede, tiap retry = 1x call claude + 1x run solc (bisa puluhan detik)
            async (instrumentedSource) => {
                const check = await runSolCMC(jobDir, mainContract.fileName, mainContract.contractName, instrumentedSource);
                return { valid: !check.buildFailed, error: check.buildErrorMessage };
            });
        }
        catch (err) {
            throw {
                code: "SPEC_GENERATION_FAILED",
                message: `Gagal generate instrumentasi SolCMC yang valid: ${err.message}`,
            };
        }
        if (instrumentResult.warnings.length > 0) {
            console.warn(`[Instrumentation Warnings] ${mainContract.contractName}:\n` +
                instrumentResult.warnings.map((w) => `  - ${w}`).join("\n"));
        }
        updateStepStatus(jobId, "SPEC_GENERATION", "DONE");
        updateStepStatus(jobId, "COMPILE_CHECK", "DONE");
        console.warn(`Instrumented source (${instrumentResult.attempts} attempt, ${instrumentResult.injectedAssertCount} assert) buat ${mainContract.contractName}:\n${instrumentResult.instrumentedSource}`);
        // --------------------------------------------------------
        // STEP 3: SolCMC Verification — jalanin SEKALI LAGI buat ambil hasil
        // final (compile-check di atas udah mastiin ini bakal sukses, tapi
        // kita butuh invariants/rawLogs-nya, bukan cuma boolean valid/invalid).
        // --------------------------------------------------------
        updateStepStatus(jobId, "SOLCMC_VERIFICATION", "RUNNING");
        const solcmcResult = await runSolCMC(jobDir, mainContract.fileName, mainContract.contractName, instrumentResult.instrumentedSource);
        if (solcmcResult.buildFailed) {
            // Harusnya nggak kejadian (compile-check di orchestrator udah lolos),
            // tapi jaga-jaga kalau ada flakiness/non-determinism di solc sendiri.
            throw {
                code: "SPEC_GENERATION_FAILED",
                message: `SolCMC gagal compile di run final, padahal udah lolos compile-check pas instrumentasi. Kemungkinan flakiness solc.\n\n${solcmcResult.buildErrorMessage}`,
            };
        }
        updateStepStatus(jobId, "SOLCMC_VERIFICATION", "DONE");
        // --------------------------------------------------------
        // STEP 4: Finalize Status
        // --------------------------------------------------------
        const endTime = Date.now();
        const durationMs = endTime - startTime;
        job.status = solcmcResult.passed ? "PASSED" : "FAILED";
        job.completed_at = new Date().toISOString();
        job.duration_ms = durationMs;
        job.invariants_checked = solcmcResult.invariants;
        job.raw_logs = solcmcResult.rawLogs;
        if (!solcmcResult.passed) {
            const mainFileContent = request.files[request.entry_point] || "";
            // FIX: sebelumnya manggil explainSolCMCFailure() SEKALI buat seluruh
            // job, terus nge-apply hasil yang SAMA ke SEMUA entry FAILED. Kalau
            // ada >1 temuan yang genuinely BEDA (misal Overflow di deposit() vs
            // Assertion violation di withdraw()), keduanya dapet explanation
            // yang identik — salah satunya pasti nggak relevan/menyesatkan.
            //
            // Sekarang panggil TERPISAH per entry FAILED, dikasih konteks
            // SPESIFIK (detail + lokasi) biar explanation-nya nyambung ke
            // masalah itu doang, bukan masalah lain yang kebetulan juga FAILED.
            const failedEntries = job.invariants_checked.filter((inv) => inv.result === "FAILED");
            const explanationByDetail = new Map();
            for (const inv of failedEntries) {
                if (explanationByDetail.has(inv.detail || ""))
                    continue; // dedupe kalau ada detail identik
                const explanation = await explainSolCMCFailure(mainFileContent, instrumentResult.instrumentedSource, { location: inv.function, message: inv.detail || "" });
                explanationByDetail.set(inv.detail || "", explanation);
            }
            job.invariants_checked = job.invariants_checked.map((inv) => inv.result === "FAILED"
                ? { ...inv, explanation: explanationByDetail.get(inv.detail || "") }
                : inv);
        }
        else {
            // instrumented_source disimpen buat referensi/audit — BUKAN yang
            // di-deploy (yang di-deploy tetep source asli dari jobFilesStore).
            job.spec = instrumentResult.instrumentedSource;
        }
    }
    catch (err) {
        const endTime = Date.now();
        job.status = "ERROR";
        job.completed_at = new Date().toISOString();
        job.duration_ms = endTime - startTime;
        job.error = {
            code: err.code || "INTERNAL_ERROR",
            message: err.message ||
                "An unexpected internal error occurred during verification.",
        };
    }
}
//# sourceMappingURL=jobStore.js.map