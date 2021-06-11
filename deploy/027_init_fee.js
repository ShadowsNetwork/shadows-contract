const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths");
const { red } = require("bn.js");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3, account4] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3, account4];

  // await execute(
  //   'FeePool',
  //   { from: deployer },
  //   'closeCurrentFeePeriod'
  // );

  // for (const account of accounts) {
  //   await execute('FeePool', { from: account }, 'claimFees');
  // }

  // console.log('targetThreshold:', fromUnit((await read('FeePool', {}, 'targetThreshold')).toString()));
  // console.log('exchangeFeeRate:', fromUnit((await read('FeePool', {}, 'exchangeFeeRate')).toString()));
  // console.log('feePeriodDuration:', fromUnit((await read('FeePool', {}, 'feePeriodDuration')).toString()));

  // // set
  // await execute('FeePool', {}, 'setExchangeFeeRate', toUnit(0.3).toString());
  // await execute('FeePool', {}, 'setFeePeriodDuration', toUnit(1).toString());
  // await execute('FeePool', {}, 'setTargetThreshold', toUnit(1).toString());

  // // reset 

  // console.log('targetThreshold:', fromUnit((await read('FeePool', {}, 'targetThreshold')).toString()));
  // console.log('exchangeFeeRate:', fromUnit((await read('FeePool', {}, 'exchangeFeeRate')).toString()));
  // console.log('feePeriodDuration:', fromUnit((await read('FeePool', {}, 'feePeriodDuration')).toString()));
  console.log((await read('FeePool', {}, 'feePeriodDuration')).toString());

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

  for (const account of [deployer,account1, account2, account3, account4]) {
    let result = await read('FeePool', {}, 'feesAvailable', account);
    result.map(item => {
      console.log(item.toString());
    });

    result = await read('FeePool', {},'feesByPeriod',account);
    result.map(item => {
      console.log(item.toString());
    });
  }

};

module.exports.tags = ['Fee', 'Config'];


