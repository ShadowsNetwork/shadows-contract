const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths")

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3, deployer];


  console.log('vestingScheduleTime:', (await read('RewardEscrow', {}, 'vestingScheduleTime')).toString());


  const anthersAccount = ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', deployer];
  for (const index in anthersAccount) {
    const account = anthersAccount[index];
    console.log(`----------${account}----------`)
    console.log(`account${index} balanceOf:`, fromUnit((await read('RewardEscrow', {}, 'balanceOf', account)).toString()));
    console.log(`account${index} vestBalanceOf:`, (await read('RewardEscrow', {}, 'vestBalanceOf', account)).toString());
    console.log(`account${index} numVestingEntries:`, (await read('RewardEscrow', {}, 'numVestingEntries', account)).toString());
    console.log(`account${index} getNextVestingIndex:`, (await read('RewardEscrow', {}, 'getNextVestingIndex', account)).toString());
    console.log(`account${index} getNextVestingTime:`, (await read('RewardEscrow', {}, 'getNextVestingTime', account)).toString());
    console.log(`account${index} getNextVestingQuantity:`, fromUnit((await read('RewardEscrow', {}, 'getNextVestingQuantity', account)).toString()));
    console.log(`account${index} checkAccountSchedule:`, (await read('RewardEscrow', {}, 'checkAccountSchedule', account)).toString());
  }


  console.log('totalEscrowedBalance:', fromUnit((await read('RewardEscrow', {}, 'totalEscrowedBalance')).toString()));

};

module.exports.tags = ['LogRewardescrow'];


