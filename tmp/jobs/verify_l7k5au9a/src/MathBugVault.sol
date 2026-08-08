// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MathBugVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        
        // BUG FATAL: Pengurangan state yang salah! (Harusnya dikurang amount penuh)
        balances[msg.sender] -= (amount / 2);
        
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    function syncTotal() external view returns (uint256) {
        return address(this).balance;
    }
}