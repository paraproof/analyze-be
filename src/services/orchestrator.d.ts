import type { ContractSummary } from "../types/index.js";
import { type InjectedLineRange } from "../verify/instrumenter.js";
export interface OrchestrationResult {
    instrumentedSource: string;
    warnings: string[];
    injectedAssertCount: number;
    attempts: number;
    injectedLineRanges: InjectedLineRange[];
}
export type CompileCheckFn = (instrumentedSource: string) => Promise<{
    valid: boolean;
    error?: string;
}>;
export declare function generateAndValidateInstrumentation(contract: ContractSummary, maxRetries?: number, compileCheck?: CompileCheckFn): Promise<OrchestrationResult>;
//# sourceMappingURL=orchestrator.d.ts.map