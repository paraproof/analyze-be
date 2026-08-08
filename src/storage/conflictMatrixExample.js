/**
 * Example: Using Conflict Matrix to Analyze a DeFi Contract
 *
 * Scenario: Staking contract dengan functions: stake, unstake, claim
 * Question: Kalau seribu user call ini bersamaan, siapa yang abort?
 *
 * Run dengan:
 *   npx ts-node conflictMatrixExample.ts
 */
import { parseSolidityFiles } from "../verify/parser.js";
import { buildConflictMatrix, formatConflictMatrixTable, formatConflictMatrixDetailed, analyzeParallelRisk, } from "./conflictMatrix.js";
import { formatStorageLayout } from "./storageLayout.js";
// Example DeFi contract
const exampleContract = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract StakingPool {
    // State variables
    mapping(address => uint256) public stakedAmount;
    mapping(address => uint256) public lastClaimTime;
    
    uint256 public totalStaked;
    uint256 public rewardRate = 100; // wei per second
    
    // Stake function: add to stakedAmount and totalStaked
    function stake() external payable {
        require(msg.value > 0, "Must stake ETH");
        stakedAmount[msg.sender] += msg.value;
        totalStaked += msg.value;
        lastClaimTime[msg.sender] = block.timestamp;
    }
    
    // Unstake function: remove from stakedAmount and totalStaked
    function unstake(uint256 amount) external {
        require(stakedAmount[msg.sender] >= amount, "Insufficient stake");
        stakedAmount[msg.sender] -= amount;
        totalStaked -= amount;
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }
    
    // Claim function: read only, no write conflicts
    function claim() external {
        uint256 reward = calculateReward(msg.sender);
        lastClaimTime[msg.sender] = block.timestamp;
        (bool success,) = msg.sender.call{value: reward}("");
        require(success, "Reward transfer failed");
    }
    
    // Helper view function
    function calculateReward(address user) public view returns (uint256) {
        uint256 timeStaked = block.timestamp - lastClaimTime[user];
        return (stakedAmount[user] * rewardRate * timeStaked) / 1e18;
    }
}
`;
async function main() {
    console.log("Analyzing StakingPool contract for storage conflicts...\n");
    // Parse the contract
    const summaries = parseSolidityFiles({
        "StakingPool.sol": exampleContract,
    });
    if (summaries.length === 0) {
        console.error("Failed to parse contract");
        return;
    }
    const contract = summaries[0];
    console.log(`Contract: ${contract.contractName}`);
    console.log(`File: ${contract.fileName}`);
    console.log(`State variables: ${contract.stateVariables.length}`);
    console.log(`Functions: ${contract.functions.length}\n`);
    // Display storage layout
    const { formatStorageLayout: fmt } = await import("./storageLayout.js");
    console.log(fmt(contract.stateVariables));
    // Build conflict matrix
    const conflictMatrix = buildConflictMatrix(contract);
    // Display as table
    console.log(formatConflictMatrixTable(conflictMatrix));
    // Display detailed analysis
    console.log(formatConflictMatrixDetailed(conflictMatrix));
    // Analyze parallel risk scenarios
    console.log("\n--- Parallel Execution Risk Analysis ---\n");
    // Scenario 1: 1000 users all stake simultaneously
    console.log("Scenario 1: 1000 users all stake()");
    const risk1 = analyzeParallelRisk(conflictMatrix, [
        { function: "stake", count: 1000 },
    ]);
    console.log(`Risk Level: ${risk1.riskLevel}`);
    console.log(`Analysis: ${risk1.analysis}\n`);
    // Scenario 2: 500 stake + 500 unstake simultaneously
    console.log("Scenario 2: 500 users stake() + 500 users unstake()");
    const risk2 = analyzeParallelRisk(conflictMatrix, [
        { function: "stake", count: 500 },
        { function: "unstake", count: 500 },
    ]);
    console.log(`Risk Level: ${risk2.riskLevel}`);
    console.log(`Analysis: ${risk2.analysis}\n`);
    // Scenario 3: 1000 stake + 1000 claim simultaneously
    console.log("Scenario 3: 1000 users stake() + 1000 users claim()");
    const risk3 = analyzeParallelRisk(conflictMatrix, [
        { function: "stake", count: 1000 },
        { function: "claim", count: 1000 },
    ]);
    console.log(`Risk Level: ${risk3.riskLevel}`);
    console.log(`Analysis: ${risk3.analysis}\n`);
    // Scenario 4: All three functions mixed
    console.log("Scenario 4: 300 stake() + 300 unstake() + 400 claim()");
    const risk4 = analyzeParallelRisk(conflictMatrix, [
        { function: "stake", count: 300 },
        { function: "unstake", count: 300 },
        { function: "claim", count: 400 },
    ]);
    console.log(`Risk Level: ${risk4.riskLevel}`);
    console.log(`Analysis: ${risk4.analysis}\n`);
    // Show matrix details
    console.log("--- Detailed Matrix ---\n");
    for (const cell of conflictMatrix.matrix) {
        if (cell.overallSeverity !== "SAFE" || cell.function1 === cell.function2) {
            console.log(`\n${cell.function1}() vs ${cell.function2}(): ${cell.overallSeverity}`);
            console.log(`  Writes in ${cell.function1}:`);
            for (const w of cell.writes1) {
                console.log(`    - ${w.variable}[${w.keys.join("][")}] → slot ${w.computedSlot}`);
            }
            console.log(`  Writes in ${cell.function2}:`);
            for (const w of cell.writes2) {
                console.log(`    - ${w.variable}[${w.keys.join("][")}] → slot ${w.computedSlot}`);
            }
            if (cell.conflicts.length > 0) {
                console.log(`  Conflicts:`);
                for (const c of cell.conflicts) {
                    console.log(`    - ${c.description}`);
                }
            }
        }
    }
}
main().catch(console.error);
//# sourceMappingURL=conflictMatrixExample.js.map