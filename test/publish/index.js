'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const Web3 = require('web3');

const { loadCompiledFiles } = require('../../publish/src/solidity');

const deployCmd = require('../../publish/src/commands/deploy');
const { buildPath } = deployCmd.DEFAULTS;
const { loadLocalUsers, isCompileRequired } = require('../utils/localUtils');

const commands = {
	build: require('../../publish/src/commands/build').build,
	deploy: deployCmd.deploy,
	replaceSynths: require('../../publish/src/commands/replace-synths').replaceSynths,
	purgeSynths: require('../../publish/src/commands/purge-synths').purgeSynths,
	removeSynths: require('../../publish/src/commands/remove-synths').removeSynths,
	importFeePeriods: require('../../publish/src/commands/import-fee-periods').importFeePeriods,
};

const {
	SYNTHS_FILENAME,
	CONFIG_FILENAME,
	DEPLOYMENT_FILENAME,
} = require('../../publish/src/constants');

const { fastForward } = require('../utils/testUtils');

const dows = require('../..');
const { toBytes32 } = dows;

// load accounts used by local ganache in keys.json
const users = loadLocalUsers();

describe('publish scripts', function() {
	this.timeout(30e3);
	const deploymentPath = path.join(__dirname, '..', '..', 'publish', 'deployed', 'local');

	// track these files to revert them later on
	const synthsJSONPath = path.join(deploymentPath, SYNTHS_FILENAME);
	const synthsJSON = fs.readFileSync(synthsJSONPath);
	const configJSONPath = path.join(deploymentPath, CONFIG_FILENAME);
	const configJSON = fs.readFileSync(configJSONPath);
	const deploymentJSONPath = path.join(deploymentPath, DEPLOYMENT_FILENAME);
	const logfilePath = path.join(__dirname, 'test.log');
	const network = 'local';
	let gasLimit;
	let gasPrice;
	let accounts;
	let DOWS;
	let xUSD;
	let xBTC;
	let xETH;
	let web3;
	let compiledSources;

	const resetConfigAndSynthFiles = () => {
		// restore the synths and config files for this env (cause removal updated it)
		fs.writeFileSync(synthsJSONPath, synthsJSON);
		fs.writeFileSync(configJSONPath, configJSON);

		// and reset the deployment.json to signify new deploy
		fs.writeFileSync(deploymentJSONPath, JSON.stringify({ targets: {}, sources: {} }));
	};

	before(() => {
		fs.writeFileSync(logfilePath, ''); // reset log file
	});

	beforeEach(async function() {
		console.log = (...input) => fs.appendFileSync(logfilePath, input.join(' ') + '\n');
		accounts = {
			deployer: users[0],
			first: users[1],
			second: users[2],
		};

		// get last build
		const { compiled } = loadCompiledFiles({ buildPath });
		compiledSources = compiled;

		if (isCompileRequired()) {
			console.log('Found source file modified after build. Rebuilding...');
			this.timeout(60000);
			await commands.build({ showContractSize: true });
		} else {
			console.log('Skipping build as everything up to date');
		}

		gasLimit = 5000000;
		[DOWS, xUSD, xBTC, xETH] = ['DOWS', 'xUSD', 'xBTC', 'xETH'].map(toBytes32);
		web3 = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:8545'));
		web3.eth.accounts.wallet.add(accounts.deployer.private);
		gasPrice = web3.utils.toWei('5', 'gwei');
	});

	afterEach(resetConfigAndSynthFiles);

	describe('integrated actions test', () => {
		describe('when deployed', () => {
			let sources;
			let targets;
			let synths;
			let Shadows;
			let timestamp;
			let xUSDContract;
			let xBTCContract;
			let xETHContract;
			let FeePool;
			beforeEach(async function() {
				this.timeout(90000);

				await commands.deploy({
					network,
					deploymentPath,
					yes: true,
					privateKey: accounts.deployer.private,
				});

				sources = dows.getSource({ network });
				targets = dows.getTarget({ network });
				synths = dows.getSynths({ network }).filter(({ name }) => name !== 'xUSD' && name !== 'XDR');

				Shadows = new web3.eth.Contract(
					sources['Shadows'].abi,
					targets['ProxyShadows'].address
				);
				FeePool = new web3.eth.Contract(sources['FeePool'].abi, targets['ProxyFeePool'].address);
				xUSDContract = new web3.eth.Contract(sources['Synth'].abi, targets['ProxyxUSD'].address);
				xBTCContract = new web3.eth.Contract(sources['Synth'].abi, targets['ProxyxBTC'].address);
				xETHContract = new web3.eth.Contract(sources['Synth'].abi, targets['ProxyxETH'].address);
				timestamp = (await web3.eth.getBlock('latest')).timestamp;
			});

			describe('importFeePeriods script', () => {
				let oldFeePoolAddress;
				let feePeriodLength;

				beforeEach(async () => {
					oldFeePoolAddress = dows.getTarget({ network, contract: 'FeePool' }).address;
					feePeriodLength = await FeePool.methods.FEE_PERIOD_LENGTH().call();
				});

				const daysAgo = days => Math.round(Date.now() / 1000 - 3600 * 24 * days);

				const redeployFeePeriodOnly = async function() {
					// read current config file version (if something has been removed,
					// we don't want to include it here)
					const currentConfigFile = JSON.parse(fs.readFileSync(configJSONPath));
					const configForExrates = Object.keys(currentConfigFile).reduce((memo, cur) => {
						memo[cur] = { deploy: cur === 'FeePool' };
						return memo;
					}, {});

					fs.writeFileSync(configJSONPath, JSON.stringify(configForExrates));

					this.timeout(60000);

					await commands.deploy({
						network,
						deploymentPath,
						yes: true,
						privateKey: accounts.deployer.private,
					});
				};

				describe('when import script is called with the same source fee pool as the currently deployed one', () => {
					it('then it fails', done => {
						commands
							.importFeePeriods({
								sourceContractAddress: oldFeePoolAddress,
								deploymentPath,
								network,
								privateKey: accounts.deployer.private,
								yes: true,
							})
							.then(() => done('Should not succeed.'))
							.catch(() => done());
					});
				});
				describe('when FeePool alone is redeployed', () => {
					beforeEach(redeployFeePeriodOnly);

					describe('when new fee periods are attempted to be imported', () => {
						it('fails as there isnt more than a single period', done => {
							commands
								.importFeePeriods({
									sourceContractAddress: oldFeePoolAddress,
									deploymentPath,
									network,
									privateKey: accounts.deployer.private,
									yes: true,
								})
								.then(() => done('Should not succeed.'))
								.catch(() => done());
						});
					});
				});

				describe('when FeePool is given three true imported periods', () => {
					let periodsAdded;
					beforeEach(async () => {
						periodsAdded = [];
						const addPeriod = (feePeriodId, startTime) => {
							periodsAdded.push({
								feePeriodId,
								startingDebtIndex: '0',
								startTime,
								feesToDistribute: '0',
								feesClaimed: '0',
								rewardsToDistribute: '0',
								rewardsClaimed: '0',
							});
						};
						for (let i = 0; i < feePeriodLength; i++) {
							const startTime = daysAgo((i + 1) * 6);
							addPeriod((i + 1).toString(), startTime.toString());
							await FeePool.methods.importFeePeriod(i, i + 1, 0, startTime, 0, 0, 0, 0).send({
								from: accounts.deployer.public,
								gas: gasLimit,
								gasPrice,
							});
						}
					});
					describe('when the new FeePool is invalid', () => {
						describe('when FeePool alone is redeployed', () => {
							beforeEach(redeployFeePeriodOnly);
							describe('using the FeePoolNew', () => {
								let FeePoolNew;
								beforeEach(async () => {
									FeePoolNew = new web3.eth.Contract(
										sources['FeePool'].abi,
										dows.getTarget({ network, contract: 'FeePool' }).address
									);
								});

								describe('when the new FeePool is manually given fee periods', () => {
									beforeEach(async () => {
										for (let i = 0; i < feePeriodLength; i++) {
											await FeePoolNew.methods
												.importFeePeriod(i, i + 1, 0, daysAgo((i + 1) * 6), 0, 0, 0, 0)
												.send({
													from: accounts.deployer.public,
													gas: gasLimit,
													gasPrice,
												});
										}
									});
									describe('when new fee periods are attempted to be imported', () => {
										it('fails as the target FeePool now has imported fee periods', done => {
											commands
												.importFeePeriods({
													sourceContractAddress: oldFeePoolAddress,
													deploymentPath,
													network,
													privateKey: accounts.deployer.private,
													yes: true,
												})
												.then(() => done('Should not succeed.'))
												.catch(() => done());
										});
									});
								});
							});
						});
					});
					describe('when FeePool alone is redeployed', () => {
						beforeEach(redeployFeePeriodOnly);
						describe('using the FeePoolNew', () => {
							let FeePoolNew;
							beforeEach(async () => {
								FeePoolNew = new web3.eth.Contract(
									sources['FeePool'].abi,
									dows.getTarget({ network, contract: 'FeePool' }).address
								);
							});

							describe('when import is called', () => {
								beforeEach(async () => {
									await commands.importFeePeriods({
										sourceContractAddress: oldFeePoolAddress,
										deploymentPath,
										network,
										privateKey: accounts.deployer.private,
										yes: true,
									});
								});
								it('then the periods are added correctly', async () => {
									const periods = await Promise.all(
										[0, 1, 2].map(i => FeePoolNew.methods.recentFeePeriods(i).call())
									);
									// strip index props off the returned object
									periods.forEach(period =>
										Object.keys(period)
											.filter(key => /^[0-9]+$/.test(key))
											.forEach(key => delete period[key])
									);

									assert.strictEqual(JSON.stringify(periods[0]), JSON.stringify(periodsAdded[0]));
									assert.strictEqual(JSON.stringify(periods[1]), JSON.stringify(periodsAdded[1]));
									assert.strictEqual(JSON.stringify(periods[2]), JSON.stringify(periodsAdded[2]));
								});
							});
						});
					});
					describe('when FeePool is given old import periods', () => {
						beforeEach(async () => {
							for (let i = 0; i < feePeriodLength; i++) {
								await FeePool.methods
									.importFeePeriod(i, i + 1, 0, daysAgo((i + 1) * 14), 0, 0, 0, 0)
									.send({
										from: accounts.deployer.public,
										gas: gasLimit,
										gasPrice,
									});
							}
						});
						describe('when FeePool alone is redeployed', () => {
							beforeEach(redeployFeePeriodOnly);

							describe('when new fee periods are attempted to be imported', () => {
								it('fails as the most recent period is older than 1week', done => {
									commands
										.importFeePeriods({
											sourceContractAddress: oldFeePoolAddress,
											deploymentPath,
											network,
											privateKey: accounts.deployer.private,
											yes: true,
										})
										.then(() => done('Should not succeed.'))
										.catch(() => done());
								});
							});
						});
					});
				});
			});

			describe('when ExchangeRates has prices DOWS $0.30 and all synths $1', () => {
				beforeEach(async () => {
					// make sure exchange rates has a price
					const ExchangeRates = new web3.eth.Contract(
						sources['ExchangeRates'].abi,
						targets['ExchangeRates'].address
					);
					// update rates
					await ExchangeRates.methods
						.updateRates(
							[DOWS].concat(synths.map(({ name }) => toBytes32(name))),
							[web3.utils.toWei('0.3')].concat(
								synths.map(({ name, inverted }) => {
									if (name === 'iETH') {
										// ensure iETH is frozen at the lower limit, by setting the incoming rate for xTRX
										// above the upper limit
										return web3.utils.toWei(Math.round(inverted.upperLimit * 2).toString());
									} else if (name === 'iBTC') {
										// ensure iBTC is frozen at the upper limit, by setting the incoming rate for xTRX
										// below the lower limit
										return web3.utils.toWei(Math.round(inverted.lowerLimit * 0.75).toString());
									} else if (name === 'iBNB') {
										// ensure iBNB is not frozen
										return web3.utils.toWei(inverted.entryPoint.toString());
									} else if (name === 'iMKR') {
										// ensure iMKR is frozen
										return web3.utils.toWei(Math.round(inverted.upperLimit * 2).toString());
									} else if (name === 'iCEX') {
										// ensure iCEX is frozen at lower limit
										return web3.utils.toWei(Math.round(inverted.upperLimit * 2).toString());
									} else {
										return web3.utils.toWei('1');
									}
								})
							),
							timestamp
						)
						.send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});
				});

				describe('when transferring 100k DOWS to user1', () => {
					beforeEach(async () => {
						// transfer DOWS to first account
						await Shadows.methods
							.transfer(accounts.first.public, web3.utils.toWei('100000'))
							.send({
								from: accounts.deployer.public,
								gas: gasLimit,
								gasPrice,
							});
					});

					describe('when user1 issues all possible xUSD', () => {
						beforeEach(async () => {
							await Shadows.methods.issueMaxSynths().send({
								from: accounts.first.public,
								gas: gasLimit,
								gasPrice,
							});
						});
						it('then the xUSD balanced must be 100k * 0.3 * 0.2 (default ShadowsState.issuanceRatio) = 6000', async () => {
							const balance = await xUSDContract.methods.balanceOf(accounts.first.public).call();
							assert.strictEqual(web3.utils.fromWei(balance), '6000', 'Balance should match');
						});
						describe('when user1 exchange 1000 xUSD for xETH (the MultiCollateralSynth)', () => {
							let xETHBalanceAfterExchange;
							beforeEach(async () => {
								await Shadows.methods.exchange(xUSD, web3.utils.toWei('1000'), xETH).send({
									from: accounts.first.public,
									gas: gasLimit,
									gasPrice,
								});
								xETHBalanceAfterExchange = await xETHContract.methods
									.balanceOf(accounts.first.public)
									.call();
							});
							it('then their xUSD balance is 5000', async () => {
								const balance = await xUSDContract.methods.balanceOf(accounts.first.public).call();
								assert.strictEqual(web3.utils.fromWei(balance), '5000', 'Balance should match');
							});
							it('and their xETH balance is 1000 - the fee', async () => {
								const expected = await FeePool.methods
									.amountReceivedFromExchange(web3.utils.toWei('1000'))
									.call();
								assert.strictEqual(
									web3.utils.fromWei(xETHBalanceAfterExchange),
									web3.utils.fromWei(expected),
									'Balance should match'
								);
							});
						});
						describe('when user1 exchange 1000 xUSD for xBTC', () => {
							let xBTCBalanceAfterExchange;
							beforeEach(async () => {
								await Shadows.methods.exchange(xUSD, web3.utils.toWei('1000'), xBTC).send({
									from: accounts.first.public,
									gas: gasLimit,
									gasPrice,
								});
								xBTCBalanceAfterExchange = await xBTCContract.methods
									.balanceOf(accounts.first.public)
									.call();
							});
							it('then their xUSD balance is 5000', async () => {
								const balance = await xUSDContract.methods.balanceOf(accounts.first.public).call();
								assert.strictEqual(web3.utils.fromWei(balance), '5000', 'Balance should match');
							});
							it('and their xBTC balance is 1000 - the fee', async () => {
								const expected = await FeePool.methods
									.amountReceivedFromExchange(web3.utils.toWei('1000'))
									.call();
								assert.strictEqual(
									web3.utils.fromWei(xBTCBalanceAfterExchange),
									web3.utils.fromWei(expected),
									'Balance should match'
								);
							});
							describe('when user1 burns 10 xUSD', () => {
								beforeEach(async () => {
									// burn
									await Shadows.methods.burnSynths(web3.utils.toWei('10')).send({
										from: accounts.first.public,
										gas: gasLimit,
										gasPrice,
									});
								});
								it('then their xUSD balance is 4990', async () => {
									const balance = await xUSDContract.methods
										.balanceOf(accounts.first.public)
										.call();
									assert.strictEqual(web3.utils.fromWei(balance), '4990', 'Balance should match');
								});

								describe('when deployer replaces xBTC with PurgeableSynth', () => {
									beforeEach(async () => {
										await commands.replaceSynths({
											network,
											deploymentPath,
											yes: true,
											privateKey: accounts.deployer.private,
											subclass: 'PurgeableSynth',
											synthsToReplace: ['xBTC'],
										});
									});
									describe('and deployer invokes purge', () => {
										beforeEach(async () => {
											fastForward(500); // fast forward through waiting period

											await commands.purgeSynths({
												network,
												deploymentPath,
												yes: true,
												privateKey: accounts.deployer.private,
												addresses: [accounts.first.public],
												synthsToPurge: ['xBTC'],
											});
										});
										it('then their xUSD balance is 4990 + xBTCBalanceAfterExchange', async () => {
											const balance = await xUSDContract.methods
												.balanceOf(accounts.first.public)
												.call();
											const xUSDGainedFromPurge = await FeePool.methods
												.amountReceivedFromExchange(xBTCBalanceAfterExchange)
												.call();
											assert.strictEqual(
												web3.utils.fromWei(balance),
												(4990 + +web3.utils.fromWei(xUSDGainedFromPurge)).toString(),
												'Balance should match'
											);
										});
										it('and their xBTC balance is 0', async () => {
											const balance = await xBTCContract.methods
												.balanceOf(accounts.first.public)
												.call();
											assert.strictEqual(web3.utils.fromWei(balance), '0', 'Balance should match');
										});
									});
								});
							});
						});
					});

					describe('handle updates to inverted rates', () => {
						describe('when a new inverted synth iABC is added to the list', () => {
							describe('and the inverted synth iMKR has its parameters shifted', () => {
								describe('and the inverted synth iCEX has its parameters shifted as well', () => {
									beforeEach(async () => {
										// read current config file version (if something has been removed,
										// we don't want to include it here)
										const currentSynthsFile = JSON.parse(fs.readFileSync(synthsJSONPath));

										// add new iABC synth
										currentSynthsFile.push({
											name: 'iABC',
											asset: 'ABC',
											category: 'crypto',
											sign: '',
											desc: 'Inverted Alphabet',
											subclass: 'PurgeableSynth',
											inverted: {
												entryPoint: 1,
												upperLimit: 1.5,
												lowerLimit: 0.5,
											},
										});

										// mutate parameters of iMKR
										// Note: this is brittle and will *break* if iMKR or iCEX are removed from the
										// synths for deployment. This needs to be improved in the near future - JJ
										currentSynthsFile.find(({ name }) => name === 'iMKR').inverted = {
											entryPoint: 100,
											upperLimit: 150,
											lowerLimit: 50,
										};

										// mutate parameters of iCEX
										currentSynthsFile.find(({ name }) => name === 'iCEX').inverted = {
											entryPoint: 1,
											upperLimit: 1.5,
											lowerLimit: 0.5,
										};

										fs.writeFileSync(synthsJSONPath, JSON.stringify(currentSynthsFile));
									});

									describe('when a user has issued and exchanged into iCEX', () => {
										beforeEach(async () => {
											await Shadows.methods.issueMaxSynths().send({
												from: accounts.first.public,
												gas: gasLimit,
												gasPrice,
											});

											await Shadows.methods
												.exchange(toBytes32('xUSD'), web3.utils.toWei('100'), toBytes32('iCEX'))
												.send({
													from: accounts.first.public,
													gas: gasLimit,
													gasPrice,
												});
										});

										describe('when ExchangeRates alone is redeployed', () => {
											let ExchangeRates;
											let currentConfigFile;
											beforeEach(async function() {
												// read current config file version (if something has been removed,
												// we don't want to include it here)
												currentConfigFile = JSON.parse(fs.readFileSync(configJSONPath));
												const configForExrates = Object.keys(currentConfigFile).reduce(
													(memo, cur) => {
														memo[cur] = { deploy: cur === 'ExchangeRates' };
														return memo;
													},
													{}
												);

												fs.writeFileSync(configJSONPath, JSON.stringify(configForExrates));

												this.timeout(60000);

												await commands.deploy({
													addNewSynths: true,
													network,
													deploymentPath,
													yes: true,
													privateKey: accounts.deployer.private,
												});

												ExchangeRates = new web3.eth.Contract(
													sources['ExchangeRates'].abi,
													dows.getTarget({ network, contract: 'ExchangeRates' }).address
												);
											});

											// Test the properties of an inverted synth
											const testInvertedSynth = async ({
												currencyKey,
												shouldBeFrozen,
												expectedPropNameOfFrozenLimit,
											}) => {
												const {
													entryPoint,
													upperLimit,
													lowerLimit,
													frozen,
												} = await ExchangeRates.methods
													.inversePricing(toBytes32(currencyKey))
													.call();
												const rate = await ExchangeRates.methods
													.rateForCurrency(toBytes32(currencyKey))
													.call();
												const expected = synths.find(({ name }) => name === currencyKey).inverted;
												assert.strictEqual(
													+web3.utils.fromWei(entryPoint),
													expected.entryPoint,
													'Entry points match'
												);
												assert.strictEqual(
													+web3.utils.fromWei(upperLimit),
													expected.upperLimit,
													'Upper limits match'
												);
												assert.strictEqual(
													+web3.utils.fromWei(lowerLimit),
													expected.lowerLimit,
													'Lower limits match'
												);
												assert.strictEqual(frozen, shouldBeFrozen, 'Frozen matches expectation');

												if (expectedPropNameOfFrozenLimit) {
													assert.strictEqual(
														+web3.utils.fromWei(rate),
														expected[expectedPropNameOfFrozenLimit],
														'Frozen correctly at limit'
													);
												}
											};

											it('then the new iABC synth should be added correctly (as it has no previous rate)', async () => {
												const iABC = toBytes32('iABC');
												const {
													entryPoint,
													upperLimit,
													lowerLimit,
													frozen,
												} = await ExchangeRates.methods.inversePricing(iABC).call();
												const rate = await ExchangeRates.methods.rateForCurrency(iABC).call();

												assert.strictEqual(+web3.utils.fromWei(entryPoint), 1, 'Entry point match');
												assert.strictEqual(
													+web3.utils.fromWei(upperLimit),
													1.5,
													'Upper limit match'
												);
												assert.strictEqual(
													+web3.utils.fromWei(lowerLimit),
													0.5,
													'Lower limit match'
												);
												assert.strictEqual(frozen, false, 'Is not frozen');
												assert.strictEqual(
													+web3.utils.fromWei(rate),
													0,
													'No rate for new inverted synth'
												);
											});

											it('and the iMKR synth should be reconfigured correctly (as it has 0 total supply)', async () => {
												const iMKR = toBytes32('iMKR');
												const {
													entryPoint,
													upperLimit,
													lowerLimit,
													frozen,
												} = await ExchangeRates.methods.inversePricing(iMKR).call();
												const rate = await ExchangeRates.methods.rateForCurrency(iMKR).call();

												assert.strictEqual(
													+web3.utils.fromWei(entryPoint),
													100,
													'Entry point match'
												);
												assert.strictEqual(
													+web3.utils.fromWei(upperLimit),
													150,
													'Upper limit match'
												);
												assert.strictEqual(
													+web3.utils.fromWei(lowerLimit),
													50,
													'Lower limit match'
												);
												assert.strictEqual(frozen, false, 'Is not frozen');
												assert.strictEqual(+web3.utils.fromWei(rate), 0, 'No rate for iMKR');
											});

											it('and the iCEX synth should not be inverted at all', async () => {
												const { entryPoint } = await ExchangeRates.methods
													.inversePricing(toBytes32('iCEX'))
													.call();

												assert.strictEqual(
													+web3.utils.fromWei(entryPoint),
													0,
													'iCEX should not be set'
												);
											});

											it('and iETH should be set as frozen at the lower limit', async () => {
												await testInvertedSynth({
													currencyKey: 'iETH',
													shouldBeFrozen: true,
													expectedPropNameOfFrozenLimit: 'lowerLimit',
												});
											});
											it('and iBTC should be set as frozen at the upper limit', async () => {
												await testInvertedSynth({
													currencyKey: 'iBTC',
													shouldBeFrozen: true,
													expectedPropNameOfFrozenLimit: 'upperLimit',
												});
											});
											it('and iBNB should not be frozen', async () => {
												console.log('HEY----------------------------xxx');
												await testInvertedSynth({
													currencyKey: 'iBNB',
													shouldBeFrozen: false,
												});
											});

											// Note: this is destructive as it removes the xBTC contracts and thus future calls to deploy will fail
											// Either have this at the end of the entire test script or manage configuration of deploys by passing in
											// files to update rather than a file.
											describe('when deployer invokes remove of iABC', () => {
												beforeEach(async () => {
													await commands.removeSynths({
														network,
														deploymentPath,
														yes: true,
														privateKey: accounts.deployer.private,
														synthsToRemove: ['iABC'],
													});
												});

												describe('when user tries to exchange into iABC', () => {
													it('then it fails', done => {
														Shadows.methods
															.exchange(
																toBytes32('iCEX'),
																web3.utils.toWei('1000'),
																toBytes32('iABC')
															)
															.send({
																from: accounts.first.public,
																gas: gasLimit,
																gasPrice,
															})
															.then(() => done('Should not have complete'))
															.catch(() => done());
													});
												});
											});
										});
									});
								});
							});
						});
					});
				});
			});

			describe('when a pricing aggregator exists', () => {
				let mockAggregator;
				beforeEach(async () => {
					const {
						abi,
						evm: {
							bytecode: { object: bytecode },
						},
					} = compiledSources['MockAggregator'];

					const MockAggregator = new web3.eth.Contract(abi);
					mockAggregator = await MockAggregator.deploy({
						data: '0x' + bytecode,
					}).send({
						from: accounts.deployer.public,
						gas: gasLimit,
						gasPrice,
					});
				});
				describe('when Shadows.totalIssuedSynths is invoked', () => {
					it('then it reverts as expected as there are no rates', async () => {
						try {
							await Shadows.methods.totalIssuedSynths(xUSD).call();
							assert.fail('Did not revert while trying to get totalIssuedSynths');
						} catch (err) {
							assert.strictEqual(true, /Rates are stale/.test(err.toString()));
						}
					});
				});
				describe('when one synth is configured to have a pricing aggregator', () => {
					beforeEach(async () => {
						const currentSynthsFile = JSON.parse(fs.readFileSync(synthsJSONPath));

						// mutate parameters of xEUR - instructing it to use the aggregator
						currentSynthsFile.find(({ name }) => name === 'xEUR').aggregator =
							mockAggregator.options.address;

						fs.writeFileSync(synthsJSONPath, JSON.stringify(currentSynthsFile));
					});
					describe('when a deployment with nothing set to deploy fresh is run', () => {
						let ExchangeRates;
						beforeEach(async () => {
							const currentConfigFile = JSON.parse(fs.readFileSync(configJSONPath));
							const configForExrates = Object.keys(currentConfigFile).reduce((memo, cur) => {
								memo[cur] = { deploy: false };
								return memo;
							}, {});

							fs.writeFileSync(configJSONPath, JSON.stringify(configForExrates));

							this.timeout(60000);

							await commands.deploy({
								network,
								deploymentPath,
								yes: true,
								privateKey: accounts.deployer.private,
							});

							ExchangeRates = new web3.eth.Contract(
								sources['ExchangeRates'].abi,
								dows.getTarget({ network, contract: 'ExchangeRates' }).address
							);
						});
						it('then the aggregator must be set for the xEUR price', async () => {
							const xEURAggregator = await ExchangeRates.methods
								.aggregators(toBytes32('xEUR'))
								.call();
							assert.strictEqual(xEURAggregator, mockAggregator.options.address);
						});

						describe('when ExchangeRates has rates for all synths except the aggregated synth xEUR', () => {
							beforeEach(async () => {
								const ExchangeRates = new web3.eth.Contract(
									sources['ExchangeRates'].abi,
									targets['ExchangeRates'].address
								);
								// update rates
								const synthsToUpdate = synths.filter(({ name }) => name !== 'xEUR');

								await ExchangeRates.methods
									.updateRates(
										synthsToUpdate.map(({ name }) => toBytes32(name)),
										synthsToUpdate.map(() => web3.utils.toWei('1')),
										timestamp
									)
									.send({
										from: accounts.deployer.public,
										gas: gasLimit,
										gasPrice,
									});
							});
							describe('when Shadows.totalIssuedSynths is invoked', () => {
								it('then it reverts as expected as there is no rate for xEUR', async () => {
									try {
										await Shadows.methods.totalIssuedSynths(xUSD).call();
										assert.fail('Did not revert while trying to get totalIssuedSynths');
									} catch (err) {
										assert.strictEqual(true, /Rates are stale/.test(err.toString()));
									}
								});
							});

							describe('when the aggregator has a price', () => {
								const rate = '1.15';
								let newTs;
								beforeEach(async () => {
									newTs = timestamp + 300;
									await mockAggregator.methods
										.setLatestAnswer((rate * 1e8).toFixed(0), newTs)
										.send({
											from: accounts.deployer.public,
											gas: gasLimit,
											gasPrice,
										});
								});
								describe('then the price from exchange rates for that currency key uses the aggregator', () => {
									it('correctly', async () => {
										const response = await ExchangeRates.methods
											.rateForCurrency(toBytes32('xEUR'))
											.call();
										assert.strictEqual(web3.utils.fromWei(response), rate);
									});
								});

								describe('when Shadows.totalIssuedSynths is invoked', () => {
									it('then it returns some number successfully as no rates are stale', async () => {
										const response = await Shadows.methods.totalIssuedSynths(xUSD).call();
										assert.strictEqual(Number(response) >= 0, true);
									});
								});
							});
						});
					});
				});
			});
		});
	});
});
