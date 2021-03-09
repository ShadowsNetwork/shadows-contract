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
const { currentTime, fastForward } = require('../utils/testUtils');

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
			const synths = dows.getSynths({ network });

			const gas = 4e6; // 4M
			const gasPrice = web3.utils.toWei(gasPriceInGwei, 'gwei');
			const [xUSD, xETH] = ['xUSD', 'xETH'].map(toBytes32);

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

			// when run on the local network,
			if (network === 'local') {
				// build
				if (isCompileRequired()) {
					await commands.build();
				}
				// load accounts used by local ganache in keys.json
				const users = loadLocalUsers();

				// and use the first as the main private key (owner/deployer)
				privateKey = users[0].private;

				// now deploy
				await commands.deploy({
					network,
					deploymentPath: path.join(__dirname, '..', '..', 'publish', 'deployed', 'local'),
					yes: true,
					privateKey,
				});

				// now setup rates
				// make sure exchange rates has a price
				const ExchangeRates = new web3.eth.Contract(
					dows.getSource({ network, contract: 'ExchangeRates' }).abi,
					dows.getTarget({ network, contract: 'ExchangeRates' }).address
				);
				timestamp = await currentTime();

				// update rates
				await ExchangeRates.methods
					.updateRates(
						[toBytes32('DOWS'), toBytes32('ETH')].concat(
							updateableSynths.map(({ name }) => toBytes32(name))
						),
						[toWei('0.3'), toWei('1')].concat(updateableSynths.map(() => toWei('1'))),
						timestamp
					)
					.send({
						from: users[0].public,
						gas,
						gasPrice,
					});
			}

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

			// View all current ExchangeRates
			const rates = await exchangeRates.methods.ratesForCurrencies(currencyKeysBytes).call();

			const times = await exchangeRates.methods
				.lastRateUpdateTimesForCurrencies(currencyKeysBytes)
				.call();

			logExchangeRates(currencyKeys, rates, times, timestamp);

			const ratesAreStale = await exchangeRates.methods.anyRateIsStale(currencyKeysBytes).call();

			console.log(green(`RatesAreStale - ${ratesAreStale}`));
			if (ratesAreStale) {
				throw Error('Rates are stale');
			}

			// Shadows contract
			const Shadows = new web3.eth.Contract(
				sources['Shadows'].abi,
				targets['ProxyShadows'].address
			);

			const ShadowsState = new web3.eth.Contract(
				sources['ShadowsState'].abi,
				targets['ShadowsState'].address
			);

			const Exchanger = new web3.eth.Contract(
				sources['Exchanger'].abi,
				targets['Exchanger'].address
			);

			const EtherCollateral = new web3.eth.Contract(
				sources['EtherCollateral'].abi,
				targets['EtherCollateral'].address
			);

			const Depot = new web3.eth.Contract(sources['Depot'].abi, targets['Depot'].address);
			const SynthxUSD = new web3.eth.Contract(sources['Synth'].abi, targets['ProxyxUSD'].address);

			// Check totalIssuedSynths and debtLedger matches
			const totalIssuedSynths = await Shadows.methods.totalIssuedSynths(xUSD).call();
			const debtLedgerLength = await ShadowsState.methods.debtLedgerLength().call();

			console.log(
				green(
					`TotalIssuedSynths in xUSD: ${totalIssuedSynths} - debtLedgerLenght: ${debtLedgerLength}`
				)
			);

			if (debtLedgerLength > 0 && totalIssuedSynths === 0) {
				throw Error('DebtLedger has debt but totalIssuedSynths is 0');
			}

			const feePool = new web3.eth.Contract(sources['FeePool'].abi, targets['FeePool'].address);
			const feePeriodLength = await feePool.methods.FEE_PERIOD_LENGTH().call();

			// Unless on local, check feePeriods are imported for feePool correctly with feePeriodId set
			/*
			if (network !== 'local') {
				for (let i = 0; i < feePeriodLength; i++) {
					const period = await feePool.methods.recentFeePeriods(i).call();
					if (period.feePeriodId === '0') {
						throw Error(
							`Fee period at index ${i} has not been set. Check if fee periods have been imported`
						);
					}
				}
			}
			*/

			console.log(gray(`Using gas price of ${gasPriceInGwei} gwei.`));

			if (!yes) {
				try {
					await confirmAction(yellow(`Do you want to continue? (y/n) `));
				} catch (err) {
					console.log(gray(`Operation terminated`));
					return;
				}
			}

			const txns = [];

			const lastTxnLink = () => `${etherscanLinkPrefix}/tx/${txns.slice(-1)[0].transactionHash}`;

			// #1 - Send the account some test ether
			console.log(gray(`Transferring 0.05 test ETH to ${user1.address}`));
			txns.push(
				await web3.eth.sendTransaction({
					from: owner.address,
					to: user1.address,
					value: web3.utils.toWei('0.05'),
					gas,
					gasPrice,
				})
			);
			console.log(green(`Success. ${lastTxnLink()}`));

			// Note: we are using numbers in WEI to 1e-13 not ether (i.e. not with 18 decimals),
			// so that if a test fails we only lose minor amounts of DOWS and xUSD (i.e. dust). - JJ

			// #2 - Now some test DOWS
			console.log(gray(`Transferring 2e-11 DOWS to user1 (${user1.address})`));
			txns.push(
				await Shadows.methods.transfer(user1.address, web3.utils.toWei('0.00000000002')).send({
					from: owner.address,
					gas,
					gasPrice,
				})
			);
			console.log(green(`Success. ${lastTxnLink()}`));

			// #3 - Mint some xUSD from test account
			console.log(gray(`Issuing 1e-13 xUSD from (${user1.address}`));
			const amountToIssue = web3.utils.toWei('0.0000000000001');
			txns.push(
				await Shadows.methods.issueSynths(amountToIssue).send({
					from: user1.address,
					gas,
					gasPrice,
				})
			);
			console.log(green(`Success. ${lastTxnLink()}`));

			// get balance
			const balance = await SynthxUSD.methods.balanceOf(user1.address).call();
			console.log(gray(`User1 has xUSD balanceOf - ${balance}`));

			// #4 - Deposit xUSD to Depot, approve first
			console.log(gray(`SynthxUSD approve to use Depot`));
			txns.push(
				await SynthxUSD.methods.approve(Depot.options.address, toWei('1')).send({
					from: user1.address,
					gas,
					gasPrice,
				})
			);
			console.log(green(`Success. ${lastTxnLink()}`));

			// then deposit
			console.log(gray(`Deposit 1e-14 xUSD to Depot from (${user1.address})`));
			const amountToDeposit = web3.utils.toWei('0.00000000000001');
			txns.push(
				await Depot.methods.depositSynths(amountToDeposit).send({
					from: user1.address,
					gas,
					gasPrice,
				})
			);
			console.log(green(`Success. ${lastTxnLink()}`));

			// check balance
			const balanceAfter = await SynthxUSD.methods.balanceOf(user1.address).call();
			console.log(gray(`User1 has xUSD balanceOf - ${balanceAfter}`));

			// #5 Exchange xUSD to xETH
			console.log(gray(`Exchange 1e-14 xUSD --> xETH for user - (${user1.address})`));
			const amountToExchange = web3.utils.toWei('0.00000000000001');
			txns.push(
				await Shadows.methods.exchange(xUSD, amountToExchange, xETH).send({
					from: user1.address,
					gas,
					gasPrice,
				})
			);
			console.log(green(`Success. ${lastTxnLink()}`));

			// check xETH balance after exchange
			const SynthxETH = new web3.eth.Contract(sources['Synth'].abi, targets['ProxyxETH'].address);
			const xETHBalance = await SynthxETH.methods.balanceOf(user1.address).call();
			console.log(gray(`User1 has xETH balanceOf - ${xETHBalance}`));

			// #6 + EtherCollateral open close loan
			// step 1: allow a tiny loan
			const ethCollateralMinLoanSize = await EtherCollateral.methods.minLoanSize().call();
			console.log(gray(`Setting EtherCollateral minLoanSize to 1e-16 ETH`));
			txns.push(
				await EtherCollateral.methods
					.setMinLoanSize(toWei('0.0000000000000001'))
					.send({ from: owner.address, gas, gasPrice })
			);
			console.log(green(`Success. ${lastTxnLink()}`));

			// step 2: open a loan
			console.log(gray(`Open 1e-16 ETH loan for user (${user1.address})`));
			txns.push(
				await EtherCollateral.methods
					.openLoan()
					.send({ from: user1.address, value: toWei('0.0000000000000001'), gas, gasPrice })
			);
			const { loanID } = txns.slice(-1)[0].events.LoanCreated.returnValues;
			console.log(green(`Success, loadID: ${loanID}. ${lastTxnLink()}`));

			// step 3: close the loan
			console.log(gray(`Close loanID: ${loanID} for user (${user1.address})`));
			txns.push(
				await EtherCollateral.methods.closeLoan(loanID).send({ from: user1.address, gas, gasPrice })
			);
			console.log(green(`Success. ${lastTxnLink()}`));

			// step 4: return minLoanSize to original value
			console.log(gray(`Setting EtherCollateral minLoanSize back to original value`));
			txns.push(
				await EtherCollateral.methods
					.setMinLoanSize(ethCollateralMinLoanSize)
					.send({ from: owner.address, gas, gasPrice })
			);
			console.log(green(`Success. ${lastTxnLink()}`));

			// #7 Exchange balance of xETH back to xUSD
			const tryExchangeBack = async () => {
				console.log(gray(`Exchange xETH --> xUSD for user - (${user1.address})`));
				txns.push(
					await Shadows.methods.exchange(xETH, xETHBalance, xUSD).send({
						from: user1.address,
						gas,
						gasPrice,
					})
				);
				console.log(green(`Success. ${lastTxnLink()}`));
			};

			const waitingPeriodSecs = await Exchanger.methods.waitingPeriodSecs().call();

			try {
				await tryExchangeBack();

				console.error(red('Should have failed immediately exchanging back by Fee Reclamation'));
				process.exitCode = 1;
			} catch (err) {
				// Expect to fail as the waiting period is ongoing
				// Can't guarantee getting the revert reason however.
				await new Promise((resolve, reject) => {
					if (network === 'local') {
						console.log(
							gray(
								`Fast forward ${waitingPeriodSecs}s until we can exchange the dest synth again...`
							)
						);
						fastForward(waitingPeriodSecs)
							.then(tryExchangeBack)
							.then(resolve)
							.catch(reject);
					} else {
						console.log(
							gray(`Waiting ${waitingPeriodSecs}s until we can exchange the dest synth again...`)
						);
						setTimeout(async () => {
							await tryExchangeBack();
							resolve();
						}, +waitingPeriodSecs * 1000);
					}
				});
			}

			// #8 Burn all remaining xUSD to unlock DOWS
			const remainingSynthxUSD = await SynthxUSD.methods.balanceOf(user1.address).call();
			const tryBurn = async () => {
				console.log(gray(`Burn all remaining synths for user - (${user1.address})`));
				txns.push(
					await Shadows.methods.burnSynths(remainingSynthxUSD).send({
						from: user1.address,
						gas,
						gasPrice,
					})
				);
				console.log(green(`Success. ${lastTxnLink()}`));
			};

			try {
				await tryBurn();

				console.error(
					red('Should have failed burning after exchanging into xUSD by Fee Reclamation')
				);
				process.exitCode = 1;
				return;
			} catch (err) {
				// Expect to fail as the waiting period is ongoing
				// Can't guarantee getting the revert reason however.
				await new Promise((resolve, reject) => {
					if (network === 'local') {
						console.log(
							gray(`Fast forward ${waitingPeriodSecs}s until we can try burn dest synth again...`)
						);
						fastForward(waitingPeriodSecs)
							.then(tryBurn)
							.then(resolve)
							.catch(reject);
					} else {
						console.log(
							gray(`Waiting ${waitingPeriodSecs}s until we can try burn dest synth again...`)
						);
						setTimeout(async () => {
							await tryBurn();
							resolve();
						}, +waitingPeriodSecs * 1000);
					}
				});
			}

			// check transferable DOWS after burning
			const transferableDOWS = await Shadows.methods.transferableShadows(user1.address).call();
			console.log(gray(`Transferable DOWS of ${transferableDOWS} for user (${user1.address}`));

			// #9 Transfer DOWS back to owner
			console.log(gray(`Transferring DOWS back to owner (${user1.address}`));
			txns.push(
				await Shadows.methods.transfer(user1.address, transferableDOWS).send({
					from: user1.address,
					gas,
					gasPrice,
				})
			);
			console.log(green(`Success. ${lastTxnLink()}`));

			// TODO: if fees available claim, check feePeriod closable, close if it can be closed and claim fees.

			// #10 Withdraw any remaining deposited synths from Depot
			console.log(gray(`Withdraw any remaining xUSD from Depot for (${user1.address})`));
			txns.push(
				await Depot.methods.withdrawMyDepositedSynths().send({
					from: user1.address,
					gas,
					gasPrice,
				})
			);

			const {
				events: { SynthWithdrawal },
			} = txns.slice(-1)[0];

			console.log(
				green(`Success, withdrawed ${SynthWithdrawal.returnValues.amount} xUSD. ${lastTxnLink()}`)
			);

			// #11 finally, send back all test ETH to the owner
			const testEthBalanceRemaining = await web3.eth.getBalance(user1.address);
			const gasLimitForTransfer = 21010; // a little over 21k to prevent occassional out of gas errors
			const testETHBalanceMinusTxnCost = (
				testEthBalanceRemaining -
				gasLimitForTransfer * gasPrice
			).toString();

			console.log(
				gray(
					`Transferring remaining test ETH back to owner (${web3.utils.fromWei(
						testETHBalanceMinusTxnCost
					)})`
				)
			);
			txns.push(
				await web3.eth.sendTransaction({
					from: user1.address,
					to: owner.address,
					value: testETHBalanceMinusTxnCost,
					gas: gasLimitForTransfer,
					gasPrice,
				})
			);
			console.log(green(`Success. ${lastTxnLink()}`));

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
