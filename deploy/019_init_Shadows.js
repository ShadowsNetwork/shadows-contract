module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();
  const synthesizer = await get("Synthesizer");

  await execute(
    "Shadows",
    { from: deployer },
    "setSynthesizer",
    synthesizer.address
  );
};
module.exports.tags = ['InitShadows','Config','deploy']
//module.exports.dependencies = ['Shadows','Synthesizer','deploy'];
