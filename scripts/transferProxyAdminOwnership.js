const { ethers, upgrades, deployments, getNamedAccounts } = require("hardhat");

(async () => {
  const { deploy, get, execute } = deployments;
  const { deployer, owner } = await getNamedAccounts();

  await execute(
    "DefaultProxyAdmin",
    { from: deployer },
    "transferOwnership",
    "0x6C8B64CB4194eC9F43AFFF6eA98e9405F6d36261",
  );
})();
