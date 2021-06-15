module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

};
module.exports.tags = ['InitValue', 'Config']
module.exports.dependencies = ['SafeDecimalMath', 'AddressResolver', 'Shadows', 'Oracle', 'FeePool', 'Exchanger', 'RewardEscrow', 'Synthesizer'];
