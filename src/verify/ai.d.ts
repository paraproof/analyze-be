import type { ContractSummary } from "../types/index.js";
interface AssertionSet {
    before: string[];
    asserts: string[];
    beforeExternalCall: string[];
}
export interface GeneratedAssertions {
    functions: Record<string, AssertionSet>;
}
/**
 * Generate assertions pertama kali (single-shot).
 */
export declare function generateSolCMCAssertions(contract: ContractSummary): Promise<GeneratedAssertions>;
/**
 * Retry generate assertions dengan feedback error.
 */
export declare function regenerateSolCMCAssertionsWithFeedback(contract: ContractSummary, previousRaw: string, errorFeedback: string): Promise<GeneratedAssertions>;
/**
 * Menerjemahkan hasil counterexample SolCMC ke penjelasan manusia.
 */
export declare function explainSolCMCFailure(contractCode: string, instrumentedCode: string, specificTarget: {
    location: string;
    message: string;
}): Promise<string>;
export {};
//# sourceMappingURL=ai.d.ts.map