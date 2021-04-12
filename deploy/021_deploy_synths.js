const { toBytes32 } = require("../utils");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  const addressResolver = await get("AddressResolver");

  const synths = [
    {
      name: "Shadows xUSD",
      symbol: "xUSD",
    },
    {
      name: "Shadows xAUD",
      symbol: "xAUD",
    },
    {
      name: "Shadows xEUR",
      symbol: "xEUR",
    },
  ];

  for (const synth of synths) {
    await deploy(synth.symbol, {
      contract: "Synth",
      from: deployer,
      proxy: {
        methodName: "initialize",
        proxyContract: "OptimizedTransparentProxy",
      },
      args: [
        synth.name,
        synth.symbol,
        toBytes32(synth.symbol),
        addressResolver.address,
      ],
      log: true,
    });
  }
};
