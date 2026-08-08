import Anthropic from "@anthropic-ai/sdk";
import type { ContractSummary } from "../types/index.js";

let clientInstance: Anthropic | null = null;

function getClaudeClient(): Anthropic {
  if (!clientInstance) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is missing in .env file!",
      );
    }
    clientInstance = new Anthropic({ apiKey });
  }
  return clientInstance;
}

// Model & Token Limiter (Ubah ke claude-3-5-haiku-20241022 untuk opsi paling murah & cepat)
const MODEL_NAME = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1500; // Limit output token agar hemat cost

interface AssertionSet {
  before: string[];
  asserts: string[];
  beforeExternalCall: string[];
}

export interface GeneratedAssertions {
  functions: Record<string, AssertionSet>;
}

function buildSystemPrompt(contract: ContractSummary): string {
  const stateVarList = contract.stateVariables
    .map((v) => `  - ${v.type} ${v.name}${v.isMapping ? " (mapping)" : ""}`)
    .join("\n");

  const functionList = contract.functions
    .filter(
      (f) =>
        f.name !== "constructor" &&
        (f.visibility === "external" || f.visibility === "public"),
    )
    .map((f) => {
      const params = f.parameters.map((p) => `${p.type} ${p.name}`).join(", ");
      const writesInfo = f.writes.length
        ? `\n      writes: ${f.writes.map((w) => `${w.variable}${w.keys.length ? "[" + w.keys.join("][") + "]" : ""} ${w.operation}${w.value}`).join(", ")}`
        : "";
      const externalCallInfo = f.externalCalls.length
        ? `\n      external calls: ${f.externalCalls.map((c) => `${c.type}(${c.target})${c.valueExpression ? ` [TRANSFERRED VALUE: ${c.valueExpression}]` : ""}`).join(", ")}`
        : "";
      return `  - ${f.name}(${params})${writesInfo}${externalCallInfo}`;
    })
    .join("\n");

  return `Kamu adalah Senior Formal Verification Engineer, spesialis SolCMC (Solidity Model Checker, engine CHC bawaan solc).

TUGAS: generate assert() statement Solidity buat contract "${contract.contractName}", fokus ke 3 invariant:
1. State Contention — banyak transaksi paralel berebut mengubah state yang sama.
2. Race Condition — hasil eksekusi bergantung urutan transaksi yang tidak terjamin.
3. Reentrancy — SolCMC OTOMATIS explore reentrant call scenario by default, assert kamu cukup ngecek KONSISTENSI state yang seharusnya terjaga meskipun ada reentrant call di tengah eksekusi.

STATE VARIABLES yang BENERAN ADA (jangan pernah reference di luar ini):
${stateVarList}

FUNCTIONS yang BENERAN ADA (jangan pernah reference function/parameter di luar ini):
${functionList}

ATURAN PALING PENTING — POSISI ASSERT SANGAT MENENTUKAN AKURASI:
- Assert yang ngecek "apakah state berubah SESUAI value yang beneran ditransfer" WAJIB ditaro SEBELUM external call — pakai field "beforeExternalCall", BUKAN "asserts".

⚠️ ATURAN PALING KRITIS — SUMBER ANGKA BUAT ASSERT INI WAJIB DARI "[TRANSFERRED VALUE: ...]" DI DAFTAR "external calls", **BUKAN** DARI "writes: ...".

CONTOH FORMAT OUTPUT YANG BENER (JSON MURNI TANPA MARKDOWN FENCE):
{
  "functions": {
    "withdraw": {
      "before": ["uint256 __before_x = balances[msg.sender];"],
      "beforeExternalCall": ["assert(balances[msg.sender] == __before_x - amount);"],
      "asserts": []
    }
  }
}

ATURAN OUTPUT (WAJIB):
- Balas HANYA dengan JSON valid, tanpa teks lain, TANPA markdown block/fence.
- "before", "beforeExternalCall", dan "asserts" WAJIB syntax Solidity valid.
- msg.sender/msg.value dipakai APA ADANYA.
- Nama variable "before" HARUS unique per function, prefix "__before_".
- Kalau function nggak ada assert yang genuinely meaningful buat digenerate, OMIT function itu dari output.`;
}

