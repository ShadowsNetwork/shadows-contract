const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3, account4] = await getUnnamedAccounts();
  const accounts = [account1];

  const ShaUSD = toBytes32('ShaUSD');
  // add issue synth
  // account1 has already ?
  const balanceOf = await read('Synthesizer', {}, 'debtBalanceOf', account4, ShaUSD);
  console.log(fromUnit(balanceOf.toString()));
  
  const value = fromUnit(balanceOf.toString()) - 100;

  if (value > 0) {
    await execute(
      'Synthesizer',
      { from: account4 },
      'burnSynths',
      toUnit(value).toString()
    );
  }

};

module.exports.tags = ['BurnSynth'];


