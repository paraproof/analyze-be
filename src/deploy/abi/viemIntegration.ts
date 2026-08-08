import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

// Setup Monad Testnet custom chain definition
export const monadTestnet = defineChain({
  id: 10143, // sesuaikan dengan chain ID Monad Testnet
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "MonadExplorer",
      url: "https://testnet.monadexplorer.com",
    },
  },
});

const account = privateKeyToAccount(
  process.env.VERIFIER_PRIVATE_KEY as `0x${string}`,
);

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
});

export const walletClient = createWalletClient({
  account,
  chain: monadTestnet,
  transport: http(),
});
