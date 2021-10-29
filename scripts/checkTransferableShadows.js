const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { ethers, upgrades, deployments, getNamedAccounts } = require("hardhat");

(async () => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, owner } = await getNamedAccounts();

  let dows = await execute(
    'Synthesizer',
    { from: deployer },
    'transferableShadows',
    '0x564160aB47Ff2f414397B89BaaFcfAD06a02cB0a'
  );

  console.log('transferableShadows:', fromUnit(dows).toString());
})();
