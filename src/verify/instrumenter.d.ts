import type { ContractSummary } from "../types/index.js";
import type { GeneratedAssertions } from "./ai.js";
export interface InjectedLineRange {
    start: number;
    end: number;
    kind: "before" | "beforeExternalCall" | "asserts";
    functionName: string;
}
export interface InstrumentWithLLMResult {
    instrumentedSource: string;
    warnings: string[];
    injectedAssertCount: number;
    injectedLineRanges: InjectedLineRange[];
}
/**
 * [SOLID] Validasi assertions dari Groq SEBELUM di-splice — cek identifier
 * mencurigakan. Return list warning (kosong kalau semua bersih).
 */
export declare function validateAssertions(contract: ContractSummary, assertions: GeneratedAssertions): string[];
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
export declare function spliceAssertions(contract: ContractSummary, assertions: GeneratedAssertions): InstrumentWithLLMResult;
/**
 * [SOLID] Re-parse hasil instrumentasi buat validasi GRAMMAR (bukan
 * semantik). Ini GRATIS, nggak butuh solc, cuma nangkep syntax error.
 */
export declare function checkSyntaxValid(instrumentedSource: string): {
    valid: boolean;
    error?: string;
};
//# sourceMappingURL=instrumenter.d.ts.map