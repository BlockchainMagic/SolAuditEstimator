const fs = require("fs");
const solc = require("solc");
const https = require("https");

const {
  getSolidityVersion,
  calculateBaseTime,
  detectUpgradeable,
  calculateComplexityTime,
  estimateUpgradeabilityComplexity,
  compileContract,
  getFullVersion,
} = require("./lib/auditEstimator");

jest.mock("fs");
jest.mock("https", () => {
  return { get: jest.fn() };
});

describe("Estimate audit time", () => {
  describe("getSolidityVersion", () => {
    it("extracts the Solidity version from the contract source", () => {
      const contractSource = "pragma solidity ^0.8.0;\ncontract MyContract {}";
      expect(getSolidityVersion(contractSource)).toBe("^0.8.0");
    });
  });

  describe("calculateBaseTime", () => {
    it("returns base time for small contracts", () => {
      expect(calculateBaseTime(100)).toBe(5);
    });

    it("returns base time for medium contracts", () => {
      expect(calculateBaseTime(500)).toBe(20);
    });

    it("returns base time for large contracts", () => {
      expect(calculateBaseTime(2000)).toBe(50);
    });
  });

  describe("detectUpgradeable", () => {
    it("detects upgradeable features in the contract source", () => {
      const contractSource = "function delegatecall() external {}";
      expect(detectUpgradeable(contractSource)).toBeTruthy();
    });

    it("returns false if no upgradeable features detected", () => {
      const contractSource = "function myFunc() external {}";
      expect(detectUpgradeable(contractSource)).toBeFalsy();
    });
  });

  describe("calculateComplexityTime", () => {
    // Mocked contract for simplicity; expand as necessary
    const contractSource =
      'import "otherContract.sol";\nfunction externalFunction() external {\n.call();\n}\n';
    const compiledContract = {
      MyContract: {
        abi: [
          { type: "function" },
          { type: "function" },
          { type: "function" },
          { type: "function" },
        ],
      },
    };

    it("calculates complexity time", () => {
      expect(
        calculateComplexityTime(contractSource, compiledContract, true)
      ).toBeGreaterThan(0);
    });
  });

  describe("estimateUpgradeabilityComplexity", () => {
    it("estimates upgradeability complexity for upgradeable contracts", () => {
      const contractSource = "function delegatecall() external {}";
      expect(estimateUpgradeabilityComplexity(contractSource)).toBeGreaterThan(
        0
      );
    });

    it("returns 0 for non-upgradeable contracts", () => {
      const contractSource = "function myFunc() external {}";
      expect(estimateUpgradeabilityComplexity(contractSource)).toBe(0);
    });
  });

  describe("getFullVersion", () => {
    beforeEach(() => {
      https.get.mockClear();
    });

    it("returns the full version of Solidity compiler for the contract", async () => {
      const versionShort = "^0.8.0";
      const solcListURL = "https://solc-bin.ethereum.org/bin/list.json";

      const mockData = JSON.stringify({
        releases: {
          [versionShort]: "soljson-v0.8.0+commit.c7dfd78e.js",
        },
      });

      https.get.mockImplementationOnce((url, callback) => {
        callback({
          on: (event, eventCallback) => {
            if (event === "data") {
              eventCallback(mockData);
            }
            if (event === "end") {
              eventCallback();
            }
          },
        });
        return { on: jest.fn() };
      });

      const fullVersion = await getFullVersion(versionShort, solcListURL);
      expect(fullVersion).toBe("v0.8.0+commit.c7dfd78e");
    });
  });

  describe("compileContract", () => {
    it("compiles a contract and returns its output", async () => {
      const contractSource = "pragma solidity ^0.8.0;\ncontract MyContract {}";
      const solidityVersionFull = "v0.8.0+commit.c7dfd78e";
      const optimizerRuns = 0;

      const mockOutput = {
        contracts: {
          "contract.sol": {
            MyContract: {
              abi: [],
            },
          },
        },
      };

      // Mocking the loadRemoteVersion function in solc to return a mock compiler instance
      solc.loadRemoteVersion = jest.fn((version, callback) => {
        callback(null, {
          compile: jest.fn(() => JSON.stringify(mockOutput)),
        });
      });

      const output = await compileContract(
        contractSource,
        solidityVersionFull,
        optimizerRuns
      );
      expect(output).toEqual(mockOutput);
    });
  });
});
