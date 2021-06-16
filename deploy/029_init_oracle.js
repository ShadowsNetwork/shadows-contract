const { toBytes32, bytesToString, fromUnit, toUnit, currentTime } = require("../utils");
const { synths } = require("../config/synths");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];
  const nowTime = await currentTime();
  const testAccount = account1;

  // update DOWS rates  
  /*
  await execute(
    'Oracle',
    { from: deployer },
    'updateRates',
    ['xAUD', 'xEUR'].map(item => toBytes32(item)),
    [0.5, 1.25].map(item => (toUnit(item)).toString()),
    nowTime
  );
  */

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


  const oracleConfig = [
    {
      name: 'xBTC',
      address: '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'
    },
    {
      name: 'xETH',
      address: '0x143db3CEEfbdfe5631aDD3E50f7614B6ba708BA7'
    }
  ];


  for (const item of synths) {
    const ratesForCurrencies = await read('Oracle', {}, 'rateForCurrency', toBytes32(item.symbol));
    console.log(`${item.symbol} rete: ${fromUnit(ratesForCurrencies.toString())}`);
  }

  for (const item of oracleConfig) {
    //await execute('Oracle', { from: deployer }, 'addAggregator', toBytes32(item.name), item.address);

    const getCurrentRoundId = await read('Oracle', {}, 'getCurrentRoundId', toBytes32(item.name));

    const value = await read('Oracle', {}, 'rateAndTimestampAtRound', toBytes32(item.name), getCurrentRoundId);
    console.log(item.name, fromUnit(value[0].toString()), value[1].toString());
  }

  const getDowsCurrentRoundId = await read('Oracle', {}, 'getCurrentRoundId', toBytes32('DOWS'));
  const dowsValue = await read('Oracle', {}, 'rateAndTimestampAtRound', toBytes32('DOWS'), getDowsCurrentRoundId);
  console.log('DOWS', fromUnit(dowsValue[0].toString()), dowsValue[1].toString());

};

module.exports.tags = ['InitOracle', 'Config'];


