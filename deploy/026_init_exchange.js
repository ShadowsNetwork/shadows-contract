const { toBytes32, bytesToString, fromUnit, toUnit, currentTime } = require("../utils");
const { synths } = require("../config/synths")

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3, account4] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];

  // accounts 'ShaUSD', 'xAUD', 'xEUR' balanceof
  // for (const index in accounts) {
  //   for (const synth of synths) {
  //     const synthBalanceOf = await read(synth.symbol, {}, 'balanceOf', accounts[index]);
  //     console.log(`account${index} ${synth.symbol} balanceOf : ${fromUnit(synthBalanceOf.toString())}`);
  //   }
  // }
  const nowTime = await currentTime();
  // change exchangeEnabled
  await execute(
    'Exchanger',
    { from: deployer },
    'setExchangeEnabled',
    true
  );

  await execute(
    'Oracle',
    { from: deployer },
    'updateRates',
    ['xAUD', 'xEUR', 'DOWS', 'xETH', 'xBTC'].map(item => toBytes32(item)),
    [0.5, 1.25, 0.1, 2000, 30000].map(item => (toUnit(item)).toString()),
    nowTime
  );

  // account1 exchange xAUD
  // account1 buy xAUD to ShaUSD
  const value = await read('xAUD', {}, 'balanceOf', account4);
  console.log(value.toString());
  // if (Number(value.toString()) <= 0) {
  console.log(account4, toBytes32('ShaUSD'),
    toUnit(2).toString(),
    toBytes32('xAUD'));
  await execute(
    'Synthesizer',
    { from: account4 },
    'exchange',
    toBytes32('ShaUSD'),
    toUnit(10).toString(),
    toBytes32('xAUD')
  );

  // await execute(
  //   'Synthesizer',
  //   { from: account1 },
  //   'exchange',
  //   toBytes32('xAUD'),
  //   toUnit(100).toString(),
  //   toBytes32('ShaUSD')
  // );
  // }

  // const value1 = await read('xAUD', {}, 'balanceOf', account2);
  // if (Number(value1.toString()) <= 0) {
  //   await execute(
  //     'Synthesizer',
  //     { from: account2 },
  //     'exchange',
  //     toBytes32('ShaUSD'),
  //     toUnit(5).toString(),
  //     toBytes32('xAUD')
  //   );
  // }

  // // get max balanceof from xAUD
  // const newvalue = await read('xAUD', {}, 'balanceOf', account1);
  // const maxValue = fromUnit(newvalue.toString());
  // // sell account1  max xAUD
  // if (maxValue > 0) {
  //   // await execute(
  //   //   'Synthesizer',
  //   //   { from: account1 },
  //   //   'exchange',
  //   //   toBytes32('xAUD'),
  //   //   toUnit(maxValue).toString(),
  //   //   toBytes32('ShaUSD')
  //   // );
  // }

};

module.exports.tags = ['Exchange', 'Config'];
module.exports.dependencies  = ['Exchanger'];


