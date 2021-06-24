const { toBN } = require('web3-utils');
const { toBytes32, bytesToString, fromUnit, toUnit } = require("../utils");
const xlsx = require('node-xlsx')
const fs = require('fs');
const { join, resolve } = require('path');

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
  const { deploy, get, execute, read } = deployments;
  const { deployer, shadowsOwner } = await getNamedAccounts();

  const value = fs.readFileSync(join(process.cwd(), 'wallet address.xlsx'));
  const result = xlsx.parse(value);
  let data = []
  for (const item of result) {
    for (const val of item.data) {
      data = [
        ...data,
        ...val
      ]
    }
  }

  const sleep = (time) => {
    return new Promise(resolve => {
      setTimeout(() => {
        console.log('end');
        resolve();
      }, time || 5000)
    })
  }
  console.log(data);
  console.log(data.length * 100000)
  for (const account of data) {
    console.log(account);
    await execute(
      'Shadows',
      { from: deployer },
      'transfer',
      account,
      toUnit('100000').toString()
    );
    await sleep(5000);
  }
};
module.exports.tags = ['TransferUsersShadows', 'Config'];
