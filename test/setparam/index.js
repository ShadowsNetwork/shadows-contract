'use strict';

const fs = require('fs');
const path = require('path');

const Web3 = require('web3');

const { yellow, gray, red, green } = require('chalk');

const commander = require('commander');
const program = new commander.Command();

const { toWei } = require('web3-utils');
require('dotenv').config();

const dows = require('../..');
const { toBytes32 } = dows;

const commands = {
	build: require('../../publish/src/commands/build').build,
	deploy: require('../../publish/src/commands/deploy').deploy,
};

const { loadLocalUsers, isCompileRequired } = require('../utils/localUtils');
const { currentTime, fastForward, toUnit } = require('../utils/testUtils');

const { loadConnections, confirmAction } = require('../../publish/src/util');

const logExchangeRates = (
	currencyKeys,
	rates,
	times,
	timestamp = Math.round(Date.now() / 1000)
) => {
	const results = [];
	for (let i = 0; i < rates.length; i++) {
		const rate = Web3.utils.fromWei(rates[i]);
		results.push({
			key: currencyKeys[i].name,
			price: rate,
			date: new Date(times[i] * 1000),
			ago: timestamp - times[i],
		});
	}
	for (const rate of results) {
		console.log(
			gray('currencyKey:'),
			yellow(rate.key),
			gray('price:'),
			yellow(rate.price),
			gray('when:'),
			yellow(Math.round(rate.ago / 60), gray('mins ago'))
		);
	}
};

program
	.option('-n, --network <value>', 'The network to run off.', x => x.toLowerCase(), 'kovan')
	.option('-g, --gas-price <value>', 'Gas price in GWEI', '5')
	.option('-y, --yes', 'Dont prompt, just reply yes.')
	.action(async ({ network, yes, gasPrice: gasPriceInGwei }) => {
		if (!/^(kovan|rinkeby|ropsten|mainnet|local)$/.test(network)) {
			throw Error('Unsupported environment', network);
		}
		let esLinkPrefix;
		try {
			console.log(`Running tests on ${network}`);

			const { providerUrl, privateKey: envPrivateKey, etherscanLinkPrefix } = loadConnections({
				network,
			});
			esLinkPrefix = etherscanLinkPrefix;

			let privateKey = envPrivateKey;

			const web3 = new Web3(new Web3.providers.HttpProvider(providerUrl));
			console.log(providerUrl)
			const synths = dows.getSynths({ network });

			const gas = 4e6; // 4M
			const gasPrice = web3.utils.toWei(gasPriceInGwei, 'gwei');
			const [xUSD, xETH] = ['xUSD', 'xETH'].map(toBytes32);

			console.log(toBytes32('xUSD'),toBytes32('xJPY'));

			const updateableSynths = synths.filter(({ name }) => ['xUSD'].indexOf(name) < 0);
			const cryptoSynths = synths
				.filter(({ asset }) => asset !== 'USD')
				.filter(
					({ category }) => category === 'crypto' || category === 'internal' || category === 'index'
				);

			const forexSynths = synths
				.filter(({ asset }) => asset !== 'USD')
				.filter(({ category }) => category === 'forex' || category === 'commodity');

			let timestamp; // used for local

			const sources = dows.getSource({ network });
			const targets = dows.getTarget({ network });

			const owner = web3.eth.accounts.wallet.add(privateKey);

			// We are using the testnet deployer account, so presume they have some testnet ETH
			const user1 = web3.eth.accounts.create();
			web3.eth.accounts.wallet.add(user1);
			console.log(gray(`Created test account ${user1.address}`));
			console.log(gray(`Owner account ${owner.address}`));

			// store keys in local file in case error and need to recover account
			fs.appendFileSync(
				path.join(__dirname, 'test_keys.txt'),
				`${new Date().toString()}\t\t${network}\t\t${user1.address}\t\t${user1.privateKey}\n`
			);
			console.log(gray(`Test privkeys: ${user1.privateKey}`));

			/** VIEWS OF SHADOWS STATUS **/

			const exchangeRates = new web3.eth.Contract(
				sources['ExchangeRates'].abi,
				targets['ExchangeRates'].address
			);
			const currencyKeys = [{ name: 'DOWS' }].concat(cryptoSynths).concat(forexSynths);
			const currencyKeysBytes = currencyKeys.map(key => toBytes32(key.name));

			// set rates
            const newPrices = {
				'DOWS':'20',
				'xBTC':'50000',
				'xETH':'2000',
				'xBNB':'1',
				'xMKR':'1',
				'xTRX':'1',
				'xXTZ':'1',
				'sXRP':'1',
				'sLTC':'1',
				'sLINK':'1',
				'xCEX':'1',
				'sDEFI':'1',
				'iBTC':'1',
				'iETH':'1',
				'iBNB':'1',
				'iMKR':'1',
				'iTRX':'1',
				'iXTZ':'1',
				'iXRP':'1',
				'iLINK':'1',
				'iLTC':'1',
				'iCEX':'1',
				'iDEFI':'1',
				'xEUR':'1.21217255',
				'xJPY':'0.00946388',
				'xAUD':'0.7884016',
				'xGBP':'1.40189165',
				'xCHF':'1.1142341',
				'xXAU':'1785.6825',
				'xXAG':'27.513475',
			}

			const currencyKeysPrices = currencyKeys.map(key => newPrices[key.name]);
			const t = await currentTime()+60;
			await exchangeRates.methods.updateRates(
				currencyKeysBytes,
				currencyKeysPrices.map(toUnit),
				t
			).send({ from: owner.address, gas, gasPrice });

			await exchangeRates.methods.setRateStalePeriod(86400*365).send({ from: owner.address, gas, gasPrice });

			//console.log(currencyKeysBytes)

			// View all current ExchangeRates
			const rates = await exchangeRates.methods.ratesForCurrencies(currencyKeysBytes).call();

			const times = await exchangeRates.methods
				.lastRateUpdateTimesForCurrencies(currencyKeysBytes)
				.call();

			logExchangeRates(currencyKeys, rates, times, timestamp);
			const ratesAreStale = await exchangeRates.methods.anyRateIsStale(currencyKeysBytes).call();

			console.log(green(`RatesAreStale - ${ratesAreStale}`));

			console.log();
			console.log(gray(`Integration test on ${network.toUpperCase()} completed successfully.`));
		} catch (err) {
			if (/Transaction has been reverted/.test(err)) {
				const txnHash = err.message.match(/(?:"transactionHash":\s")(\w+)(")/)[1];
				console.error(red(`Failure: EVM reverted ${esLinkPrefix}/tx/${txnHash}`));
			} else {
				console.error(err);
			}
			process.exitCode = 1;
		}
	});

// perform as CLI tool if not run as module
if (require.main === module) {
	require('pretty-error').start();

	program.parse(process.argv);
}
