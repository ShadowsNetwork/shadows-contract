const { toBytes32, bytesToString, fromUnit, toUnit, currentTime } = require("../utils");
const { synths } = require("../config/synths");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];
  const nowTime = await currentTime();


  const newKeys = [];
  for (const item of synths) {
    const ratesForCurrencies = await read('Oracle', {}, 'rateForCurrency', toBytes32(item.symbol));
    console.log(`${item.symbol} rete: ${fromUnit(ratesForCurrencies.toString())}`);
  }
  console.log(newKeys)


  for (const item of synths) {
    const getCurrentRoundId = await read('Oracle', {}, 'getCurrentRoundId', toBytes32(item.symbol));

    const value = await read('Oracle', {}, 'rateAndTimestampAtRound', toBytes32(item.symbol), getCurrentRoundId);
    console.log(item.symbol, getCurrentRoundId.toString(), fromUnit(value[0].toString()), value[1].toString(), new Date(Number(value[1].toString() + '000')));
  }

  const getDowsCurrentRoundId = await read('Oracle', {}, 'getCurrentRoundId', toBytes32('DOWS'));
  const dowsValue = await read('Oracle', {}, 'rateAndTimestampAtRound', toBytes32('DOWS'), getDowsCurrentRoundId);
  console.log('DOWS', fromUnit(dowsValue[0].toString()), dowsValue[1].toString(), new Date(Number(dowsValue[1].toString() + '000')));

};

module.exports.tags = ['LogOracle'];


