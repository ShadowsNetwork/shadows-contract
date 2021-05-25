const { toBN } = require('web3-utils');
const { toBytes32, bytesToString, fromUnit, toUnit, currentTime } = require("../utils");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;

  const shadows = await get('Shadows');
  const { deployer, ...args } = await getNamedAccounts();
  const [account1, account2, account3] = await getUnnamedAccounts();
  const accounts = [account1, account2, account3];
  const nowTime = await currentTime();

  // update DOWS rates  
  await execute(
    'Oracle',
    { from: deployer },
    'updateRates',
    ['xAUD', 'xEUR', 'DOWS'].map(item => toBytes32(item)),
    [0.5, 1.25, 0.1].map(item => (10 ** 18 * item).toString()),
    nowTime
  );

  // transfer Dows to some account
  for (const account of accounts) {
    const balance = await read('Shadows', {}, 'balanceOf', account);
    if (Number(balance.toString()) <= 0) {
      await execute(
        'Shadows',
        { from: deployer },
        'transfer',
        account,
        toUnit('6000').toString()
      );
    }
  }

  // account3 replace account2 send 100 to account1
  // await execute(
  //   'Shadows',
  //   { from: account2 },
  //   'approve',
  //   account3,
  //   toUnit('100').toString()
  // );

  // await execute(
  //   'Shadows',
  //   { from: account3 },
  //   'transferFrom',
  //   account2,
  //   account1,
  //   toUnit('100').toString()
  // );

  // for (const account of accounts) {
  //   const balance = await read('Shadows', {}, 'balanceOf', account);
  //   console.log(balance.toString());
  // }

  // const remaining = await read('Shadows',{}, 'allowance', account2, account3);
  // console.log(remaining.toString());
};

module.exports.tags = ['TransferShadows', 'Config'];

