const { ethers, upgrades, deployments, getNamedAccounts } = require("hardhat");

(async () => {
  const { deploy, get, execute } = deployments;
  const { deployer, owner } = await getNamedAccounts();

  await execute(
    "Shadows",
    { from: deployer },
    "transferOwnership",
    owner,
  );
})();
