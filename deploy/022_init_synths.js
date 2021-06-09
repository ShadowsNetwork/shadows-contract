const { toBN } = require('web3-utils');
const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths")

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  const addressResolver = await get("AddressResolver");
  const availableCurrencyKeys = await read('Synthesizer', 'availableCurrencyKeys');
  const currentKeys = availableCurrencyKeys.map(item => bytesToString(item));

  // add xUSD,xAUD,xEUR to synth
  for (const synth of synths) {
    const instance = await get(synth.symbol);

    if (!currentKeys.includes(synth.symbol)) {
      await execute(
        "Synthesizer",
        { from: deployer },
        "addSynth",
        instance.address
      );
    }
  }

  // remove xAUD,xEUR from synth
  for (const synth of synths) {
    const xVal = toBytes32(synth.symbol);
    if (synth.symbol == 'xAUD' || synth.symbol == 'xEUR') {
      await execute(
        "Synthesizer",
        { from: deployer },
        "removeSynth",
        xVal
      );
    }
  }

  // set Issuance Ratio
  const unit = await read('SafeDecimalMath', 'unit');
  await execute(
    'Synthesizer',
    { from: deployer },
    'setIssuanceRatio',
    toBN(10 ** 18 / 5).toString()
  );
  console.log((await read('Synthesizer', 'issuanceRatio')).toString());
};
module.exports.tags = ['InitSynth', 'Config'];