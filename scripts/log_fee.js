const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths");
const { red } = require("bn.js");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3, account4] = await getUnnamedAccounts();
  const accounts = ['0x8B6009731774CCCCDa9D54B4e356a8119f753C35', account1, account2, account3, account4, deployer];

  console.log('collateralisationRatio:', fromUnit((await read('Synthesizer', {}, 'collateralisationRatio', deployer)).toString()));
  console.log('issuanceRatio:', fromUnit((await read('Synthesizer', {}, 'issuanceRatio')).toString()));

  // await execute(
  //   'FeePool',
  //   { from: deployer },
  //   'closeCurrentFeePeriod'
  // );


  // for (const account of accounts) {
  console.log('feesAvailable:', (await read('FeePool', {}, 'feesAvailable', deployer)).toString());
  console.log('feesByPeriod:', (await read('FeePool', {}, 'feesByPeriod', deployer)).toString());
  //await execute('FeePool', { from: deployer }, 'claimFees');
  // }

  // reset feepaid
  // await execute('FeePool', { from: deployer }, 'initFeePaid');

  // console.log('feePeriodDuration:', (await read('FeePool', {}, 'feePeriodDuration')).toString());

  // await execute('FeePool', { from: deployer }, 'setFeePeriodDuration', 1 * 60 * 10);

  console.log('feePeriodDuration:', (await read('FeePool', {}, 'feePeriodDuration')).toString());

  console.log('FEE_PERIOD_LENGTH', (await read('FeePool', {}, 'FEE_PERIOD_LENGTH')).toString());

  const FEE_PERIOD_LENGTH = await read('FeePool', {}, 'FEE_PERIOD_LENGTH');
  const recentFeePeriods = [];
  const feePeriodStuct = {
    feePeriodId: 0,
    startingDebtIndex: 0,
    startTime: 0,
    feesToDistribute: 0,
    feesClaimed: 0,
    rewardsToDistribute: 0,
    rewardsClaimed: 0
  }
  for (let i = 0; i < FEE_PERIOD_LENGTH; i++) {
    const feePeriod = await read('FeePool', {}, 'recentFeePeriods', i);
    recentFeePeriods.push(Object.keys(feePeriodStuct).reduce((sum, item, index) => {
      sum[item] = ['feePeriodId', 'startingDebtIndex', 'startTime'].includes(item) ? feePeriod[index].toString() : fromUnit(feePeriod[index].toString())
      return sum;
    }, {}));
  }
  console.log(recentFeePeriods);

  for (const account of accounts) {
    console.log(`--------${account}--------`)
    console.log('lastFeeWithdrawalStorage', (await read('FeePool', {}, 'getLastFeeWithdrawal', account)).toString())

    let result = await read('FeePool', {}, 'feesAvailable', account);
    result.map(item => {
      console.log('feesAvailable', item.toString());
    });

    result = await read('FeePool', {}, 'feesByPeriod', account);
    result.map(item => {
      console.log('feesByPeriod', item.map(val => val.toString()));
    });
  }

};

module.exports.tags = ['LogFee'];