/**
 * Generate assertions pertama kali (single-shot).
 */
export async function generateSolCMCAssertions(
  contract: ContractSummary,
): Promise<GeneratedAssertions> {
  const client = getClaudeClient();
  const userPrompt = `Generate assertion JSON buat contract "${contract.contractName}" sesuai aturan di system prompt.`;

  const response = await client.messages.create({
    model: MODEL_NAME,
    max_tokens: MAX_TOKENS,
    temperature: 0.0,
    system: buildSystemPrompt(contract),
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawText =
    response.content[0].type === "text" ? response.content[0].text : "";
  return parseAssertionsJSON(rawText);
}

/**
 * Retry generate assertions dengan feedback error.
 */
export async function regenerateSolCMCAssertionsWithFeedback(
  contract: ContractSummary,
  previousRaw: string,
  errorFeedback: string,
): Promise<GeneratedAssertions> {
  const client = getClaudeClient();

  const userPrompt = `Generate assertion JSON buat contract "${contract.contractName}" sesuai aturan di system prompt.`;

  const retryPrompt = `Output JSON kamu sebelumnya GAGAL divalidasi dengan error berikut:

${errorFeedback}

Ini output kamu sebelumnya:
${previousRaw}

Perbaiki. Cek lagi daftar state variables/functions yang BENERAN ADA di system prompt — jangan reference apapun di luar itu. Balas HANYA JSON yang sudah diperbaiki, format sama persis, tanpa markdown fence.`;

  const response = await client.messages.create({
    model: MODEL_NAME,
    max_tokens: MAX_TOKENS,
    temperature: 0.0,
    system: buildSystemPrompt(contract),
    messages: [
      { role: "user", content: userPrompt },
      { role: "assistant", content: previousRaw },
      { role: "user", content: retryPrompt },
    ],
  });

  const rawText =
    response.content[0].type === "text" ? response.content[0].text : "";
  return parseAssertionsJSON(rawText);
}

function parseAssertionsJSON(raw: string): GeneratedAssertions {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Claude nggak balikin JSON valid: ${(e as Error).message}\nRaw: ${cleaned}`,
    );
  }

  if (!parsed.functions || typeof parsed.functions !== "object") {
    throw new Error(
      `JSON dari Claude nggak punya field "functions" yang valid.\nRaw: ${cleaned}`,
    );
  }

  return parsed as GeneratedAssertions;
}

/**
 * Menerjemahkan hasil counterexample SolCMC ke penjelasan manusia.
 */
export async function explainSolCMCFailure(
  contractCode: string,
  instrumentedCode: string,
  specificTarget: { location: string; message: string },
): Promise<string> {
  const client = getClaudeClient();
  const systemPrompt = `You are a Senior Smart Contract Auditor specializing in formal verification with SolCMC (Solidity's built-in Model Checker).

Explain in CLEAR, CONCISE, HUMAN-READABLE ENGLISH (1 paragraph) EXACTLY why THIS ONE SPECIFIC verification target failed — the one given in "Specific Failed Target" below, nothing else.

CRITICAL RULES:
- ONLY explain the ONE target given.
- Do NOT output Markdown code blocks or JSON. Just natural text, 1 paragraph.`;

  const userPrompt = `Original Contract Source:
${contractCode}

Instrumented Source:
${instrumentedCode}

=== Specific Failed Target ===
Location: ${specificTarget.location}
Message: ${specificTarget.message}`;

  try {
    const response = await client.messages.create({
      model: MODEL_NAME,
      max_tokens: 300, // Di-limit kecil karena hanya butuh 1 paragraf penjelasan
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : "";
    return (
      text ||
      `Verification failed at ${specificTarget.location}: ${specificTarget.message}`
    );
  } catch (err) {
    return `Verification failed at ${specificTarget.location}: ${specificTarget.message}`;
  }
}
