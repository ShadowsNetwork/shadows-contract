const { toBytes32, bytesToString, fromUnit, toUnit, currentTime } = require("../utils");
const { synths } = require("../config/synths");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];
  const nowTime = await currentTime();

  await execute(
     'Oracle',
     { from: deployer },
     'setOracle',
     '0x8aF3C068A462e65e5b41577aCB07D45bb6eB586C'
   );

};

module.exports.tags = ['InitOracleUpdater', 'Config','deploy'];


