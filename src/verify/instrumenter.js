import { parse } from "@solidity-parser/parser";
// Solidity keyword/global yang WAJAR muncul di assert/before tanpa perlu
// match ke state variable/parameter — daftar ini sengaja nggak lengkap-
// lengkap amat, cuma yang paling umum kepake di assertion sederhana.
const SOLIDITY_GLOBALS = new Set([
    "msg",
    "sender",
    "value",
    "tx",
    "origin",
    "block",
    "timestamp",
    "number",
    "this",
    "address",
    "uint",
    "uint8",
    "uint16",
    "uint32",
    "uint64",
    "uint128",
    "uint256",
    "int",
    "int256",
    "bool",
    "string",
    "bytes",
    "bytes32",
    "true",
    "false",
    "balance",
    "keccak256",
    "assert",
    "require",
    "revert",
    "gasleft",
]);
/**
 * [SOLID] Validasi identifier yang direference di before/asserts LLM.
 *
 * PENTING: re-parse pakai @solidity-parser/parser CUMA ngecek GRAMMAR,
 * BUKAN ngecek apakah identifier beneran ada (itu baru ketauan pas solc
 * compile beneran, yang di sandbox ini nggak bisa diakses). Jadi ini
 * fungsi WAJIB ada sebagai safety net tambahan sebelum re-parse.
 *
 * Heuristik ini nggak sempurna (nggak separsing beneran), tapi cukup
 * buat nangkep kasus paling umum: LLM ngarang nama variable/parameter.
 */
function findSuspiciousIdentifiers(code, knownGood) {
    const suspicious = new Set();
    // regex: identifier yang BUKAN didahului titik (skip member access kayak .sender)
    const regex = /(?<!\.)\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let match;
    while ((match = regex.exec(code)) !== null) {
        const ident = match[1];
        if (SOLIDITY_GLOBALS.has(ident))
            continue;
        if (knownGood.has(ident))
            continue;
        suspicious.add(ident);
    }
    return [...suspicious];
}
function buildKnownGoodSet(contract, fn, beforeVarNames) {
    const known = new Set();
    for (const sv of contract.stateVariables)
        known.add(sv.name);
    for (const p of fn.parameters)
        known.add(p.name);
    for (const f of contract.functions)
        known.add(f.name);
    for (const v of beforeVarNames)
        known.add(v);
    return known;
}
/**
 * [SOLID] Validasi assertions dari Groq SEBELUM di-splice — cek identifier
 * mencurigakan. Return list warning (kosong kalau semua bersih).
 */
export function validateAssertions(contract, assertions) {
    const problems = [];
    const fnMap = new Map(contract.functions.map((f) => [f.name, f]));
    for (const [rawFnName, set] of Object.entries(assertions.functions)) {
        const fnName = rawFnName.split("(")[0].trim();
        const fn = fnMap.get(fnName);
        if (!fn) {
            problems.push(`Function "${fnName}" yang direference di assertions nggak ada di contract "${contract.contractName}".`);
            continue;
        }
        const beforeVarNames = set.before
            .map((line) => {
            const m = line.match(/\b(__before_[a-zA-Z0-9_]*)\b/);
            return m ? m[1] : "";
        })
            .filter(Boolean);
        const knownGood = buildKnownGoodSet(contract, fn, beforeVarNames);
        for (const w of fn.writes) {
            for (const call of fn.externalCalls) {
                if (!call.valueExpression || call.valueExpression === w.value)
                    continue;
                for (const assertLine of set.beforeExternalCall || []) {
                    if (!assertLine.includes(w.value))
                        continue;
                    const withoutWriteValue = assertLine.split(w.value).join("");
                    const stillHasTransferredValue = withoutWriteValue.includes(call.valueExpression);
                    if (!stillHasTransferredValue) {
                        problems.push(`Function "${fnName}": assert di beforeExternalCall keliatan ke-mirror dari ` +
                            `writes[].value ("${w.value}") padahal value yang BENERAN ditransfer beda ` +
                            `("${call.valueExpression}") — ini pola tautologi yang dilarang. Assert: "${assertLine}"`);
                    }
                }
            }
        }
        for (const line of [
            ...set.before,
            ...set.asserts,
            ...(set.beforeExternalCall || []),
        ]) {
            const suspicious = findSuspiciousIdentifiers(line, knownGood);
            if (suspicious.length > 0) {
                problems.push(`Function "${fnName}": identifier mencurigakan (nggak ketemu di state var/parameter/sibling function): ${suspicious.join(", ")} — di baris: "${line}"`);
            }
        }
    }
    return problems;
}
/**
 * Hitung nomor baris (1-indexed) dari sebuah offset karakter di dalam teks.
 * O(offset) — cukup buat ukuran contract Solidity biasa.
 */
function offsetToLine(text, offset) {
    let line = 1;
    const limit = Math.min(offset, text.length);
    for (let i = 0; i < limit; i++) {
        if (text[i] === "\n")
            line++;
    }
    return line;
}
/**
 * [SOLID] Splice before/beforeExternalCall/assert dari Groq ke source asli.
 *
 * BARU: selain nge-splice, kita SEKALIAN hitung `injectedLineRanges` — buat
 * TIAP blok teks yang disisipin, kita catet range baris (di source FINAL,
 * udah termasuk header) yang di-cover blok itu. Ini dipake solcmc.ts buat
 * bedain "CHC warning ini soal assertion yang KITA generate" vs "CHC warning
 * ini soal overflow/underflow BUILT-IN solc yang nggak ada hubungannya sama
 * assert() kita". Tanpa ini, hasil verifikasi gampang disalahartikan.
 */
