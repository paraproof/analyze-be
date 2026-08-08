import { parse, visit } from "@solidity-parser/parser";
const ASSIGNMENT_OPERATORS = new Set([
    "=",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "&=",
    "|=",
    "^=",
    "<<=",
    ">>=",
]);
function resolveTypeName(typeName) {
    if (!typeName)
        return { type: "unknown", isMapping: false };
    switch (typeName.type) {
        case "Mapping": {
            const keyType = resolveTypeName(typeName.keyType).type;
            const valueType = resolveTypeName(typeName.valueType).type;
            return { type: `mapping(${keyType} => ${valueType})`, isMapping: true };
        }
        case "ElementaryTypeName":
            return { type: typeName.name, isMapping: false };
        case "UserDefinedTypeName":
            return { type: typeName.namePath, isMapping: false };
        case "ArrayTypeName":
            return {
                type: `${resolveTypeName(typeName.baseTypeName).type}[]`,
                isMapping: false,
            };
        default:
            return { type: "unknown", isMapping: false };
    }
}
function extractEventEmits(body) {
    const emits = [];
    if (!body)
        return emits;
    visit(body, {
        EmitStatement(node) {
            const call = node.eventCall;
            emits.push({
                event: expressionToString(call.expression),
                arguments: (call.arguments || []).map(expressionToString),
            });
        },
    });
    return emits;
}
function extractExternalCalls(body) {
    const calls = [];
    if (!body)
        return calls;
    visit(body, {
        FunctionCall(node) {
            let expr = node.expression;
            let valueExpression;
            if (expr?.type === "NameValueExpression") {
                // BARU: extract value dari clause "{value: ...}" — dibutuhin biar
                // Groq bisa reference VALUE YANG BENERAN DITRANSFER, bukan
                // ke-mirror dari writes[].value (yang kalau kodenya buggy, ikut
                // ke-infect bug-nya juga — persis kasus yang bikin assert tetep
                // tautologi walau posisinya udah bener).
                const nameValueList = expr.arguments; // shape: { names: string[], arguments: any[] }
                if (nameValueList?.names && nameValueList?.arguments) {
                    const valueIdx = nameValueList.names.indexOf("value");
                    if (valueIdx !== -1 && nameValueList.arguments[valueIdx]) {
                        valueExpression = expressionToString(nameValueList.arguments[valueIdx]);
                    }
                }
                expr = expr.expression;
            }
            if (expr?.type === "MemberAccess") {
                const name = expr.memberName;
                if (["call", "delegatecall", "staticcall", "transfer", "send"].includes(name)) {
                    calls.push({
                        type: name,
                        target: expr.expression?.name || "unknown",
                        valueExpression,
                    });
                }
            }
        },
    });
    return calls;
}
/**
 * BARU: cari posisi byte STATEMENT (bukan node FunctionCall-nya doang!)
 * yang PERTAMA kali ngandung external call — dibutuhin buat splice
 * assert() SEBELUM baris itu.
 *
 * PENTING kenapa harus level statement, bukan level FunctionCall node:
 * kalau external call-nya nyempil di tengah expression (misal
 * "(bool success,) = msg.sender.call{value: amount}("")" — FunctionCall
 * node-nya ada DI TENGAH statement, bukan di awal), splice pas di posisi
 * node FunctionCall bakal motong statement itu di tengah jadi syntax
 * error. Splice di awal STATEMENT-nya aman karena itu emang boundary
 * yang valid buat nyisipin statement baru (assert()) sebelumnya.
 */
