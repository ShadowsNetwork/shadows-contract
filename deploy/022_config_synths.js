const { toBytes32 } = require("../utils");
const { synths } = require("../config/synths")

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  const addressResolver = await get("AddressResolver");

  for (const synth of synths) {
    const instance =  await get(synth.symbol);
    await execute(
      "Synthesizer",
      { from: deployer },
      "addSynth",
      instance.address
    );
  }
};
