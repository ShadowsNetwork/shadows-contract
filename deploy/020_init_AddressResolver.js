const { toBytes32 } = require("../utils");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  const shadows = await get("Shadows");
  const oracle = await get("Oracle");
  const feePool = await get("FeePool");
  const exchanger = await get("Exchanger");
  const rewardEscrow = await get("RewardEscrow");
  const synthesizer = await get("Synthesizer");
  const liquidations = await get("Liquidations");

  await execute(
    "AddressResolver",
    { from: deployer },
    "importAddresses",
    [
      toBytes32("Shadows"),
      toBytes32("Oracle"),
      toBytes32("FeePool"),
      toBytes32("Exchanger"),
      toBytes32("RewardEscrow"),
      toBytes32("Synthesizer"),
      toBytes32("Liquidations"),
    ],
    [
      shadows.address,
      oracle.address,
      feePool.address,
      exchanger.address,
      rewardEscrow.address,
      synthesizer.address,
      liquidations.address,
    ]
  );
};
module.exports.tags = ['InitAddressResolver','Config','deploy'];
//module.exports.dependencies = ['AddressResolver','Shadows','Oracle','FeePool','Exchanger','RewardEscrow','Synthesizer'];
