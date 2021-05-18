const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, shadowsOwner, account1, account2, account3 } = await getNamedAccounts();

  await execute(
    'Synthesizer',
    { form: deployer },
    'issueSynths',
    toUnit('100')
  );
};

module.exports.tags = ['IssueSynth', 'Config'];