function findExternalCallStatementRange(body) {
    if (!body || !Array.isArray(body.statements))
        return undefined;
    for (const stmt of body.statements) {
        let hasExternalCall = false;
        visit(stmt, {
            FunctionCall(node) {
                let expr = node.expression;
                if (expr?.type === "NameValueExpression") {
                    expr = expr.expression;
                }
                if (expr?.type === "MemberAccess") {
                    const name = expr.memberName;
                    if (["call", "delegatecall", "staticcall", "transfer", "send"].includes(name)) {
                        hasExternalCall = true;
                    }
                }
            },
        });
        if (hasExternalCall && stmt.range) {
            return [stmt.range[0], stmt.range[1]];
        }
    }
    return undefined;
}
function extractKeys(node) {
    const keys = [];
    while (node?.type === "IndexAccess") {
        keys.unshift(expressionToString(node.index));
        node = node.base;
    }
    return keys;
}
function isAssignmentTarget(node, parent) {
    return (parent?.type === "BinaryOperation" &&
        parent.left === node &&
        parent.operator === "=");
}
function isIndexAccessBase(node, parent) {
    return parent?.type === "IndexAccess" && parent.base === node;
}
function collectPureAssignmentTargetNodes(body) {
    const excluded = new Set();
    if (!body)
        return excluded;
    visit(body, {
        BinaryOperation(node) {
            if (node.operator !== "=")
                return;
            let current = node.left;
            while (current?.type === "IndexAccess") {
                excluded.add(current);
                current = current.base;
            }
            if (current)
                excluded.add(current);
        },
    });
    return excluded;
}
function addRead(variable, keys, seen, reads) {
    const id = `${variable}:${keys.join("|")}`;
    if (seen.has(id))
        return;
    seen.add(id);
    reads.push({ variable, keys });
}
function extractStateAccess(body, stateVariables, parameters) {
    const reads = [];
    const seenReads = new Set();
    const writes = [];
    const stateNames = new Set(stateVariables.map((v) => v.name));
    const parameterNames = new Set(parameters);
    if (!body)
        return { reads: [], writes: [] };
    const excludedFromReads = collectPureAssignmentTargetNodes(body);
    visit(body, {
        Identifier(node, parent) {
            if (isAssignmentTarget(node, parent))
                return;
            if (isIndexAccessBase(node, parent))
                return;
            if (excludedFromReads.has(node))
                return;
            if (stateNames.has(node.name))
                addRead(node.name, [], seenReads, reads);
        },
        BinaryOperation(node) {
            if (!ASSIGNMENT_OPERATORS.has(node.operator))
                return;
            let variable;
            if (node.left.type === "Identifier" &&
                stateNames.has(node.left.name) &&
                !parameterNames.has(node.left.name)) {
                variable = node.left.name;
            }
            if (node.left.type === "IndexAccess") {
                let current = node.left;
                const keys = [];
                while (current.type === "IndexAccess") {
                    keys.unshift(expressionToString(current.index));
                    current = current.base;
                }
                if (current.type === "Identifier" && stateNames.has(current.name)) {
                    const writeVar = current.name;
                    writes.push({
                        variable: writeVar,
                        keys,
                        operation: node.operator,
                        value: expressionToString(node.right),
                    });
                    return;
                }
            }
            if (!variable)
                return;
            writes.push({
                variable,
                operation: node.operator,
                value: expressionToString(node.right),
                keys: extractKeys(node.left),
            });
        },
        UnaryOperation(node) {
            if (node.subExpression?.type === "Identifier" &&
                stateNames.has(node.subExpression.name)) {
                writes.push({
                    variable: node.subExpression.name,
                    operation: node.operator,
                    value: "1",
                    keys: [],
                });
            }
            if (node.subExpression?.type === "IndexAccess" &&
                node.subExpression.base?.type === "Identifier" &&
                stateNames.has(node.subExpression.base.name)) {
                writes.push({
                    variable: node.subExpression.base.name,
                    operation: node.operator,
                    value: "1",
                    keys: extractKeys(node.subExpression),
                });
            }
        },
        IndexAccess(node, parent) {
            if (isAssignmentTarget(node, parent))
                return;
            if (excludedFromReads.has(node))
                return;
            let current = node;
            const keys = [];
            while (current.type === "IndexAccess") {
                keys.unshift(expressionToString(current.index));
                current = current.base;
            }
            if (current.type === "Identifier" && stateNames.has(current.name)) {
                addRead(current.name, keys, seenReads, reads);
            }
        },
    });
    return { reads, writes };
}
function extractRequireConditions(body) {
    const requires = [];
    if (!body)
        return requires;
    visit(body, {
        FunctionCall(node) {
            if (node.expression?.type === "Identifier" &&
                node.expression.name === "require") {
                requires.push({ expression: expressionToString(node.arguments?.[0]) });
            }
        },
    });
    return requires;
}
function expressionToString(node) {
    if (!node)
        return "<expr>";
    switch (node.type) {
        case "Identifier":
            return node.name;
        case "NumberLiteral":
            return node.number;
        case "BooleanLiteral":
            return String(node.value);
        case "StringLiteral":
            return `"${node.value}"`;
        case "HexLiteral":
            return node.value;
        case "DecimalNumber":
            return node.value;
        case "MemberAccess":
            return `${expressionToString(node.expression)}.${node.memberName}`;
        case "IndexAccess":
            return `${expressionToString(node.base)}[${expressionToString(node.index)}]`;
        case "BinaryOperation":
            return `${expressionToString(node.left)} ${node.operator} ${expressionToString(node.right)}`;
        case "UnaryOperation":
            return node.isPrefix
                ? `${node.operator}${expressionToString(node.subExpression)}`
                : `${expressionToString(node.subExpression)}${node.operator}`;
        case "Conditional":
            return `${expressionToString(node.condition)} ? ${expressionToString(node.trueExpression)} : ${expressionToString(node.falseExpression)}`;
        case "FunctionCall":
            return `${expressionToString(node.expression)}(${(node.arguments || []).map(expressionToString).join(", ")})`;
        case "NameValueExpression":
            return expressionToString(node.expression);
        case "PayableConversionExpression":
            return `payable(${expressionToString(node.expression)})`;
        case "FunctionCallOptions":
            return `${expressionToString(node.expression)}{...}`;
        case "TupleExpression":
            return `(${(node.components || []).map((c) => (c ? expressionToString(c) : "")).join(", ")})`;
        case "ArrayExpression":
            return `[${(node.elements || []).map(expressionToString).join(", ")}]`;
        case "NewExpression":
            return `new ${expressionToString(node.typeName)}`;
        case "ElementaryTypeNameExpression":
            return node.typeName?.name ?? "<type>";
        case "ElementaryTypeName":
            return node.name;
        case "UserDefinedTypeName":
            return node.namePath;
        case "ArrayTypeName":
            return `${expressionToString(node.baseTypeName)}[]`;
        case "Mapping":
            return `mapping(${expressionToString(node.keyType)} => ${expressionToString(node.valueType)})`;
        case "Assignment":
            return `${expressionToString(node.left)} ${node.operator} ${expressionToString(node.right)}`;
        case "AssemblyCall":
            return "<assembly>";
        default:
            return `<${node.type}>`;
    }
}
/**
 * BARU: sanitasi karakter whitespace Unicode "aneh" (non-breaking space,
 * em/en space, BOM, dst) jadi ASCII biasa sebelum di-parse.
 *
 * KENAPA INI PENTING: @solidity-parser/parser (ANTLR-based lexer) cuma
 * kenal whitespace ASCII standar (spasi 0x20, tab, newline). Kalau source
 * code punya karakter whitespace Unicode non-standar — SERING KEJADIAN
 * kalau kode di-copy-paste dari rich text editor / chat interface / web
 * page yang diam-diam nge-render spasi biasa jadi non-breaking space
 * (U+00A0) — parser bakal gagal total dengan error yang membingungkan
 * ("token recognition error at: ' '" di HAMPIR SEMUA baris), padahal
 * kodenya keliatan valid pas dibaca manusia.
 *
 * Fix ini normalize di level SOURCE STRING sebelum masuk parser, jadi
 * nggak peduli darimana asal file-nya (upload, copy-paste, API request),
 * selama isinya VALID Solidity secara visual, tetep bisa ke-parse.
 */
