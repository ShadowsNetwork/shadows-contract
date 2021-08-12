const { toBytes32, bytesToString, fromUnit, toUnit, currentTime, divideDecimal, multiplyDecimal } = require("../utils");
const { synths } = require("../config/synths");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const lines = '-----------------------------';

  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];
  const nowTime = await currentTime();
  const testAccount = deployer;

  // console.log('deployer:', deployer);
  // console.log('now:', nowTime);

  console.log(lines);
  // for (const item of ['xAUD', 'xEUR', 'DOWS', 'xETH', 'xBTC', 'xGOLD', 'xSILVER', 'xCOINBASE']) {
  //   let reta = await read('Oracle', {}, 'rateForCurrency', toBytes32(item));
  //   console.log(`${item} reta: $${fromUnit(reta.toString())}`);
  // }

  let dowsRate = await read('Oracle', {}, 'rateForCurrency', toBytes32('DOWS'))
  console.log(`DOWS reta: $${fromUnit(dowsRate.toString())}`); // dows reta
  dowsRate = Number(fromUnit(dowsRate.toString()));

  console.log(lines);

  let allPrice = toUnit('0');
  for (const synth of synths) {
    // let xUSDPool = await read('Synthesizer', {}, 'debtBalanceOf', testAccount, toBytes32(synth.symbol));
    // console.log(`${synth.name} max balance: ${fromUnit(xUSDPool.toString())}`);

    const availableBalance = await read(synth.symbol, {}, 'transferableSynths', testAccount);
    const reta = await read('Oracle', {}, 'rateForCurrency', toBytes32(synth.symbol));

    const _value = multiplyDecimal(availableBalance.toString(), reta.toString());
    console.log(`${synth.name} Balance: ${fromUnit(availableBalance.toString())}, value: $${fromUnit(_value.toString())}`);

    allPrice = allPrice.add(_value);
    // allPrice = allPrice.add()
  }

  const xusdavailableBalance = await read('xUSD', {}, 'transferableSynths', testAccount);
  console.log(`xUSD Balance: ${fromUnit(xusdavailableBalance.toString())}, value: $${fromUnit(xusdavailableBalance.toString())}`);

  allPrice = allPrice.add(toUnit(fromUnit(xusdavailableBalance.toString())));

  console.log(lines);
  console.log(`account (${testAccount}) info:`);
  let issuanceRatio = await read('Synthesizer', {}, 'issuanceRatio');
  issuanceRatio = Number(fromUnit(issuanceRatio.toString()));

  let yourBabance = await read('Shadows', {}, 'balanceOf', testAccount);
  yourBabance = Number(fromUnit(yourBabance.toString()));
  console.log(`Your balance: $${fromUnit(toUnit(yourBabance * dowsRate).add(allPrice).toString())}`);

  let assetsBabance = await read('Synthesizer', {}, 'transferableShadows', testAccount);
  assetsBabance = Number(fromUnit(assetsBabance.toString()));
  console.log(`DOWS balnace: $${assetsBabance * dowsRate}`);

  // let debtPool = await read('Synthesizer', {}, 'debtBalanceOf', testAccount, toBytes32('DOWS'));
  // debtPool = Number(fromUnit(debtPool.toString()));
  console.log(`Net Trading Balance: $${fromUnit(allPrice.toString())}`);


  // console.log(lines);
  // const coinArr = ['USDT', 'BTC', 'ETH'];
  // const ratesForCurrencies = await read('Oracle', {}, 'ratesForCurrencies', coinArr.map(item => toBytes32(item)))
  // ratesForCurrencies.map((item, index) => {
  //   console.log(`Asset : ${coinArr[index]}, Qty: 0, Value: $${fromUnit(item.toString())}`)
  // });

  console.log(lines);
  const remainingIssuableSynths = await read('Synthesizer', {}, 'remainingIssuableSynths', testAccount);
  console.log(`max issure xUSD: ${fromUnit(remainingIssuableSynths[0].toString())}`);
  console.log(`already issure xUSD: ${fromUnit(remainingIssuableSynths[1].toString())}`);

  console.log(lines);
  const collateralisationRatio = await read('Synthesizer', {}, 'collateralisationRatio', testAccount);
  console.log(`Current Collateral: ${(1 / Number(fromUnit(collateralisationRatio.toString())) * 100).toFixed(2)}%`);
  console.log(`Target Collateral: 500.00%`);


  console.log(lines);
  const lockBabance = yourBabance - assetsBabance;
  console.log(`Tatal DOWS: ${yourBabance}`);
  console.log(`Avalable: ${assetsBabance}`);
  console.log(`Locked: ${lockBabance}`);
  console.log(`Staked: ${lockBabance}`);


  console.log(lines);
  let totalFeeAccountBalance = await read('FeePool', {}, 'feesByPeriod', testAccount);
  let totalFeeBalance = await read('FeePool', {}, 'feesAvailable', testAccount);

  const xusdTotalRewards = totalFeeAccountBalance.reduce((sum, item) =>
    sum.add(toUnit(fromUnit(item[0].toString())))
    , toUnit(0));

  console.log(`Tatal xUSD Rewards: ${fromUnit(xusdTotalRewards.toString())}`);
  console.log(`Redeemable: ${fromUnit(totalFeeBalance[0].toString())}`);


  const dowsTotal = fromUnit(totalFeeAccountBalance.reduce((sum, item) =>
    sum.add(toUnit(fromUnit(item[1].toString())))
    , toUnit(0)));

  console.log(lines);
  let totalEscrowedAccountBalance = await read('RewardEscrow', {}, 'totalEscrowedAccountBalance', testAccount);
  let totalVestedAccountBalance = await read('RewardEscrow', {}, 'totalVestedAccountBalance', testAccount);
  totalEscrowedAccountBalance = Number(fromUnit(totalEscrowedAccountBalance.toString()));
  totalVestedAccountBalance = Number(fromUnit(totalVestedAccountBalance.toString()));

  console.log(`Tatal Dows Rewards: ${totalEscrowedAccountBalance + Number(dowsTotal)}`);
  console.log(`Escrowed: ${totalEscrowedAccountBalance}`);
  console.log(`Redeemable: ${totalVestedAccountBalance}`);


  console.log(lines);
  const availableCurrencyKeys = await read('Synthesizer', {}, 'availableCurrencyKeys');
  const symbolArr = availableCurrencyKeys.map(item => bytesToString(item));

  console.log(`all crypto fiat commodities equities: ${symbolArr}`);

  for (const keys of availableCurrencyKeys) {
    const rate = await read('Oracle', {}, 'rateForCurrency', keys);
    console.log(`Symbol: ${bytesToString(keys)}/xUSD; Last Price: $${fromUnit(rate.toString())}`);
  }


};

module.exports.tags = ['InfoShadows', 'Config'];


