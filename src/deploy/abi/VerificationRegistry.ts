export const registryAbi = [
  {
    type: "function",
    name: "recordVerification",
    inputs: [
      { name: "contractAddress", type: "address" },
      { name: "specHash", type: "bytes32" },
      {
        name: "invariants",
        type: "tuple[]",
        components: [
          { name: "name", type: "string" },
          { name: "passed", type: "bool" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
