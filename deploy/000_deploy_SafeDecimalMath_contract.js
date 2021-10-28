module.exports = async ({getNamedAccounts, deployments, getChainId}) => {
    const {deploy} = deployments;
    const {deployer, shadowsOwner} = await getNamedAccounts();
    await deploy('SafeDecimalMath', {
      from: deployer,
      log: true,
    });
};
module.exports.tags = ['SafeDecimalMath','Library','deploy'];