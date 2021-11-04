const { toBN } = require('web3-utils');
const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths")

(async () => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  for (const synth of ['ShaVAI']) {
    await execute(
      "Synthesizer",
      { from: deployer },
      "removeSynth",
      toBytes32(synth)
    );
  }
})();
