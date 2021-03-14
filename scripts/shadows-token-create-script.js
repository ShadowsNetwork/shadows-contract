const { ethers, upgrades } = require("hardhat");

async function main() {
  const ShadowsToken = await ethers.getContractFactory("Shadows");
  const instance = await upgrades.deployProxy(ShadowsToken, []);
  await instance.deployed();
}


main();