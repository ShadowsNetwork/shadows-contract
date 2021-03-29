require('dotenv').config();
require('hardhat-deploy');
require('@openzeppelin/hardhat-upgrades');
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-truffle5");
require("@nomiclabs/hardhat-web3");

const mnemonic = process.env.MNEMONIC;
const infuraKey = process.env.INFURAKEY;

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.6.11",
  settings: {
    optimizer: {
      enabled: true,
      runs: 200
    }
  },
  networks: {
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${infuraKey}`,
      accounts: {mnemonic: mnemonic},
      loggingEnabled: true
    },
    bsctestnet: {
      url: process.env.BSC_TESTNET_PROVIDER_URL,
      accounts: {mnemonic: mnemonic},
      loggingEnabled: true,
      gas: 'auto'
    }
  },
  namedAccounts: {
    deployer: {
        default: 0, // here this will by default take the first account as deployer
        shadowsOwner: 1
    },
    feeCollector:{
        default: 1, // here this will by default take the second account as feeCollector (so in the test this will be a different account than the deployer)
    }
  }
};