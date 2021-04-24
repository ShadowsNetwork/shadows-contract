const { ethers, upgrades, deployments, getNamedAccounts } = require("hardhat");

(async () => {
  const { deploy, get, execute } = deployments;
  const { deployer, owner } = await getNamedAccounts();

  await execute(
    "Shadows",
    { from: deployer },
    "transfer",
    "0x097Ae585BfEf78DDC8E266ABCb840dAF7265130c",
    '37700000000000000000000000'
  );
})();