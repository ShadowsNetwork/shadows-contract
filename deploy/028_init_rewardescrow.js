const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths")

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3, deployer];

  //setVestingScheduleTime
  await execute(
    'RewardEscrow',
    { from: deployer },
    'setVestingScheduleTime',
    '1800', //30 min
  );

  for (const index in accounts) {
    console.log(`----------${accounts[index]}----------`)
    console.log(`account${index} balanceOf:`, fromUnit((await read('RewardEscrow', {}, 'balanceOf', accounts[index])).toString()));
    console.log(`account${index} vestBalanceOf:`, (await read('RewardEscrow', {}, 'vestBalanceOf', accounts[index])).toString());
    console.log(`account${index} numVestingEntries:`, (await read('RewardEscrow', {}, 'numVestingEntries', accounts[index])).toString());
    console.log(`account${index} getNextVestingIndex:`, (await read('RewardEscrow', {}, 'getNextVestingIndex', accounts[index])).toString());
    console.log(`account${index} getNextVestingTime:`, (await read('RewardEscrow', {}, 'getNextVestingTime', accounts[index])).toString());
    console.log(`account${index} getNextVestingQuantity:`, fromUnit((await read('RewardEscrow', {}, 'getNextVestingQuantity', accounts[index])).toString()));
    console.log(`account${index} checkAccountSchedule:`, (await read('RewardEscrow', {}, 'checkAccountSchedule', accounts[index])).toString());
  }


  console.log((await read('RewardEscrow', {}, 'totalEscrowedBalance')).toString());

};

module.exports.tags = ['InitRewardescrow', 'Config'];


