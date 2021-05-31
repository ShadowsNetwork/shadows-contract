const { toBytes32, bytesToString, fromUnit, toUnit, currentTime } = require("../utils");
const { synths } = require("../config/synths");
const { red } = require("bn.js");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const lines = '-----------------------------';

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
    ['xAUD', 'xEUR', 'DOWS'].map(item => toBytes32(item)),
    [0.5, 1.25, 0.1].map(item => (10 ** 18 * item).toString()),
    nowTime
  );


  console.log(lines);
  const rates = [0.5, 1.25, 0.1];
  ['xAUD', 'xEUR', 'DOWS'].map((item, index) => console.log(`${item} Rate: ${rates[index]}`));


  console.log(lines);
  console.log(`account (${testAccount}) info:`);
  let issuanceRatio = await read('Synthesizer', {}, 'issuanceRatio');
  issuanceRatio = Number(fromUnit(issuanceRatio.toString()));

  let dowsRate = await read('Oracle', {}, 'rateForCurrency', toBytes32('DOWS'))
  dowsRate = Number(fromUnit(dowsRate.toString()));

  let yourBabance = await read('Shadows', {}, 'balanceOf', testAccount);
  yourBabance = Number(fromUnit(yourBabance.toString()));
  console.log(`Your balance: $${yourBabance * dowsRate}`);

  let assetsBabance = await read('Synthesizer', {}, 'transferableShadows', testAccount);
  assetsBabance = Number(fromUnit(assetsBabance.toString()));
  console.log(`Assets balnace: $${assetsBabance * dowsRate}`);

  let debtPool = await read('Synthesizer', {}, 'debtBalanceOf', testAccount, toBytes32('DOWS'));
  debtPool = Number(fromUnit(debtPool.toString()));
  console.log(`Debt DowsPool: $${debtPool / issuanceRatio * dowsRate}`);


  console.log(lines);
  const coinArr = ['USDT', 'BTC', 'ETH'];
  const ratesForCurrencies = await read('Oracle', {}, 'ratesForCurrencies', coinArr.map(item => toBytes32(item)))
  ratesForCurrencies.map((item, index) => {
    console.log(`Asset : ${coinArr[index]}, Qty: 0, Value: $${fromUnit(item.toString())}`)
  });


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
  let totalEscrowedAccountBalance = await read('RewardEscrow', {}, 'totalEscrowedAccountBalance', testAccount);
  let totalVestedAccountBalance = await read('RewardEscrow', {}, 'totalVestedAccountBalance', testAccount);
  totalEscrowedAccountBalance = Number(fromUnit(totalEscrowedAccountBalance.toString()));
  totalVestedAccountBalance = Number(fromUnit(totalVestedAccountBalance.toString()));

  console.log(`Tatal Rewards: ${totalEscrowedAccountBalance + totalVestedAccountBalance}`);
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


  console.log(lines);
  const remainingIssuableSynths = await read('Synthesizer', {}, 'remainingIssuableSynths', testAccount);
  console.log(`max issure xUSD: ${fromUnit(remainingIssuableSynths[0].toString())}`);
  console.log(`already issure xUSD: ${fromUnit(remainingIssuableSynths[1].toString())}`);

  for (const synth of synths) {
    let xUSDPool = await read('Synthesizer', {}, 'debtBalanceOf', testAccount, toBytes32(synth.symbol));
    console.log(`${synth.name} max balance: ${fromUnit(xUSDPool.toString())}`);

    const availableBalance = await read(synth.symbol, {}, 'transferableSynths', testAccount);
    console.log(`${synth.name} available Balance: ${fromUnit(availableBalance.toString())}`);

  }
};

module.exports.tags = ['InfoShadows', 'Config'];


