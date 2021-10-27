const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3, deployer];

  //setVestingScheduleTime; default: 1 years
  await execute(
    'RewardEscrow',
    { from: deployer },
    'setVestingScheduleTime',
    '2419200', //30 min
  );

};

module.exports.tags = ['InitRewardescrow', 'Config', 'deploy'];


