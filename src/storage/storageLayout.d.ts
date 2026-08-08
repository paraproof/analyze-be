/**
 * Solidity Storage Layout Resolver - FIXED v2
 *
 * CRITICAL FIX: Mapping detection order
 * - Check isMapping BEFORE early return on empty keys
 * - This handles cases where parser doesn't extract key expression
 *
 * IMPROVEMENTS:
 * 1. Mapping keys are COMPARED - different keys = SAFE (not conflict)
 * 2. Read vs Write tracking - read+read is always SAFE
 * 3. Three-state conflict: DEFINITE | SYMBOLIC | SAFE
 * 4. Symbolic notation INCLUDES key info for diagnostics
 *
 * REWRITTEN: Feb 2025 - handles mapping collisions correctly
 */
import type { StateVariableSummary } from "../types/index.js";
export interface StorageSlot {
    variable: string;
    slotNumber: number;
    offset: number;
    size: number;
    type: string;
    isMapping: boolean;
    isArray: boolean;
    isConstant: boolean;
}
/**
 * Access path represents ONE read or write operation
 * KEY CHANGE: includes accessType (read vs write) and keys
 */
export interface AccessPath {
    variable: string;
    accessType: "read" | "write";
    keys: string[];
    slot: StorageSlot;
    computedSlot: string;
}
/**
 * Compute storage slots untuk state variables
 * Ikuti Solidity packing: pack variables ke dalam 32-byte slots,
 * tapi dynamic types (mapping, array) occupy slot sendiri
 */
export declare function computeStorageLayout(stateVariables: StateVariableSummary[]): StorageSlot[];
export declare function resolveAccessSlot(access: {
    variable: string;
    keys: string[];
    operation: string;
}, slots: StorageSlot[]): AccessPath & {
    computedSlot: string;
};
/**
 * Detect conflict between two access paths
 *
 * RULES:
 * 1. read + read = SAFE (always)
 * 2. Different base slots = SAFE
 * 3. Same slot, different literal keys = SAFE
 * 4. Same slot, same literal key = DEFINITE (if any write)
 * 5. Same slot, dynamic keys = SYMBOLIC (depends on runtime)
 *
 * Returns: { severity, reason }
 */
export declare function detectConflict(access1: AccessPath, access2: AccessPath): {
    severity: "DEFINITE" | "SYMBOLIC" | "SAFE";
    reason: string;
};
/**
 * Format storage layout for display
 */
export declare function formatStorageLayout(slots: StorageSlot[]): string;
//# sourceMappingURL=storageLayout.d.ts.map