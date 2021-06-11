const { toBytes32, bytesToString, fromUnit, toUnit, currentTime } = require("../utils");
const { synths } = require("../config/synths");
const { red } = require("bn.js");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];
  const nowTime = await currentTime();
  const testAccount = account1;

  // update DOWS rates  
  await execute(
    'Oracle',
    { from: deployer },
    'updateRates',
    ['xAUD', 'xEUR', 'xETH', 'xBTC'].map(item => toBytes32(item)),
    [0.5, 1.25, 2000, 30000].map(item => (toUnit(item)).toString()),
    nowTime
  );

  await execute(
    'Oracle',
    { from: deployer },
    'setRateStalePeriod',
    3600 * 3
  );

  const oracleConfig = [
    {
      name: 'USDT',
      address: '0xEca2605f0BCF2BA5966372C99837b1F182d3D620'
    },
    {
      name: 'BTC',
      address: '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'
    },
    {
      name: 'ETH',
      address: '0x143db3CEEfbdfe5631aDD3E50f7614B6ba708BA7'
    }
  ];



  const ratesForCurrencies = await read('Oracle', {}, 'ratesForCurrencies', ['USDT', 'BTC', 'ETH', 'xAUD', 'xEUR', 'DOWS'].map(item => toBytes32(item)))
  console.log(ratesForCurrencies.map(item => item.toString()));

  for (const item of oracleConfig) {
    await execute('Oracle', { from: deployer }, 'addAggregator', toBytes32(item.name), item.address);

    const getCurrentRoundId = await read('Oracle', {}, 'getCurrentRoundId', toBytes32(item.name));

    const value = await read('Oracle', {}, 'rateAndTimestampAtRound', toBytes32(item.name), getCurrentRoundId);
    console.log(fromUnit(value[0].toString()), value[1].toString());
  }

};

module.exports.tags = ['InitOracle', 'Config'];


