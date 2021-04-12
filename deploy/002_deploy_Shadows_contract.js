module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  await deploy("Shadows", {
    from: deployer,
    proxy: {
      methodName: 'initialize',
      proxyContract: 'OptimizedTransparentProxy',
    },
    log: true,
  });
};
module.exports.tags = ['Shadows','Token']