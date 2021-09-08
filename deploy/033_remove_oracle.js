const { toBytes32, bytesToString, fromUnit, toUnit, currentTime } = require("../utils");
const { synths } = require("../config/synths");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];
  const nowTime = await currentTime();

  for (const item of ['xBANK', 'xCAKE']) {
    await execute(
      'Oracle',
      { from: deployer },
      'removeAggregator',
      toBytes32(item)
    );
  }
};

module.exports.tags = ['RemoveOracle'];


