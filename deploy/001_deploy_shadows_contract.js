module.exports = async ({getNamedAccounts, deployments, getChainId}) => {
    const {deploy} = deployments;
    const {deployer, shadowsOwner} = await getNamedAccounts();
    console.log(deployer)
    await deploy('Shadows', {
      from: deployer,
      proxy: true,
    });
};