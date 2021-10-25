require('dotenv').config();
require('shadows-hardhat-deploy');
require('@openzeppelin/hardhat-upgrades');
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-truffle5");
require("@nomiclabs/hardhat-web3");
const we3utils = require('web3-utils');

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
  solidity: {
    compilers: [
      {
        version: "0.7.1",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
        },
      },
    ]
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 200
    },
    overrides: {
      "contracts/Synthesizer.sol": {
        version: "0.7.1",
        settings: { }
      }
    }
  },
  networks: {
    ropsten: {
      url: `https://ropsten.infura.io/v3/${infuraKey}`,
      accounts: {mnemonic: mnemonic},
      loggingEnabled: true
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${infuraKey}`,
      accounts: {mnemonic: mnemonic},
      loggingEnabled: true
    },
    bsctestnet: {
      url: process.env.BSC_TESTNET_PROVIDER_URL,
      accounts: {mnemonic: mnemonic},
      loggingEnabled: true,
      gasPrice: parseInt(we3utils.toWei("20", "gwei")),
    },
    bsctestnetv2: {
      url: process.env.BSC_TESTNET_PROVIDER_URL,
      accounts: {mnemonic: mnemonic},
      loggingEnabled: true,
      gasPrice: parseInt(we3utils.toWei("20", "gwei")),
    },
    bsc: {
      url: process.env.BSC_MAINNET_PROVIDER_URL,
      accounts: {mnemonic: mnemonic},
      loggingEnabled: true,
      gasPrice: parseInt(we3utils.toWei("5", "gwei")),
      chainId: 56
    }
  },
  namedAccounts: {
    deployer: {
        default: 0, // here this will by default take the first account as deployer
    },
    owner:{
        default: 1, // here this will by default take the second account as feeCollector (so in the test this will be a different account than the deployer)
    }
  }
};