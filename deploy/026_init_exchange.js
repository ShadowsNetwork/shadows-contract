const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths")

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];

  // accounts 'xUSD', 'xAUD', 'xEUR' balanceof
  // for (const index in accounts) {
  //   for (const synth of synths) {
  //     const synthBalanceOf = await read(synth.symbol, {}, 'balanceOf', accounts[index]);
  //     console.log(`account${index} ${synth.symbol} balanceOf : ${fromUnit(synthBalanceOf.toString())}`);
  //   }
  // }


  // change exchangeEnabled
  // await execute(
  //   'Exchanger',
  //   { from: deployer },
  //   'setExchangeEnabled',
  //   true
  // );

  // account1 exchange xAUD
  // account1 buy xAUD to xUSD
  const value = await read('xAUD', {}, 'balanceOf', account1);
  // if (Number(value.toString()) <= 0) {
    console.log(accounts);
  console.log(account1, toBytes32('xUSD'),
    toUnit(2).toString(),
    toBytes32('xAUD'));
  await execute(
    'Synthesizer',
    { from: account2 },
    'exchange',
    toBytes32('xUSD'),
    toUnit(2).toString(),
    toBytes32('xAUD')
  );

  // await execute(
  //   'Synthesizer',
  //   { from: account1 },
  //   'exchange',
  //   toBytes32('xAUD'),
  //   toUnit(100).toString(),
  //   toBytes32('xUSD')
  // );
  // }

  // const value1 = await read('xAUD', {}, 'balanceOf', account2);
  // if (Number(value1.toString()) <= 0) {
  //   await execute(
  //     'Synthesizer',
  //     { from: account2 },
  //     'exchange',
  //     toBytes32('xUSD'),
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
  //   //   toBytes32('xUSD')
  //   // );
  // }

};

module.exports.tags = ['Exchange', 'Config'];


