const fs = require("fs");
const solc = require("solc");
const https = require("https");
const { program } = require("commander");
const path = require("path");

const config = {
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
    importTime: 5,
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

const getSolidityVersion = (contractSource) => {
  const versionMatch = contractSource.match(
    /^pragma solidity (\^?\d+\.\d+\.\d+);/m
  );
  return versionMatch && versionMatch[1];
};

async function getFullVersion(versionShort, solcListURL) {
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
          resolve(
            version ? version.replace("soljson-", "").replace(".js", "") : null
          );
        });
      })
      .on("error", reject);
  });
}

const detectUpgradeable = (contractSource) => {
  return (
    /delegatecall/.test(contractSource) ||
    /proxy/.test(contractSource) ||
    /initialize/.test(contractSource)
  );
};

const getEstimate = async (contractSourcePath, solcListURL, optimizerRuns) => {
  const contractSource = fs.readFileSync(contractSourcePath, "utf8");
  const solidityVersionShort = getSolidityVersion(contractSource);
  const solidityVersionFull = await getFullVersion(
    solidityVersionShort,
    solcListURL
  );

  const input = {
    language: "Solidity",
    sources: { "contract.sol": { content: contractSource } },
    settings: {
      optimizer: { enabled: optimizerRuns > 0, runs: optimizerRuns },
      outputSelection: { "*": { "*": ["*"] } },
    },
  };

  solc.loadRemoteVersion(solidityVersionFull, (err, solcV) => {
    if (err) {
      console.error(
        `Error loading remote compiler version: ${solidityVersionFull}`,
        err
      );
      process.exit(1);
    }

    const output = solcV.compile(JSON.stringify(input), {
      import: findImports,
    });
    const compiledOutput = JSON.parse(output);

    if (compiledOutput.errors && compiledOutput.errors.length > 0) {
      compiledOutput.errors.forEach((error) =>
        console.error(error.formattedMessage)
      );
      process.exit(1);
    }

    const lines = contractSource.split("\n").length;
    let baseTime =
      lines <= config.sizeThresholds.small
        ? config.baseTimes.small
        : lines <= config.sizeThresholds.medium
        ? config.baseTimes.medium
        : config.baseTimes.large;

    let complexityTime = 0;
    for (const contractName in compiledOutput.contracts["contract.sol"]) {
      const funcs = compiledOutput.contracts["contract.sol"][
        contractName
      ].abi.filter((item) => item.type === "function");

      complexityTime +=
        config.complexityFactors.functionTime *
        Math.max(funcs.length - config.complexityFactors.baseFunctionCount, 0);

      complexityTime +=
        config.complexityFactors.externalCallTime *
        (contractSource.match(/\.call\(/g) || []).length;

      if (/import/.test(contractSource))
        complexityTime += config.complexityFactors.importTime;
      if (/assembly/.test(contractSource))
        complexityTime += config.complexityFactors.assemblyTime;
    }

    let upgradeabilityComplexityTime = 0;
    if (detectUpgradeable(contractSource)) {
      const factors = config.complexityFactors.upgradeability;
      for (const factor in factors) {
        upgradeabilityComplexityTime += factors[factor];
      }
    }

    console.log(
      `Estimated audit time: ${
        baseTime + complexityTime + upgradeabilityComplexityTime
      } hours`
    );
  });
};

program
  .version("1.0.0")
  .description("Estimate the audit time for a Solidity contract.")
  .arguments("<contractSourcePath>")
  .option(
    "--solc-list-url <url>",
    "URL to the solc binary list",
    "https://solc-bin.ethereum.org/bin/list.json"
  )
  .option(
    "--optimizer-runs <number>",
    "Number of optimizer runs. Set to 0 to disable.",
    parseInt,
    0
  )
  .action((contractSourcePath, cmdObj) => {
    getEstimate(contractSourcePath, cmdObj.solcListUrl, cmdObj.optimizerRuns);
  })
  .parse(process.argv);

if (!program.args.length) program.help();
