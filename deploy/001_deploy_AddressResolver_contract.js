module.exports = async ({getNamedAccounts, deployments, getChainId}) => {
    const {deploy} = deployments;
    const {deployer, shadowsOwner} = await getNamedAccounts();
    await deploy('AddressResolver', {
      from: deployer,
      log: true,
    });
};
module.exports.tags = ['AddressResolver','Library'];