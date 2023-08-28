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
  },
};

// Find and return the content of imported files
const findImports = (importPath) => {
  const openzeppelinBasePath = "./node_modules/@openzeppelin/";
  let fullPath;

  if (importPath.startsWith("@openzeppelin")) {
    fullPath = path.join(
      openzeppelinBasePath,
      importPath.replace("@openzeppelin/", "")
    );
  } else {
    // Add handling for other libraries or local files if needed
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
          let version = list.releases[versionShort];
          if (version) {
            version = version
              .replace(".js", "") // remove .js extension
              .replace("soljson-", ""); // remove soljson- prefix
            resolve(version);
          } else {
            resolve(null);
          }
        });
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

const getEstimate = async (contractSourcePath, solcListURL) => {
  const contractSource = fs.readFileSync(contractSourcePath, "utf8");
  const solidityVersionShort = getSolidityVersion(contractSource);

  if (!solidityVersionShort) {
    console.error("Could not determine Solidity version from contract source.");
    process.exit(1);
  }

  const solidityVersionFull = await getFullVersion(
    solidityVersionShort,
    solcListURL
  );
  if (!solidityVersionFull) {
    console.error(
      `Couldn't find a matching full version for ${solidityVersionShort}`
    );
    process.exit(1);
  }

  const input = {
    language: "Solidity",
    sources: {
      "contract.sol": {
        content: contractSource,
      },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["*"],
        },
      },
    },
  };

  solc.loadRemoteVersion(solidityVersionFull, (err, solcV) => {
    if (err) {
      console.error(
        `Error loading remote compiler version: (${solidityVersionFull})`,
        err
      );
      process.exit(1);
    } else {
      const output = solcV.compile(JSON.stringify(input), {
        import: findImports,
      });
      const compiledOutput = JSON.parse(output);

      if (compiledOutput.errors && compiledOutput.errors.length > 0) {
        console.error("Compilation errors found:");
        compiledOutput.errors.forEach((error) =>
          console.error(error.formattedMessage)
        );
        process.exit(1);
      }

      // Size estimation
      const lines = contractSource.split("\n").length;
      let baseTime;

      switch (true) {
        case lines <= config.sizeThresholds.small:
          baseTime = config.baseTimes.small;
          break;
        case lines <= config.sizeThresholds.medium:
          baseTime = config.baseTimes.medium;
          break;
        default:
          baseTime = config.baseTimes.large;
      }

      // Complexity estimation
      let complexityTime = 0;

      for (const contractName in compiledOutput.contracts["contract.sol"]) {
        const funcs = compiledOutput.contracts["contract.sol"][
          contractName
        ].abi.filter((item) => item.type === "function");
        complexityTime +=
          config.complexityFactors.functionTime *
          Math.max(
            funcs.length - config.complexityFactors.baseFunctionCount,
            0
          );

        const externalCalls = contractSource.match(/\.call\(/g) || [];
        complexityTime +=
          config.complexityFactors.externalCallTime * externalCalls.length;

        if (/import/.test(contractSource)) {
          complexityTime += config.complexityFactors.importTime;
        }

        if (/assembly/.test(contractSource)) {
          complexityTime += config.complexityFactors.assemblyTime;
        }
      }

      console.log(`Estimated audit time: ${baseTime + complexityTime} hours`);
    }
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
  .action((contractSourcePath, cmdObj) => {
    getEstimate(contractSourcePath, cmdObj.solcListUrl);
  })
  .parse(process.argv);

if (!program.args.length) {
  program.help(); // Display help info if no arguments provided
}
