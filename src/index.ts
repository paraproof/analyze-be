import "dotenv/config";

import express from "express";
import type { Request, Response } from "express";
import { createJob, getJob } from "./services/jobStore.js";
import type {
  VerifyRequest,
  VerifyJobCreatedResponse,
  GenericErrorResponse,
  ContractSummary,
  AnalyzeRequest,
} from "./types/index.js";
import { checkMonadCompatibility } from "./verify/monadChecker.js";
import { buildConflictMatrix } from "./storage/conflictMatrix.js";
import { parseSolidityFiles } from "./verify/parser.js";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

app.get("/", (req: Request, res: Response) => {
  res.send("Hello from TypeScript and Express!");
});

/**
 * POST /monad/analyze — pure AST-based Monad readiness check.
 *
 * NO SolCMC. NO solver. Two deterministic pillars:
 *   1. Portability  — 6 anchor rules (docs-backed, can't be argued with)
 *   2. Parallelization — storage conflict matrix (will it scale?)
 *
 * NO arbitrary 0-100 score. Output is raw counts only — "X/6 anchor
 * checks passed", "N definite conflicts" — so nothing here can be
 * disputed as an unaccountable formula. Verdict is derived directly
 * from those counts, not from a weighted percentage.
 */
app.post("/monad/analyze", async (req: Request, res: Response) => {
  const { sourceCode, fileName }: AnalyzeRequest = req.body;

  if (!sourceCode) {
    return res.status(400).json({
      success: false,
      error: "sourceCode is required",
    });
  }

  try {
    const contracts = parseSolidityFiles({
      [fileName || "Contract.sol"]: sourceCode,
    });

    if (!contracts || contracts.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Failed to parse contract",
      });
    }

    // Ambil contract dan pastikan ada
    const contract = contracts[0];
    if (!contract) {
      return res.status(400).json({
        success: false,
        error: "Contract definition not found",
      });
    }

    // Pillar 1: Portability (pure AST/regex, 6 anchor categories)
    const portabilityReport = checkMonadCompatibility(contract);

    // Pillar 2: Parallelization (storage conflict matrix)
    const conflictReport = buildConflictMatrix(contract);

    // Verdict from raw counts — no percentage math anywhere.
    const verdict = determineVerdict(
      portabilityReport.summary.errors,
      conflictReport.summary.definiteConflicts,
    );

    const recommendation = generateRecommendation(
      verdict,
      portabilityReport.summary.errors,
      conflictReport.summary.definiteConflicts,
    );

    const response = {
      success: true,
      contractName: contract.contractName,
      timestamp: new Date().toISOString(),
      verdict,
      recommendation,
      portability: {
        anchorChecks: portabilityReport.checks, // { total: 6, passed, failed }
        errors: portabilityReport.summary.errors,
        warnings: portabilityReport.summary.warnings,
        infos: portabilityReport.summary.infos,
        issues: portabilityReport.issues.map((issue) => ({
          severity: issue.severity,
          category: issue.category,
          isAnchor: issue.isAnchor,
          message: issue.message,
          recommendation: issue.recommendation,
          line: issue.line,
        })),
      },
      parallelization: {
        definiteConflicts: conflictReport.summary.definiteConflicts,
        symbolicConflicts: conflictReport.summary.symbolicConflicts,
        safeConflicts: conflictReport.summary.safeConflicts,
        matrix: conflictReport.matrix.map((cell: any) => ({
          function1: cell.function1,
          function2: cell.function2,
          severity: cell.overallSeverity,
        })),
      },
    };

    res.json(response);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * GET /monad/health
 */
app.get("/monad/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "Monad Readiness API (pure AST, no SolCMC)",
    version: "2.0.0",
    endpoints: ["POST /monad/analyze"],
  });
});

// ============================================================================
// HELPERS — pure raw-count logic, no weighted score
// ============================================================================

/**
 * Verdict from raw counts only:
 * - Any anchor ERROR → NOT_READY (blocking, docs-backed reason)
 * - No errors but at least one definite storage conflict → CAUTION
 *   (will still deploy and run, but won't parallelize as expected)
 * - Otherwise → READY
 */
function determineVerdict(
  anchorErrors: number,
  definiteConflicts: number,
): "READY" | "CAUTION" | "NOT_READY" {
  if (anchorErrors > 0) return "NOT_READY";
  if (definiteConflicts > 0) return "CAUTION";
  return "READY";
}

function generateRecommendation(
  verdict: "READY" | "CAUTION" | "NOT_READY",
  anchorErrors: number,
  definiteConflicts: number,
): string {
  if (verdict === "READY") {
    return "✅ All anchor checks passed, no storage conflicts detected. Ready for Monad deployment.";
  }
  if (verdict === "NOT_READY") {
    return `❌ Fix ${anchorErrors} anchor error(s) before deploying — see portability.issues for details.`;
  }
  return `⚠️ ${definiteConflicts} definite storage conflict(s) found — contract will deploy and run correctly, but won't parallelize as expected on Monad. See parallelization.matrix.`;
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
