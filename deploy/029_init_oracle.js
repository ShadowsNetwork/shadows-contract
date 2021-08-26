const { toBytes32, bytesToString, fromUnit, toUnit, currentTime } = require("../utils");
const { synths } = require("../config/synths");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];
  const nowTime = await currentTime();

  // setRateStalePeriod; default: 3 hours
  // await execute(
  //   'Oracle',
  //   { from: deployer },
  //   'setRateStalePeriod',
  //   3600 * 3
  // );

  const newKeys = [];
  for (const item of synths) {
    const ratesForCurrencies = await read('Oracle', {}, 'rateForCurrency', toBytes32(item.symbol));
    console.log(`${item.symbol} rete: ${fromUnit(ratesForCurrencies.toString())}`);
    const retaValue = fromUnit(ratesForCurrencies.toString());

    if (!Number(retaValue) && item.address) {
      newKeys.push(item.symbol);
      // await execute('Oracle', { from: deployer }, 'addAggregator', toBytes32(item.symbol), item.address);
    }
  }
  console.log(newKeys)

  // if (newKeys.length > 0) {
  // await execute(
  //   'Oracle',
  //   { from: deployer },
  //   'updateRates',
  //   ['xCOINBASE'].map(item => toBytes32(item)),
  //   [0.7].map(item => (toUnit(item)).toString()),
  //   nowTime
  // );
  // }

};

module.exports.tags = ['InitOracle', 'Config'];


