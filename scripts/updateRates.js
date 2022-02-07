const { toBN } = require("web3-utils");
const {
  toBytes32,
  bytesToString,
  fromUnit,
  toUnit,
  currentTime,
} = require("../utils");

(async () => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  console.log(toUnit("0.068197").toString());
  const [xUSD, DOWS, xBTC, xETH] = ["ShaUSD", "DOWS", "xBTC", "xETH"].map(
    toBytes32
  );
  await execute(
    "Oracle",
    { from: deployer },
    "updateRates",
    [DOWS],
    [toUnit("0.068197").toString()],
    await currentTime()
  );
})();
