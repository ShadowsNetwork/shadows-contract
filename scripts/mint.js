const { ethers, upgrades, deployments, getNamedAccounts } = require("hardhat");

(async () => {
  const { deploy, get, execute } = deployments;
  const { deployer, owner } = await getNamedAccounts();

  await execute(
    "Shadows",
    { from: deployer },
    "mint",
    deployer,
    "700000000000000000000000"
  );
})();
