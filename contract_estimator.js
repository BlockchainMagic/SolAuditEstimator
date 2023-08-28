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
    "-c, --count-imports",
    "Flag to count each import individually for time estimation. By default, a flat rate is used for any number of imports.",
    false
  )
  .option(
    "-o, --optimizer-runs <number>",
    "Number of optimizer runs. Set to 0 to disable.",
    parseInt,
    0
  )
  .action((contractSourcePath, cmdObj) => {
    getEstimate(
      contractSourcePath,
      cmdObj.solcListUrl,
      cmdObj.optimizerRuns,
      cmdObj.countImports
    );
  })
  .parse(process.argv);

if (!program.args.length) program.help();
