const { toBN } = require('web3-utils');

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  // set Issuance Ratio
  await execute(
    'Synthesizer',
    { from: deployer },
    'setIssuanceRatio',
    toBN(10 ** 18 / 5).toString()
  );
};
module.exports.tags = ['InitValue', 'Config']
module.exports.dependencies = ['SafeDecimalMath', 'AddressResolver', 'Shadows', 'Oracle', 'FeePool', 'Exchanger', 'RewardEscrow', 'Synthesizer'];
