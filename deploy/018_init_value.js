const { toBN } = require('web3-utils');

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  // set Issuance Ratio, 800%
  await execute(
    'Synthesizer',
    { from: deployer },
    'setIssuanceRatio',
    toBN(10 ** 18 / 8).toString()
  );
};
module.exports.tags = ['InitValue', 'Config','deploy']
module.exports.dependencies = ['SafeDecimalMath', 'AddressResolver', 'Shadows', 'Oracle', 'FeePool', 'Exchanger', 'RewardEscrow', 'Synthesizer'];
