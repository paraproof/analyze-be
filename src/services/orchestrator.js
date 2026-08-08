import { generateSolCMCAssertions, regenerateSolCMCAssertionsWithFeedback, } from "../verify/ai.js";
import { validateAssertions, spliceAssertions, checkSyntaxValid, } from "../verify/instrumenter.js";
export async function generateAndValidateInstrumentation(contract, maxRetries = 2, compileCheck) {
    let lastRaw = "";
    let lastError = "";
    let assertions = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            assertions =
                attempt === 0
                    ? await generateSolCMCAssertions(contract)
                    : await regenerateSolCMCAssertionsWithFeedback(contract, lastRaw, lastError);
        }
        catch (err) {
            lastError = `Gagal generate/parse JSON dari Groq: ${err.message}`;
            lastRaw = err.message || "";
            continue;
        }
        lastRaw = JSON.stringify(assertions);
        const identifierProblems = validateAssertions(contract, assertions);
        if (identifierProblems.length > 0) {
            lastError = `Identifier problems:\n${identifierProblems.join("\n")}`;
            console.warn(`[Attempt ${attempt + 1}/${maxRetries + 1}] Identifier problems:\n${lastError}`);
            continue;
        }
        const { instrumentedSource, warnings, injectedAssertCount, injectedLineRanges, } = spliceAssertions(contract, assertions);
        if (injectedAssertCount === 0) {
            lastError =
                "Groq nggak generate assert apapun — coba lagi atau terima hasil kosong.";
            console.warn(`[Attempt ${attempt + 1}/${maxRetries + 1}] ${lastError}`);
            if (attempt === maxRetries) {
                return {
                    instrumentedSource,
                    warnings,
                    injectedAssertCount: 0,
                    attempts: attempt + 1,
                    injectedLineRanges,
                };
            }
            continue;
        }
        const syntaxCheck = checkSyntaxValid(instrumentedSource);
        if (!syntaxCheck.valid) {
            lastError = `Syntax error setelah splice: ${syntaxCheck.error}`;
            console.warn(`[Attempt ${attempt + 1}/${maxRetries + 1}] ${lastError}`);
            continue;
        }
        // Real compile-check (solc model-checker) — kalau disediakan, IKUT
        // jadi bagian retry loop. Ini yang beda dari versi rule-based:
        // kegagalan di sini genuinely bisa diperbaiki dengan regenerate.
        if (compileCheck) {
            const result = await compileCheck(instrumentedSource);
            if (!result.valid) {
                lastError = `solc model-checker gagal compile:\n${result.error}`;
                console.warn(`[Attempt ${attempt + 1}/${maxRetries + 1}] ${lastError}`);
                continue;
            }
        }
        console.log(`✅ Instrumentasi berhasil (attempt ${attempt + 1}/${maxRetries + 1}), ${injectedAssertCount} assert ter-generate`);
        return {
            instrumentedSource,
            warnings,
            injectedAssertCount,
            attempts: attempt + 1,
            injectedLineRanges,
        };
    }
    throw new Error(`Gagal generate instrumentasi valid setelah ${maxRetries + 1} percobaan.\nError terakhir: ${lastError}`);
}
//# sourceMappingURL=orchestrator.js.map