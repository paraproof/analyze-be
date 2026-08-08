import { type Request, type Response } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { registryAbi } from "./abi/VerificationRegistry.js";
import {
  publicClient,
  walletClient,
  monadTestnet,
} from "./abi/viemIntegration.js";
import { getJob, getJobFiles } from "../services/jobStore.js";
import fs from "fs";
import path from "path";
import { keccak256, toHex } from "viem";

const execAsync = promisify(exec);

function parseForgeOutput(stdout: string) {
  const addressMatch = stdout.match(/Deployed to:\s+(0x[a-fA-F0-9]{40})/);
  const txHashMatch = stdout.match(/Transaction hash:\s+(0x[a-fA-F0-9]{64})/);

  if (!addressMatch || !txHashMatch) {
    throw new Error(`Gagal parse output forge create. Output:\n${stdout}`);
  }

  return {
    contractAddress: addressMatch[1] as `0x${string}`,
    txHash: txHashMatch[1] as `0x${string}`,
  };
}

export async function handleDeploy(req: Request, res: Response) {
  const { job_id, contract_name } = req.body;

  // 1. Ambil job & files dari in-memory jobStore
  const job = getJob(job_id);
  const jobFiles = getJobFiles(job_id);

  if (!job || !jobFiles) {
    return res.status(404).json({
      status: "FAILED",
      error: {
        code: "VERIFY_JOB_NOT_FOUND",
        message: `job_id '${job_id}' tidak ditemukan`,
      },
    });
  }

  // 2. Validasi status WAJIB 'PASSED'
  if (job.status !== "PASSED") {
    return res.status(409).json({
      status: "FAILED",
      error: {
        code: "VERIFY_NOT_PASSED",
        message: `job_id '${job_id}' statusnya '${job.status}', bukan 'PASSED'. Deploy ditolak.`,
      },
    });
  }

  // 3. Persiapkan temporary directory untuk forge create (Pakai Source File Asli)
  const deployDir = path.join(process.cwd(), "tmp", "deploys", job_id);

  try {
    fs.mkdirSync(path.join(deployDir, "src"), { recursive: true });
    for (const [relativePath, content] of Object.entries(jobFiles.files)) {
      const fullPath = path.join(deployDir, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
  } catch (fsErr: any) {
    return res.status(500).json({
      status: "FAILED",
      error: {
        code: "INTERNAL_ERROR",
        message: `Gagal menyiapkan folder deploy: ${fsErr.message}`,
      },
    });
  }

  // 4. STEP 1: Deploy Contract User via forge create
  let deployedAddress: `0x${string}`;
  let deployTxHash: `0x${string}`;

  try {
    const command = `forge create src/${jobFiles.entry_point}:${contract_name} --rpc-url ${process.env.MONAD_RPC_URL} --private-key ${process.env.VERIFIER_PRIVATE_KEY} --broadcast`;
    const { stdout } = await execAsync(command, { cwd: deployDir });

    const parsed = parseForgeOutput(stdout);
    deployedAddress = parsed.contractAddress;
    deployTxHash = parsed.txHash;
  } catch (forgeErr: any) {
    return res.status(500).json({
      status: "FAILED",
      error: {
        code: "FORGE_CREATE_FAILED",
        message: `forge create failed: ${forgeErr.message || forgeErr}`,
      },
    });
  } finally {
    // Cleanup temporary deploy folder
    fs.rmSync(deployDir, { recursive: true, force: true });
  }

  const explorerBase = monadTestnet.blockExplorers.default.url;
  const baseResponse = {
    contract_address: deployedAddress,
    tx_hash: deployTxHash,
    explorer_url: `${explorerBase}/address/${deployedAddress}`,
    deployed_at: new Date().toISOString(),
  };

  // 5. STEP 2: Record Verification On-Chain ke VerificationRegistry
  try {
    // Hitung bytes32 specHash dari instrumented source (job.spec)
    const specHash = job.spec
      ? keccak256(toHex(job.spec))
      : keccak256(toHex("NO_SPEC"));

    // Format tuple InvariantResult[] untuk Solidity
    const invariantsPayload = (job.invariants_checked || []).map(
      (inv: any) => ({
        name: inv.name || inv.function || "unnamed_invariant",
        passed: inv.result === "PASSED" || inv.passed === true,
      }),
    );

    // Panggil registry.recordVerification
    const { request } = await publicClient.simulateContract({
      address: process.env.VERIFICATION_REGISTRY_ADDRESS as `0x${string}`,
      abi: registryAbi,
      functionName: "recordVerification",
      args: [deployedAddress, specHash, invariantsPayload],
      account: walletClient.account,
    });

    const registryTxHash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: registryTxHash });

    return res.status(200).json({
      status: "SUCCESS",
      ...baseResponse,
      registry_tx_hash: registryTxHash,
      registry_explorer_url: `${explorerBase}/tx/${registryTxHash}`,
    });
  } catch (registryErr: any) {
    // Skenario PARTIAL_SUCCESS jika Step 1 sukses tapi Step 2 gagal
    return res.status(200).json({
      status: "PARTIAL_SUCCESS",
      ...baseResponse,
      registry_error: {
        code: "REGISTRY_RECORD_FAILED",
        message: `Gagal mencatat verifikasi ke registry on-chain: ${registryErr.shortMessage || registryErr.message}`,
      },
    });
  }
}
