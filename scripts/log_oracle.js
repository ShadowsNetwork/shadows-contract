const { toBytes32, bytesToString, fromUnit, toUnit, currentTime } = require("../utils");
const { synths } = require("../config/synths");

(async () => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];
  const nowTime = await currentTime();

  const getDowsCurrentRoundId = await read('Oracle', {}, 'getCurrentRoundId', toBytes32('DOWS'));
  const dowsValue = await read('Oracle', {}, 'rateAndTimestampAtRound', toBytes32('DOWS'), getDowsCurrentRoundId);
  const rateIsStale = await read('Oracle', {}, 'rateIsStale', toBytes32('DOWS'));
  console.log('DOWS',rateIsStale, fromUnit(dowsValue[0].toString()), dowsValue[1].toString(), new Date(Number(dowsValue[1].toString() + '000')));

  for (const item of synths) {
    const getCurrentRoundId = await read('Oracle', {}, 'getCurrentRoundId', toBytes32(item.symbol));
    const rateIsStale = await read('Oracle', {}, 'rateIsStale', toBytes32(item.symbol));
    const value = await read('Oracle', {}, 'rateAndTimestampAtRound', toBytes32(item.symbol), getCurrentRoundId);
    console.log(item.symbol,rateIsStale, getCurrentRoundId.toString(), fromUnit(value[0].toString()), value[1].toString(), new Date(Number(value[1].toString() + '000')));
  }

})();
