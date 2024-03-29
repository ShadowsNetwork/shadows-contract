const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3, account4] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3,account4];

  const ShaUSD = toBytes32('ShaUSD');

  // add issue synth
  // account1 has already ?
  const hasIssueAccount1 = await read('Synthesizer', {}, 'hasIssued', account1);
  // console.log(hasIssueAccount1);
  // if (!hasIssueAccount1) {
    await execute(
      'Synthesizer',
      { from: account1 },
      'issueSynths',
      toUnit('10').toString()
    );
  // }

  // account2 has already ?
  const hasIssueAccount2 = await read('Synthesizer', {}, 'hasIssued', account2);
  // console.log(hasIssueAccount2)
  if (!hasIssueAccount2) {
    await execute(
      'Synthesizer',
      { from: account2 },
      'issueSynths',
      toUnit('10000').toString()
    );
  }

  // account3 has already ?
  const hasIssueAccount3 = await read('Synthesizer', {}, 'hasIssued', account3);
  // console.log(hasIssueAccount3)
  if (!hasIssueAccount3) {
    await execute(
      'Synthesizer',
      { from: account3 },
      'issueSynths',
      toUnit('12').toString()
    );
  }

  await execute(
    'Synthesizer',
    { from: account4 },
    'issueSynths',
    toUnit('100').toString()
  );
};

module.exports.tags = ['IssueSynth'];


