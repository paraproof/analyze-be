pragma solidity ^0.8.20;

      contract Vault {

        mapping(address => uint256) balances;

        uint256 totalSupply;

        event Deposit(
          address indexed user,
          uint256 amount
        );


        function deposit(uint256 amount)
          external
          payable
          returns(uint256 value)
        {

          require(
            msg.sender != address(0),
            "invalid sender"
          );

          balances[msg.sender] += amount;

          totalSupply += amount;

          emit Deposit(
            msg.sender,
            amount
          );

          value = balances[msg.sender];
        }


        function withdraw(uint256 amount)
          external
        {

          require(
            balances[msg.sender] >= amount
          );

          balances[msg.sender] -= amount;

        }


      }