const { toBytes32, bytesToString, fromUnit, toUnit, currentTime } = require("../utils");
const { synths } = require("../config/synths");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];
  const nowTime = await currentTime();

  /*
  await execute(
    'Oracle',
    { from: deployer },
    'setRateStalePeriod',
    3600 * 3
  );
  */

  // await execute(
  //   'Oracle',
  //   { from: deployer },
  //   'removeAggregator',
  //   toBytes32('xAUD')
  // );

  const newKeys = [];
  for (const item of synths) {
    const ratesForCurrencies = await read('Oracle', {}, 'rateForCurrency', toBytes32(item.symbol));
    console.log(`${item.symbol} rete: ${fromUnit(ratesForCurrencies.toString())}`);
    const retaValue = fromUnit(ratesForCurrencies.toString());

    if (!Number(retaValue) && item.address) {
      newKeys.push(item.symbol);
      await execute('Oracle', { from: deployer }, 'addAggregator', toBytes32(item.symbol), item.address);
    }
  }
  console.log(newKeys)

  // if (newKeys.length > 0) {
  //   await execute(
  //     'Oracle',
  //     { from: deployer },
  //     'updateRates',
  //     newKeys.map(item => toBytes32(item)),
  //     newKeys.map(item => (toUnit(1)).toString()),
  //     nowTime
  //   );
  // }

  for (const item of synths) {
    const getCurrentRoundId = await read('Oracle', {}, 'getCurrentRoundId', toBytes32(item.symbol));

    const value = await read('Oracle', {}, 'rateAndTimestampAtRound', toBytes32(item.symbol), getCurrentRoundId);
    console.log(item.symbol, fromUnit(value[0].toString()), value[1].toString());
  }

  const getDowsCurrentRoundId = await read('Oracle', {}, 'getCurrentRoundId', toBytes32('DOWS'));
  const dowsValue = await read('Oracle', {}, 'rateAndTimestampAtRound', toBytes32('DOWS'), getDowsCurrentRoundId);
  console.log('DOWS', fromUnit(dowsValue[0].toString()), dowsValue[1].toString());

};

module.exports.tags = ['InitOracle', 'Config'];


