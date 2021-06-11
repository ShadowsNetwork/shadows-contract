const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3, account4] = await getUnnamedAccounts();
  const accounts = [account1];

  // add issue synth
  // account1 has already ?
  const balanceOf = await read('Synthesizer', {}, 'debtBalanceOf', account4, toBytes32('xUSD'));
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

  // const availableSynthCount = await read('Synthesizer', {}, 'availableSynthCount')
  // console.log('availableSynthCount:', availableSynthCount.toString());

  // const availableCurrencyKeys = await read('Synthesizer', {}, 'availableCurrencyKeys')
  // console.log('availableCurrencyKeys:', availableCurrencyKeys.toString());

  // console.log('totalIssuedSynths DOWS:', fromUnit((await read('Synthesizer', {}, 'totalIssuedSynths', toBytes32('DOWS'))).toString()));
  // console.log('totalIssuedSynths xUSD:', fromUnit((await read('Synthesizer', {}, 'totalIssuedSynths', toBytes32('xUSD'))).toString()));
  // console.log('totalIssuedSynths xAUD:', fromUnit((await read('Synthesizer', {}, 'totalIssuedSynths', toBytes32('xAUD'))).toString()));
  // console.log('totalIssuedSynths xEUR:', fromUnit((await read('Synthesizer', {}, 'totalIssuedSynths', toBytes32('xEUR'))).toString()));

  // const debtLedger = await read('Synthesizer', {}, 'lastDebtLedgerEntry');
  // console.log(fromUnit(debtLedger.toString()));

  // const len = await read('Synthesizer', {}, 'debtLedgerLength');
  // for (const i of fromUnit(len.toString())) {
  //   const debtVal = await read('Synthesizer', {}, 'debtLedger', i);
  //   console.log(`${i}: ${fromUnit(debtVal.toString())}`);
  // }

  // accounts log info
  // await new Promise(async resolve => {
  //   accounts.forEach(async (account, index) => {
  //     // maxIssuableSynths
  //     const maxIssuableSynths = await read('Synthesizer', {}, 'maxIssuableSynths', account);
  //     console.log(`account${index + 1} maxIssuableSynths: ${fromUnit(maxIssuableSynths.toString())}`);

  //     const collateralisationRatio = await read('Synthesizer', {}, 'collateralisationRatio', account);
  //     console.log(`account${index + 1} collateralisationRatio: ${fromUnit(collateralisationRatio.toString())}`);

  //     // lock value
  //     ['DOWS', 'xUSD', 'xAUD', 'xEUR'].forEach(async item => {
  //       const balanceOf = await read('Synthesizer', {}, 'debtBalanceOf', account, toBytes32(item));
  //       console.log(`account${index + 1}  ${item} debtBalanceOf: ${fromUnit(balanceOf.toString())}`);
  //     });
  //   });
  // });

};

module.exports.tags = ['BurnSynth', 'Config'];


