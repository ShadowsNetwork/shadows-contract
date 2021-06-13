const { toBN } = require("web3-utils");
const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  const addressResolver = await get("AddressResolver");
  const availableCurrencyKeys = await read(
    "Synthesizer",
    "availableCurrencyKeys"
  );
  const currentKeys = availableCurrencyKeys.map((item) => bytesToString(item));

  // add xUSD,xAUD,xEUR to synth
  await execute("xEUR", { from: deployer }, "purge", [
    "0x9143860b52ed23fef5724ad975809e5c12e0334a",
    "0x004a7e272ad85aa3d68fb8015e682196a63e6d16",
  ]);

  await execute(
    "Synthesizer",
    { from: deployer },
    "removeSynth",
    toBytes32('xEUR')
  );
};
module.exports.tags = ["PurgeSynth", "Config"];
