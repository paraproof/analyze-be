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
const ANCHOR_CATEGORIES = [
    "CODE_SIZE",
    "HARDCODED_GAS",
    "GAS_REFUND",
    "GAS_REIMBURSEMENT",
    "CREATE2_EIP7702",
    "BLOB_TX",
];
const EXTRA_CATEGORIES = [
    "GAS_OPCODES",
    "DELEGATECALL",
    "SELFDESTRUCT",
];
/**
 * Check contract for Monad compatibility issues.
 * Pure AST/regex pass over source text — no SolCMC, no solver.
 */
export function checkMonadCompatibility(contract) {
    const issues = [];
    const code = contract.sourceCode;
    // --- ANCHOR CHECKS (the 6) ---
    const codeSize = code.length;
    const MAX_CODE_SIZE_BYTES = 128 * 1024;
    if (codeSize > MAX_CODE_SIZE_BYTES) {
        issues.push({
            severity: "ERROR",
            category: "CODE_SIZE",
            isAnchor: true,
            code: `Code size: ${codeSize} bytes`,
            message: `Contract code exceeds Monad limit of ${MAX_CODE_SIZE_BYTES} bytes`,
            recommendation: `Split contract into multiple smaller contracts or use proxy pattern`,
        });
    }
    issues.push(...detectHardcodedGas(code));
    issues.push(...detectGasRefundLogic(code));
    issues.push(...detectGasReimbursement(code));
    issues.push(...detectCreate2Eip7702(code));
    issues.push(...detectBlobTxDependencies(code));
    // --- EXTRA CHECKS (informational only, capped at INFO, not anchors) ---
    issues.push(...detectGasOpcodesInfo(code));
    issues.push(...detectDelegatecallInfo(code));
    issues.push(...detectSelfdestructInfo(code));
    // Only anchor-category issues count toward errors/warnings and checks.
    const anchorIssues = issues.filter((i) => i.isAnchor);
    const errorCount = anchorIssues.filter((i) => i.severity === "ERROR").length;
    const warningCount = anchorIssues.filter((i) => i.severity === "WARNING").length;
    // infos = anchor infos + ALL extra findings (extras are always INFO)
    const infoCount = anchorIssues.filter((i) => i.severity === "INFO").length +
        issues.filter((i) => !i.isAnchor).length;
    const anchorCategoriesWithIssues = new Set(anchorIssues.map((i) => i.category));
    const failed = anchorCategoriesWithIssues.size;
    const total = ANCHOR_CATEGORIES.length; // always 6
    const passed = total - failed;
    return {
        contractName: contract.contractName,
        fileName: contract.fileName,
        codeSize,
        issues,
        checks: { total, passed, failed },
        summary: {
            errors: errorCount,
            warnings: warningCount,
            infos: infoCount,
        },
    };
}
// ============================================================================
// ANCHOR DETECTORS (the 6 — unchanged logic from previous fix pass)
// ============================================================================
function detectHardcodedGas(code) {
    const issues = [];
    const gasleftRegex = /gasleft\(\)\s*(?:>|>=|<|<=|==|!=)\s*(\d{3,})/gi;
    let match;
    while ((match = gasleftRegex.exec(code)) !== null) {
        const gasValue = match[1];
        const lineNum = code.substring(0, match.index).split("\n").length;
        issues.push({
            severity: "WARNING",
            category: "HARDCODED_GAS",
            isAnchor: true,
            line: lineNum,
            code: match[0],
            message: `Hardcoded gas value: gasleft() compared to ${gasValue}`,
            recommendation: `Use dynamic gas estimation instead of hardcoded thresholds. Gas costs vary between chains.`,
        });
    }
    const callGasRegex = /\.call\s*\{\s*gas:\s*(\d+)/gi;
    while ((match = callGasRegex.exec(code)) !== null) {
        const gasValue = match[1];
        const lineNum = code.substring(0, match.index).split("\n").length;
        issues.push({
            severity: "WARNING",
            category: "HARDCODED_GAS",
            isAnchor: true,
            line: lineNum,
            code: match[0],
            message: `Hardcoded gas in external call: ${gasValue}`,
            recommendation: `Use gasleft() - buffer instead of fixed gas limits. Monad has different gas costs.`,
        });
    }
    const varAssignRegex = /(?:uint256|uint)\s+gas\s*=\s*(\d{4,})/gi;
    while ((match = varAssignRegex.exec(code)) !== null) {
        const gasValue = match[1];
        const lineNum = code.substring(0, match.index).split("\n").length;
        issues.push({
            severity: "INFO",
            category: "HARDCODED_GAS",
            isAnchor: true,
            line: lineNum,
            code: match[0],
            message: `Gas variable with hardcoded value: ${gasValue}`,
            recommendation: `Consider making this value configurable or computed dynamically.`,
        });
    }
    return issues;
}
function detectGasRefundLogic(code) {
    const issues = [];
    const refundRegex = /refund\s*=.*(?:tx\.gasprice|gasRefund|21000|20000|SELFDESTRUCT)/gi;
    let match;
    while ((match = refundRegex.exec(code)) !== null) {
        const lineNum = code.substring(0, match.index).split("\n").length;
        issues.push({
            severity: "WARNING",
            category: "GAS_REFUND",
            isAnchor: true,
            line: lineNum,
            code: match[0],
            message: `Gas refund logic detected: ${match[0].substring(0, 50)}...`,
            recommendation: `Monad may have different refund mechanics. Test extensively on Monad testnet.`,
        });
    }
    if (code.includes("21000")) {
        const lines = code.split("\n");
        lines.forEach((line, idx) => {
            if (line.includes("21000")) {
                issues.push({
                    severity: "INFO",
                    category: "GAS_REFUND",
                    isAnchor: true,
                    line: idx + 1,
                    code: line.trim(),
                    message: `Hardcoded intrinsic gas (21000) found`,
                    recommendation: `Verify this value is correct for Monad network.`,
                });
            }
        });
    }
    return issues;
}
/**
 * Gas reimbursement detector — Monad's core anchor rule with actual teeth.
 * Monad deducts gas by gas_limit at submission, not gas_used post-execution,
 * with no equivalent post-hoc refund step. Contracts reimbursing relayers
 * based on gasUsed * tx.gasprice will silently mis-pay.
 */
function detectGasReimbursement(code) {
    const issues = [];
    const gasUsedDeltaRegex = /(?:uint256|uint)\s+\w*[Gg]as[Uu]sed\w*\s*=\s*\w+\s*-\s*gasleft\(\)/g;
    let match;
    while ((match = gasUsedDeltaRegex.exec(code)) !== null) {
        const lineNum = code.substring(0, match.index).split("\n").length;
        issues.push({
            severity: "ERROR",
            category: "GAS_REIMBURSEMENT",
            isAnchor: true,
            line: lineNum,
            code: match[0],
            message: `Gas-used delta computed from gasleft() for reimbursement purposes`,
            recommendation: `Monad meters gas via gas_limit at submission, not gas_used post-execution, and has no equivalent post-hoc refund step. Reimbursement math based on gasleft() deltas will mis-calculate payouts on Monad. Recompute using Monad's actual fee/gas accounting APIs, or avoid on-chain gas reimbursement entirely.`,
        });
    }
    const reimbursementTransferRegex = /\.(?:transfer|send|call)\s*(?:\{[^}]*\})?\s*\(\s*\w*[Gg]as\w*\s*\*\s*tx\.gasprice/g;
    while ((match = reimbursementTransferRegex.exec(code)) !== null) {
        const lineNum = code.substring(0, match.index).split("\n").length;
        issues.push({
            severity: "ERROR",
            category: "GAS_REIMBURSEMENT",
            isAnchor: true,
            line: lineNum,
            code: match[0],
            message: `Reimbursement transfer computed as gas * tx.gasprice`,
            recommendation: `This relayer/meta-tx reimbursement pattern assumes Ethereum-style gas accounting. On Monad, gas_limit (not gas_used) is deducted at submission and there's no built-in refund step, so this payout will not match actual costs. Audit this reimbursement path before deploying to Monad.`,
        });
    }
    const relayerKeywords = /(relayer|paymaster|refundGas|reimburseGas|gasStation)/i;
    if (relayerKeywords.test(code) && /tx\.gasprice/.test(code)) {
        const relayerMatch = code.match(relayerKeywords);
        if (relayerMatch && relayerMatch.index !== undefined) {
            const lineNum = code.substring(0, relayerMatch.index).split("\n").length;
            issues.push({
                severity: "WARNING",
                category: "GAS_REIMBURSEMENT",
                isAnchor: true,
                line: lineNum,
                code: relayerMatch[0],
                message: `Relayer/paymaster-style keyword found alongside tx.gasprice usage`,
                recommendation: `If this contract reimburses gas costs to a relayer, meta-tx sender, or paymaster, verify the reimbursement math against Monad's gas accounting model (gas_limit deduction, no post-execution refund) before deploying.`,
            });
        }
    }
    return issues;
}
/**
 * CREATE2 — narrowed to EIP-7702 delegated-EOA context only. Plain
 * factory usage (the overwhelming majority of CREATE2 calls) is safe
 * and standard, and is NOT flagged.
 */
function detectCreate2Eip7702(code) {
    const issues = [];
    const hasCreate2 = /create2\s*\(/i.test(code);
    if (!hasCreate2)
        return issues;
    const eip7702Signals = [
        /eip[-_]?7702/i,
        /0xef0100/i,
        /delegat(?:ed|ion)\s*eoa/i,
        /authorization[Ll]ist/,
        /SetCodeTransaction/,
    ];
    const hasEip7702Signal = eip7702Signals.some((pattern) => pattern.test(code));
    if (!hasEip7702Signal)
        return issues; // plain factory — no flag
    const create2Regex = /create2\s*\(/gi;
    let match;
    let count = 0;
    let firstIndex = -1;
    while ((match = create2Regex.exec(code)) !== null) {
        count++;
        if (firstIndex === -1)
            firstIndex = match.index;
    }
    const lineNum = firstIndex >= 0
        ? code.substring(0, firstIndex).split("\n").length
        : undefined;
    issues.push({
        severity: "WARNING",
        category: "CREATE2_EIP7702",
        isAnchor: true,
        line: lineNum,
        code: `${count} CREATE2 call(s) alongside EIP-7702 delegation signals`,
        message: `CREATE2 used in a contract that also references EIP-7702 delegated-EOA patterns`,
        recommendation: `Deterministic CREATE2 address assumptions can break if the target account is a delegated EOA under EIP-7702. Verify address-derivation logic accounts for delegation on Monad before relying on CREATE2 addresses.`,
    });
    return issues;
}
function detectBlobTxDependencies(code) {
    const issues = [];
    const blobPatterns = [
        { pattern: /blobbasefee/gi, name: "BLOBBASEFEE" },
        { pattern: /blobhash/gi, name: "BLOBHASH" },
        { pattern: /eip4844/gi, name: "EIP-4844" },
        { pattern: /blob.*calldata/gi, name: "blob calldata" },
    ];
    blobPatterns.forEach(({ pattern, name }) => {
        let match;
        while ((match = pattern.exec(code)) !== null) {
            const lineNum = code.substring(0, match.index).split("\n").length;
            issues.push({
                severity: "WARNING",
                category: "BLOB_TX",
                isAnchor: true,
                line: lineNum,
                code: match[0],
                message: `Blob transaction dependency detected: ${name}`,
                recommendation: `Monad may not support EIP-4844 blob transactions yet. Remove this dependency or add fallback logic.`,
            });
        }
    });
    return issues;
}
// ============================================================================
// EXTRA DETECTORS (informational only — always INFO, isAnchor: false,
// excluded from checks.total/passed/failed and from errors/warnings counts)
// ============================================================================
function detectGasOpcodesInfo(code) {
    const issues = [];
    const gaspriceRegex = /tx\.gasprice/gi;
    let match;
    while ((match = gaspriceRegex.exec(code)) !== null) {
        const lineNum = code.substring(0, match.index).split("\n").length;
        issues.push({
            severity: "INFO",
            category: "GAS_OPCODES",
            isAnchor: false,
            line: lineNum,
            code: match[0],
            message: `tx.gasprice usage detected`,
            recommendation: `Not part of the core Monad readiness anchors — informational only. Verify gas pricing model on Monad if this value drives contract logic.`,
        });
    }
    return issues;
}
function detectDelegatecallInfo(code) {
    const issues = [];
    const delegatecallRegex = /delegatecall/gi;
    let match;
    let count = 0;
    while ((match = delegatecallRegex.exec(code)) !== null) {
        count++;
    }
    if (count > 0) {
        issues.push({
            severity: "INFO",
            category: "DELEGATECALL",
            isAnchor: false,
            code: `${count} delegatecall(s)`,
            message: `${count} DELEGATECALL usage(s) detected`,
            recommendation: `Not part of the core Monad readiness anchors — informational only. DELEGATECALL preserves caller context; ensure proxy contracts behave as expected on Monad.`,
        });
    }
    return issues;
}
/**
 * SELFDESTRUCT — informational only. Its reduced effect (EIP-6780, live
 * since Cancun) is an Ethereum protocol change, not a Monad-specific
 * incompatibility, so it's kept out of the anchor set entirely.
 */
function detectSelfdestructInfo(code) {
    const issues = [];
    const selfdestructRegex = /selfdestruct/gi;
    let match;
    while ((match = selfdestructRegex.exec(code)) !== null) {
        const lineNum = code.substring(0, match.index).split("\n").length;
        issues.push({
            severity: "INFO",
            category: "SELFDESTRUCT",
            isAnchor: false,
            line: lineNum,
            code: match[0],
            message: `SELFDESTRUCT opcode used`,
            recommendation: `Not part of the core Monad readiness anchors — informational only. This is an Ethereum protocol behavior change (EIP-6780, live since Cancun), not a Monad-specific issue. Since EIP-6780, SELFDESTRUCT only deletes contract code/storage when invoked in the same transaction as contract creation; otherwise it just sends the balance.`,
        });
    }
    return issues;
}
/**
 * Format report for display (CLI / debug use)
 */
export function formatMonadCompatibilityReport(report) {
    const lines = [];
    lines.push(`\n=== Monad Portability Report (pure AST, no SolCMC) ===\n`);
    lines.push(`Contract: ${report.contractName}`);
    lines.push(`File: ${report.fileName}`);
    lines.push(`Code Size: ${report.codeSize} bytes (limit: 128 KB)`);
    lines.push(`\n--- Anchor Checks (the 6 core Monad readiness rules) ---`);
    lines.push(`${report.checks.passed}/${report.checks.total} anchor categories passed`);
    lines.push(`\n--- Counts ---`);
    lines.push(`🔴 Errors: ${report.summary.errors}`);
    lines.push(`🟡 Warnings: ${report.summary.warnings}`);
    lines.push(`ℹ️  Info (incl. non-anchor extras): ${report.summary.infos}`);
    const anchorIssues = report.issues.filter((i) => i.isAnchor);
    const extraIssues = report.issues.filter((i) => !i.isAnchor);
    if (anchorIssues.length > 0) {
        lines.push(`\n--- Anchor Issues ---\n`);
        anchorIssues.forEach((issue) => {
            lines.push(`[${issue.severity}] [${issue.category}]`);
            if (issue.line)
                lines.push(`  Line ${issue.line}: ${issue.code}`);
            lines.push(`  ${issue.message}`);
            lines.push(`  → ${issue.recommendation}\n`);
        });
    }
    if (extraIssues.length > 0) {
        lines.push(`\n--- Extra Info (non-anchor, doesn't affect readiness) ---\n`);
        extraIssues.forEach((issue) => {
            lines.push(`[INFO] [${issue.category}]`);
            if (issue.line)
                lines.push(`  Line ${issue.line}: ${issue.code}`);
            lines.push(`  ${issue.message}`);
        });
    }
    if (report.issues.length === 0) {
        lines.push(`\n✅ No issues detected at all!`);
    }
    lines.push(`\n--- Verdict ---`);
    if (report.summary.errors > 0) {
        lines.push(`❌ NOT READY: Fix ${report.summary.errors} anchor error(s) before deploying to Monad`);
    }
    else if (report.summary.warnings > 0) {
        lines.push(`⚠️  CAUTION: Address ${report.summary.warnings} anchor warning(s) before deployment`);
    }
    else {
        lines.push(`✅ READY: All anchor checks passed`);
    }
    return lines.join("\n");
}
//# sourceMappingURL=monadChecker.js.map