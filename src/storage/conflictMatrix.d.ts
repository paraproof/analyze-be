/**
 * Conflict Matrix Builder - UPDATED
 *
 * Fixed to work with storageLayout_FIXED.ts
 *
 * Changes:
 * - resolveWriteSlot → resolveAccessSlot
 * - detectConflict now takes AccessPath objects
 * - Tracks read vs write separately
 *
 * Detect storage conflicts antar functions:
 * - DEFINITE: functions pasti bentrok di storage (same exact slot)
 * - SYMBOLIC: mungkin bentrok (dynamic slots, depends on runtime values)
 * - SAFE: pasti tidak bentrok (different slots)
 */
import type { ContractSummary, FunctionSummary } from "../types/index.js";
import { type StorageSlot, type AccessPath } from "./storageLayout.js";
export interface ConflictMatrixCell {
    function1: string;
    function2: string;
    accesses1: AccessPath[];
    accesses2: AccessPath[];
    conflicts: Array<{
        slot1: string;
        slot2: string;
        accessType1: "read" | "write";
        accessType2: "read" | "write";
        severity: "DEFINITE" | "SYMBOLIC" | "SAFE";
        reason: string;
    }>;
    overallSeverity: "DEFINITE" | "SYMBOLIC" | "SAFE";
}
export interface ConflictMatrix {
    contractName: string;
    functions: FunctionSummary[];
    storageLayout: StorageSlot[];
    matrix: ConflictMatrixCell[];
    summary: {
        definiteConflicts: number;
        symbolicConflicts: number;
        safeConflicts: number;
    };
}
/**
 * Build conflict matrix untuk sebuah contract.
 *
 * Algorithm:
 * 1. Compute storage layout dari state variables
 * 2. Untuk setiap pair fungsi (F1, F2):
 *    a. Resolve access paths untuk F1 (reads + writes)
 *    b. Resolve access paths untuk F2 (reads + writes)
 *    c. Cross-check setiap access F1 vs setiap access F2
 *    d. Collect conflicts + determine overall severity
 */
export declare function buildConflictMatrix(contract: ContractSummary): ConflictMatrix;
/**
 * Format conflict matrix sebagai ASCII table (untuk CLI/report)
 */
export declare function formatConflictMatrixTable(conflictMatrix: ConflictMatrix): string;
/**
 * Format conflict matrix dengan detail (untuk report)
 */
export declare function formatConflictMatrixDetailed(conflictMatrix: ConflictMatrix): string;
/**
 * Analyze parallel execution risk: given N concurrent invocations,
 * berapa banyak yang akan abort (karena conflict).
 *
 * Simplified heuristic:
 * - Same function called N times: bentrok DEFINITE jika write ke state
 *   yang sama (worst: semua abort except 1)
 * - Different functions: DEFINITE = abort, SYMBOLIC = maybe abort
 */
export declare function analyzeParallelRisk(conflictMatrix: ConflictMatrix, concurrentCalls: Array<{
    function: string;
    count: number;
}>): {
    riskLevel: "HIGH" | "MEDIUM" | "LOW";
    analysis: string;
    estimatedAbortRate?: string;
};
//# sourceMappingURL=conflictMatrix.d.ts.map