export function spliceAssertions(contract, assertions) {
    const warnings = [];
    const fnMap = new Map(contract.functions.map((f) => [f.name, f]));
    const splicePoints = [];
    for (const [rawFnName, set] of Object.entries(assertions.functions)) {
        const fnName = rawFnName.split("(")[0].trim();
        const fn = fnMap.get(fnName);
        if (!fn)
            continue;
        if (!fn.bodyRange) {
            warnings.push(`Function "${fnName}" nggak punya bodyRange, instrumentasi di-skip.`);
            continue;
        }
        const bodyText = contract.sourceCode.slice(fn.bodyRange[0], fn.bodyRange[1] + 1);
        const firstBraceRelativeIdx = bodyText.indexOf("{");
        const lastBraceRelativeIdx = bodyText.lastIndexOf("}");
        if (firstBraceRelativeIdx === -1 || lastBraceRelativeIdx === -1) {
            warnings.push(`Gagal nemuin brace buat function "${fnName}", instrumentasi di-skip.`);
            continue;
        }
        const openingBraceAbsIdx = fn.bodyRange[0] + firstBraceRelativeIdx;
        const closingBraceAbsIdx = fn.bodyRange[0] + lastBraceRelativeIdx;
        if (set.before.length > 0) {
            splicePoints.push({
                position: openingBraceAbsIdx + 1,
                text: "\n        " + set.before.join("\n        "),
                assertCount: 0,
                kind: "before",
                functionName: fnName,
            });
        }
        if (set.beforeExternalCall && set.beforeExternalCall.length > 0) {
            if (fn.externalCallStatementRange) {
                splicePoints.push({
                    position: fn.externalCallStatementRange[0],
                    text: set.beforeExternalCall.join("\n        ") + "\n        ",
                    assertCount: set.beforeExternalCall.length,
                    kind: "beforeExternalCall",
                    functionName: fnName,
                });
            }
            else {
                warnings.push(`Function "${fnName}": Groq ngasih "beforeExternalCall" tapi function ini nggak kedetek punya external call — assert di-taro di akhir function sebagai fallback.`);
                splicePoints.push({
                    position: closingBraceAbsIdx,
                    text: "\n        " + set.beforeExternalCall.join("\n        ") + "\n    ",
                    assertCount: set.beforeExternalCall.length,
                    kind: "beforeExternalCall",
                    functionName: fnName,
                });
            }
        }
        if (set.asserts.length > 0) {
            splicePoints.push({
                position: closingBraceAbsIdx,
                text: "\n        " + set.asserts.join("\n        ") + "\n    ",
                assertCount: set.asserts.length,
                kind: "asserts",
                functionName: fnName,
            });
        }
    }
    // --- Hitung injectedLineRanges SEBELUM mutasi source ---
    // Final absolute offset (dalam `source` MUTATED, belum termasuk header) dari
    // tiap splice point = position_asli + total panjang teks dari SEMUA splice
    // point lain yang position_asli-nya LEBIH KECIL (insertion mereka terjadi
    // SEBELUM titik ini di urutan teks, jadi nggeser titik ini maju). Splice
    // point dengan position lebih besar TIDAK mempengaruhi offset titik ini.
    const ascendingByPosition = [...splicePoints].sort((a, b) => a.position - b.position);
    let cumulativeShift = 0;
    const rawRanges = [];
    for (const sp of ascendingByPosition) {
        const absoluteStart = sp.position + cumulativeShift;
        const absoluteEnd = absoluteStart + sp.text.length;
        rawRanges.push({
            start: absoluteStart,
            end: absoluteEnd,
            kind: sp.kind,
            functionName: sp.functionName,
        });
        cumulativeShift += sp.text.length;
    }
    // urutin DESCENDING by position biar splice yang posisinya lebih belakang
    // dikerjain duluan (nggak nge-geser posisi splice point lain yang belum diproses)
    splicePoints.sort((a, b) => b.position - a.position);
    let source = contract.sourceCode;
    let injectedAssertCount = 0;
    for (const sp of splicePoints) {
        source = source.slice(0, sp.position) + sp.text + source.slice(sp.position);
        injectedAssertCount += sp.assertCount;
    }
    const header = `// ============================================================\n` +
        `// AUTO-INSTRUMENTED — assert() DIGENERATE GROQ, POSISI SPLICE DETERMINISTIC.\n` +
        `// Contract: ${contract.contractName} (${contract.fileName})\n` +
        `// Generated at: ${new Date().toISOString()}\n` +
        `// ============================================================\n\n`;
    const headerLineCount = (header.match(/\n/g) || []).length;
    // `source` di titik ini SUDAH final (semua splice ke-apply), jadi
    // offsetToLine(source, ...) valid buat convert rawRanges.
    const injectedLineRanges = rawRanges.map((r) => ({
        start: offsetToLine(source, r.start) + headerLineCount,
        end: offsetToLine(source, r.end) + headerLineCount,
        kind: r.kind,
        functionName: r.functionName,
    }));
    return {
        instrumentedSource: header + source,
        warnings,
        injectedAssertCount,
        injectedLineRanges,
    };
}
/**
 * [SOLID] Re-parse hasil instrumentasi buat validasi GRAMMAR (bukan
 * semantik). Ini GRATIS, nggak butuh solc, cuma nangkep syntax error.
 */
export function checkSyntaxValid(instrumentedSource) {
    try {
        parse(instrumentedSource, { loc: false, range: false });
        return { valid: true };
    }
    catch (e) {
        return { valid: false, error: e.message || String(e) };
    }
}
//# sourceMappingURL=instrumenter.js.map