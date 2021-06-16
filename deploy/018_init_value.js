module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  // set Issuance Ratio
  const unit = await read('SafeDecimalMath', 'unit');
  await execute(
    'Synthesizer',
    { from: deployer },
    'setIssuanceRatio',
    toBN(10 ** 18 / 5).toString()
  );
  console.log((await read('Synthesizer', 'issuanceRatio')).toString());
};
module.exports.tags = ['InitValue', 'Config']
module.exports.dependencies = ['SafeDecimalMath', 'AddressResolver', 'Shadows', 'Oracle', 'FeePool', 'Exchanger', 'RewardEscrow', 'Synthesizer'];
