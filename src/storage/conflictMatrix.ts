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
import {
  computeStorageLayout,
  detectConflict,
  resolveAccessSlot,
  type StorageSlot,
  type AccessPath,
} from "./storageLayout.js";

export interface ConflictMatrixCell {
  function1: string;
  function2: string;
  accesses1: AccessPath[]; // CHANGED: now includes accessType
  accesses2: AccessPath[];
  conflicts: Array<{
    slot1: string;
    slot2: string;
    accessType1: "read" | "write";
    accessType2: "read" | "write";
    severity: "DEFINITE" | "SYMBOLIC" | "SAFE";
    reason: string; // CHANGED: descriptive reason
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
export function buildConflictMatrix(contract: ContractSummary): ConflictMatrix {
  const storageLayout = computeStorageLayout(contract.stateVariables);

  // Filter hanya state-modifying functions (external/public yang bisa write state)
  const stateModifyingFunctions = contract.functions.filter(
    (f) =>
      (f.visibility === "external" || f.visibility === "public") &&
      f.isStateModifying,
  );

  const matrix: ConflictMatrixCell[] = [];

  // Build matrix: compare setiap pair fungsi
  for (let i = 0; i < stateModifyingFunctions.length; i++) {
    for (let j = i; j < stateModifyingFunctions.length; j++) {
      const fn1 = stateModifyingFunctions[i];
      const fn2 = stateModifyingFunctions[j];

      // Resolve access paths (reads + writes)
      const accesses1: AccessPath[] = [];
      const accesses2: AccessPath[] = [];

      // Process writes from fn1
      for (const write of fn1.writes) {
        const access = resolveAccessSlot(
          {
            variable: write.variable,
            keys: write.keys || [],
            operation: "write",
          },
          storageLayout,
        );
        accesses1.push(access);
      }

      // Process reads from fn1 (if tracked)
      if (fn1.reads) {
        for (const read of fn1.reads) {
          const access = resolveAccessSlot(
            {
              variable: read.variable,
              keys: read.keys || [],
              operation: "read",
            },
            storageLayout,
          );
          accesses1.push(access);
        }
      }

      // Process writes from fn2
      for (const write of fn2.writes) {
        const access = resolveAccessSlot(
          {
            variable: write.variable,
            keys: write.keys || [],
            operation: "write",
          },
          storageLayout,
        );
        accesses2.push(access);
      }

      // Process reads from fn2 (if tracked)
      if (fn2.reads) {
        for (const read of fn2.reads) {
          const access = resolveAccessSlot(
            {
              variable: read.variable,
              keys: read.keys || [],
              operation: "read",
            },
            storageLayout,
          );
          accesses2.push(access);
        }
      }

      // Cross-check conflicts
      const conflicts: Array<{
        slot1: string;
        slot2: string;
        accessType1: "read" | "write";
        accessType2: "read" | "write";
        severity: "DEFINITE" | "SYMBOLIC" | "SAFE";
        reason: string;
      }> = [];

      for (const access1 of accesses1) {
        for (const access2 of accesses2) {
          const conflictResult = detectConflict(access1, access2);

          if (conflictResult.severity !== "SAFE") {
            conflicts.push({
              slot1: access1.computedSlot,
              slot2: access2.computedSlot,
              accessType1: access1.accessType,
              accessType2: access2.accessType,
              severity: conflictResult.severity,
              reason: conflictResult.reason, // NEW: includes explanation
            });
          }
        }
      }

      // Determine overall severity (worst case)
      let overallSeverity: "DEFINITE" | "SYMBOLIC" | "SAFE" = "SAFE";
      if (conflicts.some((c) => c.severity === "DEFINITE")) {
        overallSeverity = "DEFINITE";
      } else if (conflicts.some((c) => c.severity === "SYMBOLIC")) {
        overallSeverity = "SYMBOLIC";
      }

      // Only include if there's actual conflict or same function
      if (overallSeverity !== "SAFE" || fn1.name === fn2.name) {
        matrix.push({
          function1: fn1.name,
          function2: fn2.name,
          accesses1,
          accesses2,
          conflicts,
          overallSeverity,
        });
      }
    }
  }

  // Calculate summary
  const summary = {
    definiteConflicts: matrix.filter((c) => c.overallSeverity === "DEFINITE")
      .length,
    symbolicConflicts: matrix.filter((c) => c.overallSeverity === "SYMBOLIC")
      .length,
    safeConflicts: matrix.filter((c) => c.overallSeverity === "SAFE").length,
  };

  return {
    contractName: contract.contractName,
    functions: stateModifyingFunctions,
    storageLayout,
    matrix,
    summary,
  };
}

/**
 * Format conflict matrix sebagai ASCII table (untuk CLI/report)
 */
export function formatConflictMatrixTable(
  conflictMatrix: ConflictMatrix,
): string {
  const { functions, matrix } = conflictMatrix;
  const functionNames = functions.map((f) => f.name);
  const n = functionNames.length;

  // Build table rows
  const rows: string[][] = [];
  rows.push([""].concat(functionNames)); // Header row

  for (let i = 0; i < n; i++) {
    const row = [functionNames[i]];
    for (let j = 0; j < n; j++) {
      const cell = matrix.find(
        (c) =>
          (c.function1 === functionNames[i] &&
            c.function2 === functionNames[j]) ||
          (c.function1 === functionNames[j] &&
            c.function2 === functionNames[i]),
      );

      if (i === j) {
        row.push("─"); // Diagonal: self-write
      } else if (!cell) {
        row.push("✓"); // No conflict
      } else {
        switch (cell.overallSeverity) {
          case "DEFINITE":
            row.push("🔴"); // Definite conflict
            break;
          case "SYMBOLIC":
            row.push("🟡"); // Symbolic conflict
            break;
          case "SAFE":
            row.push("✓"); // Safe
            break;
        }
      }
    }
    rows.push(row);
  }

  // Calculate column widths
  const colWidths: number[] = [];
  for (let j = 0; j < n + 1; j++) {
    colWidths[j] = Math.max(...rows.map((row) => row[j]?.length || 0), 3);
  }

  // Format as table
  const lines: string[] = [];
  lines.push("=== Conflict Matrix ===\n");
  lines.push(
    "Legend: 🔴 = Definite Conflict | 🟡 = Symbolic | ✓ = Safe | ─ = Self-write\n",
  );

  for (const row of rows) {
    const formatted = row
      .map((cell, j) => cell.padEnd(colWidths[j]))
      .join(" | ");
    lines.push(formatted);
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Format conflict matrix dengan detail (untuk report)
 */
export function formatConflictMatrixDetailed(
  conflictMatrix: ConflictMatrix,
): string {
  const { matrix, summary } = conflictMatrix;

  const lines: string[] = [];
  lines.push("=== Conflict Matrix (Detailed) ===\n");

  lines.push(`Summary:`);
  lines.push(`  🔴 DEFINITE conflicts: ${summary.definiteConflicts}`);
  lines.push(`  🟡 SYMBOLIC conflicts: ${summary.symbolicConflicts}`);
  lines.push(`  ✓  SAFE: ${summary.safeConflicts}`);
  lines.push("");

  // Group by severity
  const definite = matrix.filter((c) => c.overallSeverity === "DEFINITE");
  const symbolic = matrix.filter((c) => c.overallSeverity === "SYMBOLIC");

  if (definite.length > 0) {
    lines.push("--- DEFINITE CONFLICTS (Will abort & retry) ---");
    for (const cell of definite) {
      lines.push(`\n${cell.function1}() ←→ ${cell.function2}():`);
      for (const conflict of cell.conflicts) {
        const type1 = conflict.accessType1.toUpperCase();
        const type2 = conflict.accessType2.toUpperCase();
        lines.push(
          `  🔴 ${type1}(${conflict.slot1}) vs ${type2}(${conflict.slot2})`,
        );
        lines.push(`     Reason: ${conflict.reason}`);
      }
    }
    lines.push("");
  }

  if (symbolic.length > 0) {
    lines.push("--- SYMBOLIC CONFLICTS (May abort depending on values) ---");
    for (const cell of symbolic) {
      lines.push(`\n${cell.function1}() ←→ ${cell.function2}():`);
      for (const conflict of cell.conflicts) {
        const type1 = conflict.accessType1.toUpperCase();
        const type2 = conflict.accessType2.toUpperCase();
        lines.push(
          `  🟡 ${type1}(${conflict.slot1}) vs ${type2}(${conflict.slot2})`,
        );
        lines.push(`     Reason: ${conflict.reason}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Analyze parallel execution risk: given N concurrent invocations,
 * berapa banyak yang akan abort (karena conflict).
 *
 * Simplified heuristic:
 * - Same function called N times: bentrok DEFINITE jika write ke state
 *   yang sama (worst: semua abort except 1)
 * - Different functions: DEFINITE = abort, SYMBOLIC = maybe abort
 */
export function analyzeParallelRisk(
  conflictMatrix: ConflictMatrix,
  concurrentCalls: Array<{ function: string; count: number }>,
): {
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
  analysis: string;
  estimatedAbortRate?: string;
} {
  const { matrix } = conflictMatrix;

  let hasDefiniteConflict = false;
  let hasSymbolicConflict = false;
  let definiteCount = 0;

  for (const call1 of concurrentCalls) {
    for (const call2 of concurrentCalls) {
      if (call1.function === call2.function && call1.count > 1) {
        // Same function called multiple times: almost always conflict
        hasDefiniteConflict = true;
        definiteCount++;
      } else if (call1.function !== call2.function) {
        const cell = matrix.find(
          (c) =>
            (c.function1 === call1.function &&
              c.function2 === call2.function) ||
            (c.function1 === call2.function && c.function2 === call1.function),
        );
        if (cell) {
          if (cell.overallSeverity === "DEFINITE") {
            hasDefiniteConflict = true;
            definiteCount++;
          }
          if (cell.overallSeverity === "SYMBOLIC") hasSymbolicConflict = true;
        }
      }
    }
  }

  let riskLevel: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  let analysis = "";
  let estimatedAbortRate = "";

  if (hasDefiniteConflict) {
    riskLevel = "HIGH";
    analysis =
      "DEFINITE storage conflicts detected. Concurrent calls will abort & retry (high contention).";
    estimatedAbortRate = "20-50% of transactions may retry";
  } else if (hasSymbolicConflict) {
    riskLevel = "MEDIUM";
    analysis =
      "SYMBOLIC conflicts detected. May abort depending on runtime values (key-dependent).";
    estimatedAbortRate = "5-20% of transactions may retry";
  } else {
    riskLevel = "LOW";
    analysis = "No conflicts detected. Functions can safely run in parallel.";
    estimatedAbortRate = "<1% retry rate expected";
  }

  return { riskLevel, analysis, estimatedAbortRate };
}
