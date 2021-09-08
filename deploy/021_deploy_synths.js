const { toBytes32 } = require("../utils");
const { synths } = require("../config/synths")

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  const addressResolver = await get("AddressResolver");

  for (const synth of synths) {
    await deploy(synth.symbol, {
      contract: "Synth",
      from: deployer,
      proxy: {
        methodName: "initialize",
        proxyContract: "OptimizedTransparentProxy",
      },
      args: [
        `Shadows ${synth.symbol}`,
        synth.symbol,
        toBytes32(synth.symbol),
        addressResolver.address,
      ],
      log: true,
    });
  }
};
module.exports.tags = ['Synth','Config']