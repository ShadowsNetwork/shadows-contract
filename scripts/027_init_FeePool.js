const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths");
const { red } = require("bn.js");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3, account4] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3, account4, deployer];

  console.log('issuanceRatio:', fromUnit((await read('Synthesizer', {}, 'issuanceRatio')).toString()));
  console.log('collateralisationRatio:', fromUnit((await read('Synthesizer', {}, 'debtLedgerLength')).toString()));
  

  // await execute(
  //   'FeePool',
  //   { from: deployer },
  //   'closeCurrentFeePeriod'
  // );


  // for (const account of accounts) {
  //await execute('FeePool', { from: deployer }, 'claimFees');
  // }

  // reset feepaid
  // await execute('FeePool', { from: deployer }, 'initFeePaid');

  // console.log('feePeriodDuration:', (await read('FeePool', {}, 'feePeriodDuration')).toString());

  // await execute('FeePool', { from: deployer }, 'setFeePeriodDuration', 1 * 60 * 10);

};

module.exports.tags = ['InitFeePool', 'Config'];


