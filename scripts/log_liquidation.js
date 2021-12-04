const {
  toBytes32,
  bytesToString,
  fromUnit,
  toUnit,
  currentTime,
} = require("../utils");
const { synths } = require("../config/synths");

(async () => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];
  const nowTime = await currentTime();

  const liquidationRatio = await read("Liquidations", {}, "liquidationRatio");
  console.log("liquidationRatio:", liquidationRatio.toString());

  const collateralisationRatio = await read(
    "Synthesizer",
    {},
    "collateralisationRatio",
    "0x09F1e9593492A524DF8668b873110d9c658c841e"
  );
  console.log(
    "collateralisationRatio:",
    collateralisationRatio.toString(),
    toUnit(0).toString()
  );
  console.log(fromUnit(collateralisationRatio.toString()));
  console.log(fromUnit(liquidationRatio.toString()));
  const u =
    fromUnit(collateralisationRatio.toString()) >=
    fromUnit(liquidationRatio.toString());
  console.log(u);

  const dept = await read(
    "Synthesizer",
    {},
    "debtBalanceOf",
    "0x09F1e9593492A524DF8668b873110d9c658c841e",
    toBytes32("ShaUSD")
  );
  console.log(fromUnit(dept.toString()));

  const collateral = await read(
    "Synthesizer",
    {},
    "collateral",
    "0x09F1e9593492A524DF8668b873110d9c658c841e"
  );
  console.log(fromUnit(collateral.toString()));
})();
