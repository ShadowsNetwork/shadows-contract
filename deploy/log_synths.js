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

  // const availableSynthCount = await read('Synthesizer', {}, 'availableSynthCount')
  // console.log('availableSynthCount:', availableSynthCount.toString());

  // const availableCurrencyKeys = await read('Synthesizer', {}, 'availableCurrencyKeys')
  // console.log('availableCurrencyKeys:', availableCurrencyKeys.toString());

  // console.log('totalIssuedSynths DOWS:', fromUnit((await read('Synthesizer', {}, 'totalIssuedSynths', toBytes32('DOWS'))).toString()));
  // console.log('totalIssuedSynths ShaUSD:', fromUnit((await read('Synthesizer', {}, 'totalIssuedSynths', ShaUSD)).toString()));
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
  await new Promise(async resolve => {
    accounts.forEach(async (account, index) => {
      // maxIssuableSynths
      const maxIssuableSynths = await read('Synthesizer', {}, 'maxIssuableSynths', account);
      console.log(`account${index + 1} maxIssuableSynths: ${fromUnit(maxIssuableSynths.toString())}`);

      const transferableShadows = await read('Synthesizer', {}, 'transferableShadows', account);
      console.log(`account${index + 1} transferableShadows: ${fromUnit(transferableShadows.toString())}`);

      const collateralisationRatio = await read('Synthesizer', {}, 'collateralisationRatio', account);
      console.log(`account${index + 1} collateralisationRatio: ${fromUnit(collateralisationRatio.toString())}`);

      const balanceOf = await read('Synthesizer', {}, 'debtBalanceOf', account, ShaUSD);
      console.log(`account${index + 1}  debtBalanceOf: ${fromUnit(balanceOf.toString())}`);


      // lock value
      // ['DOWS', 'ShaUSD', 'xAUD', 'xEUR'].forEach(async item => {
      //   const balanceOf = await read('Synthesizer', {}, 'debtBalanceOf', account, toBytes32(item));
      //   console.log(`account${index + 1}  ${item} debtBalanceOf: ${fromUnit(balanceOf.toString())}`);
      // });
    });
  });

};

module.exports.tags = ['LogIssueSynth', 'Config'];


