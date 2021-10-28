const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const { synths } = require("../config/synths")

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];

  let FEE = await read('FeePool', {}, 'exchangeFeeRate');
  console.log(FEE.toString());

  // change ExchangeFeeRate; default:0.0030
  await execute(
    'FeePool',
    { from: deployer },
    'setExchangeFeeRate',
    toUnit("0.0030").toString(),
  );

  FEE = await read('FeePool', {}, 'exchangeFeeRate');
  console.log(FEE.toString());


  let reta = await read('Oracle', {}, 'rateForCurrency', toBytes32('DOWS'));
  console.log('DOWS reta:', reta.toString());
};

module.exports.tags = ['InitExchangeFee','deploy'];


