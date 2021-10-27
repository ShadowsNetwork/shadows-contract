const { toBN } = require('web3-utils');
const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths")

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  for (const synth of ['xBANK', 'xCAKE']) {
    await execute(
      "Synthesizer",
      { from: deployer },
      "removeSynth",
      toBytes32(synth)
    );
  }
};
module.exports.tags = ['RemoveSynth'];