function sanitizeSourceCode(code) {
    return code
        .replace(/^\uFEFF/, "") // strip BOM di awal file kalau ada
        .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ") // aneka Unicode space -> ASCII space
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, ""); // zero-width space/joiner -> hapus total (bukan diganti spasi)
}
export function parseSolidityFiles(files) {
    const summaries = [];
    for (const [fileName, rawCode] of Object.entries(files)) {
        const code = sanitizeSourceCode(rawCode);
        try {
            const ast = parse(code, { loc: true, range: true });
            for (const node of ast.children) {
                if (node.type !== "ContractDefinition")
                    continue;
                const contractName = node.name;
                const stateVariables = [];
                const functions = [];
                for (const raw of node.subNodes) {
                    const subNode = raw;
                    if (subNode.type === "StateVariableDeclaration") {
                        for (const variable of subNode.variables) {
                            const resolved = resolveTypeName(variable.typeName);
                            const rawVisibility = variable.visibility || "internal";
                            const visibility = rawVisibility === "default" ? "internal" : rawVisibility;
                            stateVariables.push({
                                name: variable.name || "unnamed",
                                type: resolved.type,
                                isMapping: resolved.isMapping,
                                visibility,
                                isConstant: variable.isDeclaredConst || false,
                            });
                        }
                    }
                }
                for (const raw of node.subNodes) {
                    const subNode = raw;
                    if (subNode.type !== "FunctionDefinition")
                        continue;
                    const requires = extractRequireConditions(subNode.body);
                    const funcName = subNode.isConstructor
                        ? "constructor"
                        : subNode.isReceiveEther
                            ? "receive"
                            : subNode.isFallback
                                ? "fallback"
                                : subNode.name || "unnamed";
                    const parameters = (subNode.parameters || []).map((p) => ({
                        name: p.name || "unnamed",
                        type: resolveTypeName(p.typeName).type,
                    }));
                    const returns = (subNode.returnParameters || []).map((p) => ({
                        name: p.name || "unnamed",
                        type: resolveTypeName(p.typeName).type,
                    }));
                    const access = extractStateAccess(subNode.body, stateVariables, parameters.map((p) => p.name));
                    const externalCalls = extractExternalCalls(subNode.body);
                    const externalCallStatementRange = findExternalCallStatementRange(subNode.body);
                    const modifiers = (subNode.modifiers || []).map((m) => m.name);
                    const emits = extractEventEmits(subNode.body);
                    const bodyRange = subNode.body?.range
                        ? [subNode.body.range[0], subNode.body.range[1]]
                        : undefined;
                    functions.push({
                        name: funcName,
                        visibility: subNode.visibility || "public",
                        isStateModifying: subNode.stateMutability !== "view" &&
                            subNode.stateMutability !== "pure",
                        stateMutability: subNode.stateMutability || "nonpayable",
                        payable: subNode.stateMutability === "payable",
                        parameters,
                        returns,
                        reads: access.reads,
                        writes: access.writes,
                        externalCalls,
                        modifiers,
                        requires,
                        emits,
                        bodyRange,
                        externalCallStatementRange,
                    });
                }
                summaries.push({
                    fileName,
                    contractName,
                    stateVariables,
                    functions,
                    externalCalls: functions.some((f) => f.externalCalls.length > 0),
                    sourceCode: code,
                });
            }
        }
        catch (error) {
            console.error(`[AST Parse Error] ${fileName}`, error);
        }
    }
    return summaries;
}
//# sourceMappingURL=parser.js.map