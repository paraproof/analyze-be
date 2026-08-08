export interface VerifyRequest {
    entry_point: string;
    files: Record<string, string>;
}
export type VerifyStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "ERROR";
export interface VerifyJobCreatedResponse {
    job_id: string;
    status: "PENDING";
    created_at: string;
}
export type VerifyStepName = "AST_EXTRACTION" | "SPEC_GENERATION" | "COMPILE_CHECK" | "SOLCMC_VERIFICATION";
export type VerifyStepStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
export interface VerifyStep {
    step: VerifyStepName;
    status: VerifyStepStatus;
}
export type InvariantName = "reentrancy" | "state_contention" | "race_condition";
export type InvariantResult = "PASSED" | "FAILED" | "SKIPPED";
export interface InvariantCheckResult {
    name: InvariantName;
    function: string;
    result: InvariantResult;
    detail?: string;
    /** cuma ada kalau result === "FAILED" */
    counterexample?: Record<string, string>;
    explanation?: string;
}
export type VerifyErrorCode = "COMPILE_FAILED" | "SPEC_GENERATION_FAILED" | "CERTORA_TIMEOUT" | "CERTORA_CRASHED" | "INTERNAL_ERROR";
export interface VerifyErrorInfo {
    code: VerifyErrorCode;
    message: string;
}
export interface VerifyStatusResponse {
    job_id: string;
    status: VerifyStatus;
    created_at: string;
    steps?: VerifyStep[];
    entry_point?: string;
    invariants_checked?: InvariantCheckResult[];
    spec?: string;
    duration_ms?: number;
    completed_at?: string;
    error?: VerifyErrorInfo;
    raw_logs?: string;
}
export interface DeployRequest {
    job_id: string;
    contract_name: string;
}
export interface DeploySuccessResponse {
    status: "SUCCESS";
    contract_address: string;
    tx_hash: string;
    explorer_url: string;
    deployed_at: string;
    registry_tx_hash: string;
    registry_explorer_url: string;
}
/**
 * Kontrak berhasil di-deploy (step 1 OK), tapi gagal dicatet ke
 * VerificationRegistry (step 2 gagal, misal RPC timeout).
 * PENTING: ini BUKAN kegagalan total — contract_address di sini valid
 * dan bisa dipakai, cuma pencatatan on-chain-nya yang belum berhasil.
 * Frontend WAJIB tetep nampilin link "View Contract", jangan treat
 * sebagai error merah total.
 */
export interface DeployPartialSuccessResponse {
    status: "PARTIAL_SUCCESS";
    contract_address: string;
    tx_hash: string;
    explorer_url: string;
    deployed_at: string;
    registry_error: DeployErrorInfo;
}
export type DeployErrorCode = "VERIFY_JOB_NOT_FOUND" | "VERIFY_NOT_PASSED" | "FORGE_CREATE_FAILED" | "REGISTRY_RECORD_FAILED" | "INTERNAL_ERROR";
export interface DeployErrorInfo {
    code: DeployErrorCode;
    message: string;
}
/** Dipakai kalau step 1 (forge create) sendiri yang gagal — kontrak nggak ke-deploy sama sekali */
export interface DeployFailedResponse {
    status: "FAILED";
    error: DeployErrorInfo;
}
export type DeployResponse = DeploySuccessResponse | DeployPartialSuccessResponse | DeployFailedResponse;
export interface GenericErrorResponse {
    error: {
        code: string;
        message: string;
    };
}
export interface SolidityFilesInput {
    [fileName: string]: string;
}
export interface FunctionParameter {
    name: string;
    type: string;
}
export interface FunctionSummary {
    name: string;
    visibility: string;
    isStateModifying: boolean;
    stateMutability: string;
    payable: boolean;
    parameters: FunctionParameter[];
    returns: FunctionParameter[];
    reads: StateReadSummary[];
    writes: StateWriteSummary[];
    externalCalls: ExternalCallSummary[];
    modifiers: string[];
    requires: RequireCondition[];
    emits: EventEmissionSummary[];
    bodyRange?: [number, number];
    externalCallStatementRange?: [number, number];
}
export interface ExternalCallSummary {
    type: "call" | "delegatecall" | "staticcall" | "transfer" | "send" | string;
    target?: string;
}
export interface StateVariableSummary {
    name: string;
    type: string;
    isMapping: boolean;
    visibility: string;
    isConstant: boolean;
}
export interface ContractSummary {
    fileName: string;
    contractName: string;
    stateVariables: StateVariableSummary[];
    functions: FunctionSummary[];
    externalCalls: boolean;
    sourceCode: string;
}
export interface CertoraResult {
    passed: boolean;
    buildFailed: boolean;
    buildErrorMessage?: string;
    rawLogs: string;
    verificationReportUrl?: string;
    invariants: InvariantCheckResult[];
    counterexample?: Record<string, string>;
}
export interface RequireCondition {
    expression: string;
}
export interface EventEmissionSummary {
    event: string;
    arguments: string[];
}
export interface StateWriteSummary {
    variable: string;
    keys: string[];
    operation: string;
    value: string;
}
export interface StateReadSummary {
    variable: string;
    keys: string[];
}
export interface DependencySummary {
    variable: string;
    keys: string[];
    access: "read" | "write";
}
export interface WriteOp {
    variable: string;
    keys: string[];
    operation: "=" | "+=" | "-=" | "*=" | "/=" | string;
    value: string;
}
export interface ReadOp {
    variable: string;
    keys: string[];
}
export interface Param {
    name: string;
    type: string;
}
export interface WriteOp {
    variable: string;
    keys: string[];
    operation: string;
    value: string;
}
export interface ReadOp {
    variable: string;
    keys: string[];
}
export interface StateVariableSummary {
    name: string;
    type: string;
    isMapping: boolean;
    visibility: string;
    isConstant: boolean;
}
export interface InvariantCheckResult {
    name: InvariantName;
    function: string;
    result: "PASSED" | "FAILED" | "SKIPPED";
    source: "generated_assertion" | "solc_builtin" | "reentrancy_check" | "unclassified";
    detail?: string;
    explanation?: string;
    counterexample?: Record<string, string>;
}
export interface AnalyzeRequest {
    sourceCode: string;
    fileName?: string;
}
export interface PortabilityResponse {
    score: number;
    errors: number;
    warnings: number;
    issues: Array<{
        severity: string;
        category: string;
        message: string;
        recommendation: string;
    }>;
}
export interface ParallelizationResponse {
    score: number;
    definiteConflicts: number;
    symbolicConflicts: number;
    matrix: Array<{
        function1: string;
        function2: string;
        severity: string;
    }>;
}
export interface MonadAnalysisResponse {
    success: boolean;
    contractName: string;
    timestamp: string;
    analysis: {
        portability: PortabilityResponse;
        parallelization: ParallelizationResponse;
    };
    score: {
        portability: number;
        parallelization: number;
        combined: number;
    };
    verdict: "READY" | "CAUTION" | "NOT_READY";
    recommendation: string;
}
//# sourceMappingURL=index.d.ts.map