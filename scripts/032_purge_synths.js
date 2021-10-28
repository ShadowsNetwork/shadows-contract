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

  await execute("xGOLD", { from: deployer }, "purge", [
    "0x9143860b52ed23fef5724ad975809e5c12e0334a",
    "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    "0x43707c6bb6202a5e1007356539a925c052ea9767",
  ]);

  await execute(
    "Synthesizer",
    { from: deployer },
    "removeSynth",
    toBytes32('xGOLD')
  );
};
module.exports.tags = ["PurgeSynth"];
