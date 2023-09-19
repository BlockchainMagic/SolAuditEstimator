const { program } = require("commander");
const { getEstimate } = require("./lib/auditEstimator");

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
    "-i, --count-imports",
    "Flag to count each import individually for time estimation. By default, a flat rate is used for any number of imports.",
    false
  )
  .option(
    "-o, --optimizer-runs <number>",
    "Number of optimizer runs. Set to 0 to disable.",
    parseInt,
    0
  )
  .option("-c, --config <path>", "Path to external JSON config file")
  .action((contractSourcePath, cmdObj) => {
    getEstimate({
      configPath: cmdObj.config,
      contractSourcePath,
      solcListURL: cmdObj.solcListUrl,
      optimizerRuns: cmdObj.optimizerRuns,
      countImports: cmdObj.countImports,
    });
  })
  .parse(process.argv);

if (!program.args.length) program.help();
