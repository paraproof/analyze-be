import type { VerifyStatusResponse, VerifyRequest } from "../types/index.js";
export declare function createJob(request: VerifyRequest): {
    jobId: string;
    createdAt: string;
};
export declare function getJob(jobId: string): VerifyStatusResponse | undefined;
export declare function getJobFiles(jobId: string): VerifyRequest | undefined;
//# sourceMappingURL=jobStore.d.ts.map