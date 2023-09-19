const fs = require("fs");
const solc = require("solc");
const https = require("https");
const path = require("path");

// Default configuration constants for determining the audit time
let config = {
  sizeThresholds: {
    small: 200,
    medium: 1000,
  },
  baseTimes: {
    small: 5,
    medium: 20,
    large: 50,
  },
  complexityFactors: {
    functionTime: 0.5,
    baseFunctionCount: 10,
    externalCallTime: 2,
    importTimePerImport: 3,
    importTimeFlatRate: 5,
    assemblyTime: 3,
    upgradeability: {
      proxyPattern: 3,
      storageLayout: 5,
      adminRights: 2,
      initialization: 2,
      interContractConsistency: 4,
    },
  },
};

// Load configuration from external file if provided
const loadConfigFromFile = (configPath, currentConfig = {}) => {
  try {
    const externalConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return { ...currentConfig, ...externalConfig };
  } catch (error) {
    throw new Error(
      `Error loading external config from ${configPath}: ${error}`
    );
  }
};

// Function to resolve imports within Solidity files
const findImports = (importPath) => {
  const openzeppelinBasePath = "./node_modules/@openzeppelin/";
  let fullPath;

  if (importPath.startsWith("@openzeppelin")) {
    fullPath = path.join(
      openzeppelinBasePath,
      importPath.replace("@openzeppelin/", "")
    );
  } else {
    fullPath = importPath;
  }

  try {
    return { contents: fs.readFileSync(fullPath, "utf8") };
  } catch (err) {
    console.error(`Error reading ${fullPath}:`, err);
    return { error: `Error reading ${fullPath}` };
  }
};

// Extract the Solidity version from the contract source
const getSolidityVersion = (contractSource) => {
  const versionMatch = contractSource.match(
    /^pragma solidity (\^?\d+\.\d+\.\d+);/m
  );
  return versionMatch && versionMatch[1];
};

// Introducing cache for Solidity versions
const solidityVersionCache = {};

// Retrieve the full version of the Solidity compiler for the contract with caching
async function getFullVersion(versionShort, solcListURL) {
  // Use cached value if exists
  if (solidityVersionCache[versionShort]) {
    console.log(`Using cached version for Solidity ${versionShort}...`);
    return Promise.resolve(solidityVersionCache[versionShort]);
  }

  console.log(`Resolving full version for Solidity ${versionShort}...`);
  return new Promise((resolve, reject) => {
    https
      .get(solcListURL, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const list = JSON.parse(data);
          const version = list.releases[versionShort];
          const fullVersion = version
            ? version.replace("soljson-", "").replace(".js", "")
            : null;

          // Cache the result
          solidityVersionCache[versionShort] = fullVersion;

          resolve(fullVersion);
        });
      })
      .on("error", reject);
  });
}

// Detect if the contract might be using upgradeability features
// It's just a basic detection based on keywords; this can be made more sophisticated
const detectUpgradeable = (contractSource) => {
  return (
    /delegatecall/.test(contractSource) ||
    /proxy/.test(contractSource) ||
    /initialize/.test(contractSource)
  );
};

const calculateBaseTime = (lines) => {
  if (lines <= config.sizeThresholds.small) return config.baseTimes.small;
  if (lines <= config.sizeThresholds.medium) return config.baseTimes.medium;
  return config.baseTimes.large;
};

const calculateComplexityTime = (
  contractSource,
  compiledContract,
  countImports
) => {
  let complexityTime = 0;
  for (const contractName in compiledContract) {
    const funcs = compiledContract[contractName].abi.filter(
      (item) => item.type === "function"
    );
    complexityTime +=
      config.complexityFactors.functionTime *
      Math.max(funcs.length - config.complexityFactors.baseFunctionCount, 0);
    complexityTime +=
      config.complexityFactors.externalCallTime *
      (contractSource.match(/\.call\(/g) || []).length;

    const importMatches = contractSource.match(/import/g) || [];
    if (countImports) {
      complexityTime +=
        config.complexityFactors.importTimePerImport * importMatches.length;
    } else {
      complexityTime += config.complexityFactors.importTimeFlatRate;
    }

    if (/assembly/.test(contractSource))
      complexityTime += config.complexityFactors.assemblyTime;
  }
  return complexityTime;
};

const estimateUpgradeabilityComplexity = (contractSource) => {
  if (!detectUpgradeable(contractSource)) return 0;

  const factors = config.complexityFactors.upgradeability;
  return Object.values(factors).reduce((acc, val) => acc + val, 0);
};

const compileContract = (
  contractSource,
  solidityVersionFull,
  optimizerRuns
) => {
  return new Promise((resolve, reject) => {
    solc.loadRemoteVersion(solidityVersionFull, (err, solcV) => {
      if (err) {
        reject(err);
        return;
      }
      const input = {
        language: "Solidity",
        sources: { "contract.sol": { content: contractSource } },
        settings: {
          optimizer: { enabled: optimizerRuns > 0, runs: optimizerRuns },
          outputSelection: { "*": { "*": ["*"] } },
        },
      };
      const output = solcV.compile(JSON.stringify(input), {
        import: findImports,
      });
      resolve(JSON.parse(output));
    });
  });
};

// Estimate the audit time for the contract
const getEstimate = async (options) => {
  const {
    configPath,
    contractSourcePath,
    solcListURL,
    optimizerRuns,
    countImports,
  } = options;

  loadConfigFromFile(configPath, config);

  const contractSource = fs.readFileSync(contractSourcePath, "utf8");
  const solidityVersionShort = getSolidityVersion(contractSource);
  const solidityVersionFull = await getFullVersion(
    solidityVersionShort,
    solcListURL
  );

  const compiledOutput = await compileContract(
    contractSource,
    solidityVersionFull,
    optimizerRuns
  );
  if (compiledOutput.errors && compiledOutput.errors.length > 0) {
    console.error(
      "Compilation errors found:",
      compiledOutput.errors.map((err) => err.formattedMessage)
    );
    process.exit(1);
  }

  const lines = contractSource.split("\n").length;
  const baseTime = calculateBaseTime(lines);
  const complexityTime = calculateComplexityTime(
    contractSource,
    compiledOutput.contracts["contract.sol"],
    countImports
  );

  const upgradeabilityComplexityTime =
    estimateUpgradeabilityComplexity(contractSource);

  console.log("\n----------------------------------");
  console.log("Estimated audit time breakdown:");
  console.log("----------------------------------\n");
  console.log(`- Base Time: ${baseTime} hours`);
  console.log(`- Complexity Time: ${complexityTime} hours`);
  console.log(
    `- Upgradeability Complexity Time: ${upgradeabilityComplexityTime} hours`
  );
  console.log(
    "\n\n----------------------------------\n",
    `Total estimated audit time: ${
      baseTime + complexityTime + upgradeabilityComplexityTime
    } hours`,
    "\n----------------------------------\n"
  );
};

module.exports = {
  getSolidityVersion,
  calculateBaseTime,
  detectUpgradeable,
  calculateComplexityTime,
  estimateUpgradeabilityComplexity,
  getFullVersion,
  compileContract,
  getEstimate,
  loadConfigFromFile,
};
