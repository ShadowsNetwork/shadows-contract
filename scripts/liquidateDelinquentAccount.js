const { ethers, upgrades, deployments, getNamedAccounts } = require("hardhat");
const { toUnit } = require("../utils");

(async () => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, owner } = await getNamedAccounts();


  const addres = '0xdd710d42b35b39bd9f72fd5dd4b19ffd16b9f1e5';
  const amountToFixed = toUnit('3000').toString();

  const isOpen = await read(
    'Liquidations',
    {},
    'isOpenForLiquidation',
    addres
  )

  if (isOpen) {
    await execute(
      'Shadows',
      { from: deployer },
      'liquidateDelinquentAccount',
      addres,
      amountToFixed
    );
  }

})();
