const { toBN } = require('web3-utils');
const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");

(async () => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  for (const synth of ['ShaXTZ']) {
    await execute(
      "Synthesizer",
      { from: deployer },
      "removeSynth",
      toBytes32(synth)
    );
  }
})();
