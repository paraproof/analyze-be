import { describe, it, expect } from "vitest";
import { parseSolidityFiles } from "../src/services/parser";

describe("Solidity AST Semantic Parser", () => {
  it("should extract contract name and state variables", () => {
    const solidity = `

    pragma solidity ^0.8.20;


    contract MathBugVault {

        mapping(address => uint256) public balances;

        uint256 public totalDeposits;

    }

    `;

    const result = parseSolidityFiles({
      "MathBugVault.sol": solidity,
    });

    expect(result).toHaveLength(1);

    const contract = result[0];

    expect(contract.contractName).toBe("MathBugVault");

    expect(contract.stateVariables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "balances",

          type: "mapping(address => uint256)",

          isMapping: true,
        }),

        expect.objectContaining({
          name: "totalDeposits",

          type: "uint256",
        }),
      ]),
    );
  });

  it("should extract function parameters correctly", () => {
    const solidity = `

    pragma solidity ^0.8.20;


    contract Vault {


        function withdraw(
            uint256 amount
        )
        external
        {

        }


    }

    `;

    const result = parseSolidityFiles({
      "Vault.sol": solidity,
    });

    const withdraw = result[0].functions.find((f) => f.name === "withdraw");

    expect(withdraw).toBeDefined();

    expect(withdraw?.parameters).toEqual([
      {
        name: "amount",
        type: "uint256",
      },
    ]);
  });

  it("should detect state writes on normal variables", () => {
    const solidity = `

    pragma solidity ^0.8.20;


    contract Counter {


        uint256 public count;



        function increment()
        external
        {

            count = count + 1;

        }


    }

    `;

    const result = parseSolidityFiles({
      "Counter.sol": solidity,
    });

    const increment = result[0].functions.find((f) => f.name === "increment");

    expect(increment?.writes).toContainEqual({
      variable: "count",
      operation: "=",
      value: "count + 1",
      keys: [],
    });
  });

  it("should detect mapping writes", () => {
    const solidity = `

    pragma solidity ^0.8.20;


    contract Vault {


        mapping(address=>uint256)
        public balances;



        function deposit()
        external
        {

            balances[msg.sender]
                =
            balances[msg.sender]+msg.value;

        }


    }

    `;

    const result = parseSolidityFiles({
      "Vault.sol": solidity,
    });

    const deposit = result[0].functions.find((f) => f.name === "deposit");

    expect(deposit?.writes.map((w) => w.variable)).toContain("balances");
  });

  it("should detect external calls", () => {
    const solidity = `

    pragma solidity ^0.8.20;


    contract Vault {


        function withdraw(
            uint256 amount
        )
        external
        {

            payable(msg.sender)
                .call{value:amount}("");

        }

    }

    `;

    const result = parseSolidityFiles({
      "Vault.sol": solidity,
    });

    const withdraw = result[0].functions.find((f) => f.name === "withdraw");

    expect(withdraw?.externalCalls.length).toBeGreaterThan(0);

    expect(withdraw?.externalCalls[0].type).toBe("call");
  });

  it("should detect payable functions", () => {
    const solidity = `

    pragma solidity ^0.8.20;


    contract Vault {


        function deposit()
        external
        payable
        {

        }

    }

    `;

    const result = parseSolidityFiles({
      "Vault.sol": solidity,
    });

    const deposit = result[0].functions.find((f) => f.name === "deposit");

    expect(deposit?.payable).toBe(true);
  });

  it("should extract return parameters", () => {
    const solidity = `

    pragma solidity ^0.8.20;


    contract Vault {


        function total()
        external
        view
        returns(uint256 value)
        {

            return 10;

        }

    }

    `;

    const result = parseSolidityFiles({
      "Vault.sol": solidity,
    });

    const total = result[0].functions.find((f) => f.name === "total");

    expect(total?.returns).toEqual([
      {
        name: "value",
        type: "uint256",
      },
    ]);
  });

  it("should extract single require condition", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
      pragma solidity ^0.8.20;

      contract Vault {

        function withdraw(uint256 amount) external {

          require(amount > 0);

        }

      }
      `,
    });

    const withdraw = result[0].functions.find((f) => f.name === "withdraw");

    expect(withdraw?.requires).toEqual([
      {
        expression: "amount > 0",
      },
    ]);
  });

  it("should extract multiple require conditions", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
      pragma solidity ^0.8.20;

      contract Vault {

        mapping(address=>uint256) balances;

        function withdraw(uint256 amount) external {

          require(amount > 0);

          require(
            balances[msg.sender] >= amount
          );

        }

      }
      `,
    });

    const withdraw = result[0].functions.find((f) => f.name === "withdraw");

    expect(withdraw?.requires).toEqual([
      {
        expression: "amount > 0",
      },
      {
        expression: "balances[msg.sender] >= amount",
      },
    ]);
  });

  it("should preserve member access expressions", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
      pragma solidity ^0.8.20;

      contract Vault {

        function foo() external {

          require(msg.sender != address(0));

        }

      }
      `,
    });

    const foo = result[0].functions.find((f) => f.name === "foo");

    expect(foo?.requires).toEqual([
      {
        expression: "msg.sender != address(0)",
      },
    ]);
  });

  it("should detect emitted events", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
    pragma solidity ^0.8.20;

    contract Vault {

      event Deposited(address user,uint256 amount);

      function deposit() external payable {

        emit Deposited(msg.sender,msg.value);

      }

    }
    `,
    });

    const deposit = result[0].functions.find((f) => f.name === "deposit");

    expect(deposit?.emits).toEqual([
      {
        event: "Deposited",
        arguments: ["msg.sender", "msg.value"],
      },
    ]);
  });

  it("should detect simple assignment", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
      pragma solidity ^0.8.20;

      contract Vault {
        uint256 balance;

        function set(uint256 amount) external {
          balance = amount;
        }
      }
      `,
    });

    const fn = result[0].functions.find((f) => f.name === "set");

    expect(fn?.writes).toEqual([
      {
        variable: "balance",
        operation: "=",
        value: "amount",
        keys: [],
      },
    ]);
  });

  it("should detect += operation", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
      pragma solidity ^0.8.20;

      contract Vault {
        uint256 balance;

        function deposit(uint256 amount) external {
          balance += amount;
        }
      }
      `,
    });

    const fn = result[0].functions.find((f) => f.name === "deposit");

    expect(fn?.writes).toEqual([
      {
        variable: "balance",
        operation: "+=",
        value: "amount",
        keys: [],
      },
    ]);
  });

  it("should detect -= operation", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
      pragma solidity ^0.8.20;

      contract Vault {
        uint256 balance;

        function withdraw(uint256 amount) external {
          balance -= amount;
        }
      }
      `,
    });

    const fn = result[0].functions.find((f) => f.name === "withdraw");

    expect(fn?.writes).toEqual([
      {
        variable: "balance",
        operation: "-=",
        value: "amount",
        keys: [],
      },
    ]);
  });

  it("should detect mapping arithmetic", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
      pragma solidity ^0.8.20;

      contract Vault {
        mapping(address => uint256) balances;

        function deposit(uint256 amount) external {
          balances[msg.sender] += amount;
        }
      }
      `,
    });

    const fn = result[0].functions.find((f) => f.name === "deposit");

    expect(fn?.writes).toEqual([
      {
        variable: "balances",
        keys: ["msg.sender"],
        operation: "+=",
        value: "amount",
      },
    ]);
  });

  it("should detect array arithmetic", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
      pragma solidity ^0.8.20;

      contract Vault {
        uint256[] values;

        function foo(uint256 x) external {
          values[0] += x;
        }
      }
      `,
    });

    const fn = result[0].functions.find((f) => f.name === "foo");

    expect(fn?.writes).toEqual([
      {
        variable: "values",
        keys: ["0"],
        operation: "+=",
        value: "x",
      },
    ]);
  });

  it("should detect ++ operation", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
      pragma solidity ^0.8.20;

      contract Vault {
        uint256 counter;

        function inc() external {
          counter++;
        }
      }
      `,
    });

    const fn = result[0].functions.find((f) => f.name === "inc");

    expect(fn?.writes).toEqual([
      {
        variable: "counter",
        operation: "++",
        value: "1",
        keys: [],
      },
    ]);
  });

  it("should detect -- operation", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
      pragma solidity ^0.8.20;

      contract Vault {
        uint256 counter;

        function dec() external {
          counter--;
        }
      }
      `,
    });

    const fn = result[0].functions.find((f) => f.name === "dec");

    expect(fn?.writes).toEqual([
      {
        variable: "counter",
        operation: "--",
        value: "1",
        keys: [],
      },
    ]);
  });

  it("should detect mapping key", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
    pragma solidity ^0.8.20;

    contract Vault {

      mapping(address => uint256) balances;

      function deposit(uint256 amount) external {
        balances[msg.sender] += amount;
      }

    }
    `,
    });

    const deposit = result[0].functions.find((f) => f.name === "deposit");

    expect(deposit?.writes).toContainEqual({
      variable: "balances",
      keys: ["msg.sender"],
      operation: "+=",
      value: "amount",
    });
  });

  it("should detect array index", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
    pragma solidity ^0.8.20;

    contract Vault {

      uint256[] balances;

      function foo(uint256 i,uint256 amount) external {
        balances[i] += amount;
      }

    }
    `,
    });

    const foo = result[0].functions.find((f) => f.name === "foo");

    expect(foo?.writes).toContainEqual({
      variable: "balances",
      keys: ["i"],
      operation: "+=",
      value: "amount",
    });
  });

  it("should detect nested mapping key", () => {
    const result = parseSolidityFiles({
      "Vault.sol": `
    pragma solidity ^0.8.20;

    contract Vault {

      mapping(address => mapping(address => uint256)) allowance;

      function approve(address spender,uint256 amount) external {
        allowance[msg.sender][spender] = amount;
      }

    }
    `,
    });

    const approve = result[0].functions.find((f) => f.name === "approve");

    expect(approve?.writes).toContainEqual({
      variable: "allowance",
      keys: ["msg.sender", "spender"],
      operation: "=",
      value: "amount",
    });
  });
});
