import { describe, expect, it } from "vitest";
import { parseSolidityFiles } from "../../src/services/parser";

describe("Solidity Parser Golden Test", () => {
  it("should generate stable contract summary", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `

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

      `,
    });

    expect(result).toMatchSnapshot();
  });

  it("should generate more relevant certora", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `

      pragma solidity ^0.8.20;
      
        contract ERC20Like {

    mapping(address => uint256) balances;

    mapping(address => mapping(address => uint256))
        allowance;


    address owner;


    event Transfer(
        address indexed from,
        address indexed to,
        uint256 amount
    );


    constructor() {
        owner = msg.sender;
    }


    function transfer(
        address to,
        uint256 amount
    )
        external
        returns(bool)
    {

        require(
            msg.sender != address(0)
        );


        require(
            balances[msg.sender] >= amount
        );


        balances[msg.sender] -= amount;

        balances[to] += amount;


        emit Transfer(
            msg.sender,
            to,
            amount
        );


        return true;
    }


    function approve(
        address spender,
        uint256 amount
    )
        external
    {

        allowance[msg.sender][spender]
            = amount;

    }

}
        `,
    });

    expect(result).toMatchSnapshot();
  });
});
