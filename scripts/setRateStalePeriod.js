const { toBN } = require('web3-utils');
const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");

(async () => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

    await execute(
      "Oracle",
      { from: deployer },
      "setRateStalePeriod",
      14400
    );
})();
