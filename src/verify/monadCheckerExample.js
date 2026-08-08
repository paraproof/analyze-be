/**
 * Example: Using Monad Portability Checker
 *
 * Scenario: Developer ported Ethereum DeFi contract to Monad
 * Question: "Is my contract Monad-compatible?"
 *
 * Run: npx ts-node monadCheckerExample.ts
 */
import { parseSolidityFiles } from "./parser.js";
import { checkMonadCompatibility, formatMonadCompatibilityReport, } from "./monadChecker.js";
// Example 1: Contract with Monad portability issues
const problematicContract = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract GasOptimizedSwap {
    // ❌ Issue 1: Hardcoded gas check
    function swapWithGasCheck() external {
        require(gasleft() > 100000, "Insufficient gas");
        _performSwap();
    }
    
    // ❌ Issue 2: Hardcoded gas for external call
    function callExternalWithFixedGas() external {
        (bool success, ) = address(0x1234).call{gas: 500000}("");
        require(success, "Call failed");
    }
    
    // ❌ Issue 3: Gas refund logic
    function calculateRefund() internal view returns (uint256) {
        // Assumes 21000 intrinsic gas and gas refunds
        uint256 gasUsed = 21000 + gasleft();
        return gasUsed * tx.gasprice;
    }
    
    // ❌ Issue 4: DELEGATECALL for proxy
    function delegateToImplementation(address impl, bytes memory data) external {
        (bool success, ) = impl.delegatecall(data);
        require(success, "Delegatecall failed");
    }
    
    // ❌ Issue 5: CREATE2 pattern
    function deployWithCreate2(bytes32 salt, bytes memory code) external {
        address addr;
        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
        }
    }
    
    // ❌ Issue 6: SELFDESTRUCT (deprecated)
    function emergencyExit() external {
        selfdestruct(payable(msg.sender));
    }
    
    function _performSwap() internal {
        // swap logic
    }
}
`;
// Example 2: Clean contract (Monad-ready)
const monadReadyContract = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SafeSwap {
    // ✅ Dynamic gas checks
    function swapSafely() external {
        uint256 minGas = 50000;
        require(gasleft() > minGas, "Low gas");
        _performSwap();
    }
    
    // ✅ Dynamic gas for external calls
    function callExternalSafely(address target) external {
        uint256 gasLimit = gasleft() - 10000; // Reserve 10k
        (bool success, ) = target.call{gas: gasLimit}("");
        require(success, "Call failed");
    }
    
    // ✅ No gas refund assumptions
    function processTransaction() external {
        // Logic that doesn't depend on refunds
        _performSwap();
    }
    
    // ✅ Uses standard patterns
    function callImplementation(address impl, bytes memory data) external {
        (bool success, bytes memory result) = impl.call(data);
        require(success, "Call failed");
    }
    
    function _performSwap() internal {
        // swap logic
    }
}
`;
async function main() {
    console.log("=== Monad Portability Checker Examples ===\n");
    // Test 1: Problematic contract
    console.log("Test 1: Contract with portability issues");
    console.log("─".repeat(50));
    const problematicSummary = parseSolidityFiles({
        "GasOptimizedSwap.sol": problematicContract,
    });
    if (problematicSummary.length > 0) {
        const report1 = checkMonadCompatibility(problematicSummary[0]);
        console.log(formatMonadCompatibilityReport(report1));
    }
    // Test 2: Clean contract
    console.log("\n\n");
    console.log("Test 2: Monad-ready contract");
    console.log("─".repeat(50));
    const cleanSummary = parseSolidityFiles({
        "SafeSwap.sol": monadReadyContract,
    });
    if (cleanSummary.length > 0) {
        const report2 = checkMonadCompatibility(cleanSummary[0]);
        console.log(formatMonadCompatibilityReport(report2));
    }
    // Test 3: Real-world DeFi pattern
    console.log("\n\n");
    console.log("Test 3: Uniswap-style router (common portability issues)");
    console.log("─".repeat(50));
    const defiContract = `
    pragma solidity ^0.8.20;
    
    contract SwapRouter {
        // Issue: hardcoded gas for swaps
        function swap(uint256 amountIn) external {
            require(gasleft() > 200000, "Gas");  // ❌
            _swap(amountIn);
        }
        
        // Issue: external call with fixed gas
        function executeSwap() external {
            (bool ok, ) = address(this).call{gas: 150000}(
                abi.encodeWithSignature("_swap(uint256)", 100)
            );  // ❌
        }
        
        function _swap(uint256 amount) internal {}
    }
  `;
    const defiSummary = parseSolidityFiles({
        "SwapRouter.sol": defiContract,
    });
    if (defiSummary.length > 0) {
        const report3 = checkMonadCompatibility(defiSummary[0]);
        console.log(formatMonadCompatibilityReport(report3));
    }
    // Test 4: Large contract (code size check)
    console.log("\n\n");
    console.log("Test 4: Code size validation");
    console.log("─".repeat(50));
    let largeContract = `pragma solidity ^0.8.20;\n\ncontract Large {\n`;
    for (let i = 0; i < 100; i++) {
        largeContract += `
      function func${i}() external {
          // Filler code to increase size
          uint256 x = 1;
          uint256 y = 2;
          uint256 z = x + y;
      }
    `;
    }
    largeContract += `\n}`;
    const largeSummary = parseSolidityFiles({
        "Large.sol": largeContract,
    });
    if (largeSummary.length > 0) {
        const report4 = checkMonadCompatibility(largeSummary[0]);
        console.log(formatMonadCompatibilityReport(report4));
    }
    // Summary comparison
    console.log("\n\n");
    console.log("=== Compatibility Score Comparison ===");
    console.log("─".repeat(50));
    const allReports = [
        {
            name: "Problematic Contract",
            report: checkMonadCompatibility(problematicSummary[0]),
        },
        {
            name: "Monad-Ready Contract",
            report: checkMonadCompatibility(cleanSummary[0]),
        },
        { name: "DeFi Router", report: checkMonadCompatibility(defiSummary[0]) },
    ];
    allReports.forEach(({ name, report }) => {
        console.log(`${name}: ${report.score.initial}%`);
        if (report.score.afterFixes) {
            console.log(`  → After fixes: ${report.score.afterFixes}%`);
        }
    });
}
main().catch(console.error);
//# sourceMappingURL=monadCheckerExample.js.map