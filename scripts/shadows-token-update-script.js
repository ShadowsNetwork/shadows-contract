const { ethers, upgrades } = require("hardhat");

async function main() {
  const ShadowsToken = await ethers.getContractFactory("Shadows");
  const upgraded = await upgrades.upgradeProxy('0x372e967ca8d1d70bd78a7e8396aeab41c241f15f', ShadowsToken);
  console.log(`update success. new impl address:${upgraded.address}`);
}

main();