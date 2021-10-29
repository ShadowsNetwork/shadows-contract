const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { ethers, upgrades, deployments, getNamedAccounts } = require("hardhat");

(async () => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, owner } = await getNamedAccounts();

  console.log('Shadows owner:', (await read('Shadows', {}, 'owner')).toString());
  console.log('synthesizer:', (await read('Shadows', {}, 'synthesizer')).toString());
  console.log('issuanceRatio:', fromUnit((await read('Synthesizer', {}, 'issuanceRatio')).toString()));
  console.log('liquidationRatio:', fromUnit((await read('Liquidations', {}, 'liquidationRatio')).toString()));
  console.log('liquidationPenalty:', fromUnit((await read('Liquidations', {}, 'liquidationPenalty')).toString()));
  console.log('liquidationDelay:', (await read('Liquidations', {}, 'liquidationDelay')).toString());
  console.log('vestingScheduleTime:', (await read('RewardEscrow', {}, 'vestingScheduleTime')).toString());
  console.log('feePeriodDuration:', (await read('FeePool', {}, 'feePeriodDuration')).toString());
  console.log('exchangeFeeRate:', fromUnit((await read('FeePool', {}, 'exchangeFeeRate')).toString()));
})();
