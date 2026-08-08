/**
 * Monad Portability Checker — v2 (Pure AST/regex, zero SolCMC dependency)
 *
 * SCOPE DECISION (per hackathon prioritization):
 * This is now explicitly split into two tiers:
 *
 * 1. ANCHOR checks (6 total) — the deterministic, docs-backed core that
 *    can't be argued with on stage. These are the ONLY categories that
 *    count toward `checks.total/passed/failed` and the ONLY ones that
 *    can produce an ERROR (blocking) severity:
 *      - CODE_SIZE            (128 KB limit, official Monad docs)
 *      - HARDCODED_GAS
 *      - GAS_REFUND
 *      - GAS_REIMBURSEMENT
 *      - CREATE2_EIP7702
 *      - BLOB_TX
 *
 * 2. EXTRA checks (informational only) — DELEGATECALL, GAS_OPCODES,
 *    SELFDESTRUCT. These still run and still surface in `issues[]`, but:
 *      - always capped at severity INFO (never ERROR/WARNING)
 *      - marked `isAnchor: false`
 *      - excluded from `checks.total/passed/failed`
 *      - never influence verdict on their own
 *    They're kept because they're genuinely useful context, but they are
 *    NOT part of the "Monad readiness" claim — no debate surface there.
 *
 * No SolCMC, no solver, no compile step. Pure string/AST pattern
 * matching against source text. Deterministic: same input always
 * produces the same output. Fast: no external process spawned.
 */
import type { ContractSummary } from "../types/index.js";
export interface PortabilityIssue {
    severity: "ERROR" | "WARNING" | "INFO";
    category: "HARDCODED_GAS" | "GAS_REFUND" | "GAS_REIMBURSEMENT" | "CREATE2_EIP7702" | "BLOB_TX" | "CODE_SIZE" | "GAS_OPCODES" | "DELEGATECALL" | "SELFDESTRUCT";
    isAnchor: boolean;
    line?: number;
    column?: number;
    code: string;
    message: string;
    recommendation: string;
}
export interface MonadCompatibilityReport {
    contractName: string;
    fileName: string;
    codeSize: number;
    issues: PortabilityIssue[];
    checks: {
        total: number;
        passed: number;
        failed: number;
    };
    summary: {
        errors: number;
        warnings: number;
        infos: number;
    };
}
/**
 * Check contract for Monad compatibility issues.
 * Pure AST/regex pass over source text — no SolCMC, no solver.
 */
export declare function checkMonadCompatibility(contract: ContractSummary): MonadCompatibilityReport;
/**
 * Format report for display (CLI / debug use)
 */
export declare function formatMonadCompatibilityReport(report: MonadCompatibilityReport): string;
//# sourceMappingURL=monadChecker.d.ts.map