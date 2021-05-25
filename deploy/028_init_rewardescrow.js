const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths")

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];


  for (const index in accounts) {
    console.log(`account${index} balanceOf:`, (await read('RewardEscrow', {}, 'balanceOf', accounts[index])).toString());
    console.log(`account${index} numVestingEntries:`, (await read('RewardEscrow', {}, 'numVestingEntries', accounts[index])).toString());
  }

};

module.exports.tags = ['Rewardescrow', 'Config'];

