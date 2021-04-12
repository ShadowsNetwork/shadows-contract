const { toWei, toBN } = require("web3-utils")
const toUnit = (amount) => toBN(toWei(amount.toString(), "ether"));

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  const safeDecimalMath = await get("SafeDecimalMath");

  await deploy("Oracle", {
    from: deployer,
    proxy: {
      methodName: 'initialize',
      proxyContract: 'OptimizedTransparentProxy',
    },
    args: [deployer, [],[]],
    log: true,
    libraries: { SafeDecimalMath: safeDecimalMath.address },
  });
};
module.exports.tags = ['Oracle']