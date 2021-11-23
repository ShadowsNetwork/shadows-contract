const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { ethers, upgrades, deployments, getNamedAccounts } = require("hardhat");

(async () => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, owner } = await getNamedAccounts();

  let dows = await read(
    'Synthesizer',
    { },
    'transferableShadows',
    '0x64F77f32f62B0FDD5AE54acF9525Ca10D6F810CF'
  );

  console.log('transferableShadows:', dows.toString());
})();
