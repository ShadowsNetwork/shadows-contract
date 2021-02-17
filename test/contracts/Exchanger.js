require('.'); // import common test scaffolding

const ExchangeRates = artifacts.require('ExchangeRates');
const FeePool = artifacts.require('FeePool');
const Shadows = artifacts.require('Shadows');
const Synth = artifacts.require('Synth');
const Exchanger = artifacts.require('Exchanger');
const ExchangeState = artifacts.require('ExchangeState');

const {
	currentTime,
	fastForward,
	multiplyDecimal,
	divideDecimal,
	toUnit,
	ZERO_ADDRESS,
} = require('../utils/testUtils');

const {
	issueSynthsToUser,
	setExchangeFee,
	getDecodedLogs,
	decodedEventEqual,
	timeIsClose,
	onlyGivenAddressCanInvoke,
	ensureOnlyExpectedMutativeFunctions,
} = require('../utils/setupUtils');

const { toBytes32 } = require('../..');

const bnCloseVariance = '30';

contract('Exchanger (via Shadows)', async accounts => {
	const [xUSD, xAUD, xEUR, DOWS, xBTC, iBTC, xETH] = [
		'xUSD',
		'xAUD',
		'xEUR',
		'DOWS',
		'xBTC',
		'iBTC',
		'xETH',
	].map(toBytes32);

	const [, owner, account1, account2, account3] = accounts;

	let shadows,
		exchangeRates,
		feePool,
		xUSDContract,
		xAUDContract,
		xEURContract,
		xBTCContract,
		oracle,
		timestamp,
		exchanger,
		exchangeState,
		exchangeFeeRate;

	beforeEach(async () => {
		// Save ourselves from having to await deployed() in every single test.
		// We do this in a beforeEach instead of before to ensure we isolate
		// contract interfaces to prevent test bleed.
		exchangeRates = await ExchangeRates.deployed();
		feePool = await FeePool.deployed();

		shadows = await Shadows.deployed();
		xUSDContract = await Synth.at(await shadows.synths(xUSD));
		xAUDContract = await Synth.at(await shadows.synths(xAUD));
		xEURContract = await Synth.at(await shadows.synths(xEUR));
		xBTCContract = await Synth.at(await shadows.synths(xBTC));

		exchanger = await Exchanger.deployed();
		exchangeState = await ExchangeState.deployed();

		// Send a price update to guarantee we're not stale.
		oracle = await exchangeRates.oracle();
		timestamp = await currentTime();

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS, xETH, xBTC, iBTC],
			['0.5', '2', '1', '100', '5000', '5000'].map(toUnit),
			timestamp,
			{
				from: oracle,
			}
		);

		// set a 0.5% exchange fee rate (1/200)
		exchangeFeeRate = toUnit('0.005');
		await setExchangeFee({ owner, exchangeFeeRate });

		// give the first two accounts 1000 xUSD each
		await issueSynthsToUser({ owner, user: account1, amount: toUnit('1000'), synth: xUSD });
		await issueSynthsToUser({ owner, user: account2, amount: toUnit('1000'), synth: xUSD });
	});

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: exchanger.abi,
			ignoreParents: ['MixinResolver'],
			expected: ['settle', 'setExchangeEnabled', 'setWaitingPeriodSecs', 'exchange'],
		});
	});

	describe('setExchangeEnabled()', () => {
		it('should disallow non owners to call exchangeEnabled', async () => {
			await onlyGivenAddressCanInvoke({
				accounts,
				fnc: exchanger.setExchangeEnabled,
				args: [false],
				address: owner,
			});
		});

		it('should only allow Owner to call exchangeEnabled', async () => {
			// Set false
			await exchanger.setExchangeEnabled(false, { from: owner });
			const exchangeEnabled = await exchanger.exchangeEnabled();
			assert.equal(exchangeEnabled, false);

			// Set true
			await exchanger.setExchangeEnabled(true, { from: owner });
			const exchangeEnabledTrue = await exchanger.exchangeEnabled();
			assert.equal(exchangeEnabledTrue, true);
		});

		it('should not exchange when exchangeEnabled is false', async () => {
			const amountToExchange = toUnit('100');

			// Disable exchange
			await exchanger.setExchangeEnabled(false, { from: owner });

			// Exchange xUSD to xAUD
			await assert.revert(shadows.exchange(xUSD, amountToExchange, xAUD, { from: account1 }));

			// Enable exchange
			await exchanger.setExchangeEnabled(true, { from: owner });

			// Exchange xUSD to xAUD
			const txn = await shadows.exchange(xUSD, amountToExchange, xAUD, { from: account1 });

			const xAUDBalance = await xAUDContract.balanceOf(account1);

			const synthExchangeEvent = txn.logs.find(log => log.event === 'SynthExchange');
			assert.eventEqual(synthExchangeEvent, 'SynthExchange', {
				account: account1,
				fromCurrencyKey: toBytes32('xUSD'),
				fromAmount: amountToExchange,
				toCurrencyKey: toBytes32('xAUD'),
				toAmount: xAUDBalance,
				toAddress: account1,
			});
		});
	});

	describe('setWaitingPeriodSecs()', () => {
		it('only owner can invoke', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: exchanger.setWaitingPeriodSecs,
				args: ['60'],
				accounts,
				address: owner,
			});
		});
		it('owner can invoke and replace', async () => {
			const newPeriod = '90';
			await exchanger.setWaitingPeriodSecs(newPeriod, { from: owner });
			const actual = await exchanger.waitingPeriodSecs();
			assert.equal(actual, newPeriod, 'Configured waiting period is set correctly');
		});
		describe('given it is configured to 90', () => {
			beforeEach(async () => {
				await exchanger.setWaitingPeriodSecs('90', { from: owner });
			});
			describe('and there is an exchange', () => {
				beforeEach(async () => {
					await shadows.exchange(xUSD, toUnit('100'), xEUR, { from: account1 });
				});
				it('then the maxSecsLeftInWaitingPeriod is close to 90', async () => {
					const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, xEUR);
					timeIsClose({ actual: maxSecs, expected: 90 });
				});
				describe('and 88 seconds elapses', () => {
					// Note: timestamp accurancy can't be guaranteed, so provide a few seconds of buffer either way
					beforeEach(async () => {
						fastForward(88);
					});
					describe('when settle() is called', () => {
						it('then it reverts', async () => {
							await assert.revert(shadows.settle(xEUR, { from: account1 }));
						});
						it('and the maxSecsLeftInWaitingPeriod is close to 1', async () => {
							const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, xEUR);
							timeIsClose({ actual: maxSecs, expected: 1 });
						});
					});
					describe('when a further 4 seconds elapse', () => {
						beforeEach(async () => {
							fastForward(4);
						});
						describe('when settle() is called', () => {
							it('it successed', async () => {
								await shadows.settle(xEUR, { from: account1 });
							});
						});
					});
				});
			});
		});
	});

	describe('maxSecsLeftInWaitingPeriod()', () => {
		describe('when the waiting period is configured to 60', () => {
			let waitingPeriodSecs;
			beforeEach(async () => {
				waitingPeriodSecs = '60';
				await exchanger.setWaitingPeriodSecs(waitingPeriodSecs, { from: owner });
			});
			describe('when there are no exchanges', () => {
				it('then it returns 0', async () => {
					const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, xEUR);
					assert.equal(maxSecs, '0', 'No seconds remaining for exchange');
				});
			});
			describe('when a user with xUSD has performed an exchange into xEUR', () => {
				beforeEach(async () => {
					await shadows.exchange(xUSD, toUnit('100'), xEUR, { from: account1 });
				});
				it('then fetching maxSecs for that user into xEUR returns 60', async () => {
					const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, xEUR);
					timeIsClose({ actual: maxSecs, expected: 60 });
				});
				it('and fetching maxSecs for that user into the source synth returns 0', async () => {
					const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, xUSD);
					assert.equal(maxSecs, '0', 'No waiting period for src synth');
				});
				it('and fetching maxSecs for that user into other synths returns 0', async () => {
					let maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, xBTC);
					assert.equal(maxSecs, '0', 'No waiting period for other synth xBTC');
					maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, iBTC);
					assert.equal(maxSecs, '0', 'No waiting period for other synth iBTC');
				});
				it('and fetching maxSec for other users into that synth are unaffected', async () => {
					let maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account2, xEUR);
					assert.equal(
						maxSecs,
						'0',
						'Other user: account2 has no waiting period on dest synth of account 1'
					);
					maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account2, xUSD);
					assert.equal(
						maxSecs,
						'0',
						'Other user: account2 has no waiting period on src synth of account 1'
					);
					maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account3, xEUR);
					assert.equal(
						maxSecs,
						'0',
						'Other user: account3 has no waiting period on dest synth of acccount 1'
					);
				});

				describe('when 55 seconds has elapsed', () => {
					beforeEach(async () => {
						await fastForward(55);
					});
					it('then it returns 5', async () => {
						const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, xEUR);
						timeIsClose({ actual: maxSecs, expected: 5 });
					});
					describe('when another user does the same exchange', () => {
						beforeEach(async () => {
							await shadows.exchange(xUSD, toUnit('100'), xEUR, { from: account2 });
						});
						it('then it still returns 5 for the original user', async () => {
							const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, xEUR);
							timeIsClose({ actual: maxSecs, expected: 5 });
						});
						it('and yet the new user has 60 secs', async () => {
							const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account2, xEUR);
							timeIsClose({ actual: maxSecs, expected: 60 });
						});
					});
					describe('when another 5 seconds elapses', () => {
						beforeEach(async () => {
							await fastForward(5);
						});
						it('then it returns 0', async () => {
							const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, xEUR);
							assert.equal(maxSecs, '0', 'No time left in waiting period');
						});
						describe('when another 10 seconds elapses', () => {
							beforeEach(async () => {
								await fastForward(10);
							});
							it('then it still returns 0', async () => {
								const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, xEUR);
								assert.equal(maxSecs, '0', 'No time left in waiting period');
							});
						});
					});
					describe('when the same user exchanges into the new synth', () => {
						beforeEach(async () => {
							await shadows.exchange(xUSD, toUnit('100'), xEUR, { from: account1 });
						});
						it('then the secs remaining returns 60 again', async () => {
							const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, xEUR);
							timeIsClose({ actual: maxSecs, expected: 60 });
						});
					});
				});
			});
		});
	});

	describe('feeRateForExchange()', () => {
		let exchangeFeeRate;
		let doubleExchangeFeeRate;
		beforeEach(async () => {
			exchangeFeeRate = await feePool.exchangeFeeRate();
			doubleExchangeFeeRate = exchangeFeeRate.mul(web3.utils.toBN(2));
		});
		it('for two long synths, returns the regular exchange fee', async () => {
			const actualFeeRate = await exchanger.feeRateForExchange(xEUR, xBTC);
			assert.bnEqual(actualFeeRate, exchangeFeeRate, 'Rate must be the exchange fee rate');
		});
		it('for two inverse synths, returns the regular exchange fee', async () => {
			const actualFeeRate = await exchanger.feeRateForExchange(iBTC, toBytes32('iETH'));
			assert.bnEqual(actualFeeRate, exchangeFeeRate, 'Rate must be the exchange fee rate');
		});
		it('for an inverse synth and xUSD, returns the regular exchange fee', async () => {
			let actualFeeRate = await exchanger.feeRateForExchange(iBTC, xUSD);
			assert.bnEqual(actualFeeRate, exchangeFeeRate, 'Rate must be the exchange fee rate');
			actualFeeRate = await exchanger.feeRateForExchange(xUSD, iBTC);
			assert.bnEqual(actualFeeRate, exchangeFeeRate, 'Rate must be the exchange fee rate');
		});
		it('for an inverse synth and a long synth, returns double regular exchange fee', async () => {
			let actualFeeRate = await exchanger.feeRateForExchange(iBTC, xEUR);
			assert.bnEqual(
				actualFeeRate,
				doubleExchangeFeeRate,
				'Rate must be double the exchange fee rate'
			);
			actualFeeRate = await exchanger.feeRateForExchange(xEUR, iBTC);
			assert.bnEqual(
				actualFeeRate,
				doubleExchangeFeeRate,
				'Rate must be double the exchange fee rate'
			);
			actualFeeRate = await exchanger.feeRateForExchange(xBTC, iBTC);
			assert.bnEqual(
				actualFeeRate,
				doubleExchangeFeeRate,
				'Rate must be double the exchange fee rate'
			);
			actualFeeRate = await exchanger.feeRateForExchange(iBTC, xBTC);
			assert.bnEqual(
				actualFeeRate,
				doubleExchangeFeeRate,
				'Rate must be double the exchange fee rate'
			);
		});
	});

	const amountAfterExchageFee = ({ amount }) => {
		return multiplyDecimal(amount, toUnit('1').sub(exchangeFeeRate));
	};

	const calculateExpectedSettlementAmount = ({ amount, oldRate, newRate }) => {
		// Note: exchangeFeeRate is in a parent scope. Tests may mutate it in beforeEach and
		// be assured that this function, when called in a test, will use that mutated value
		const result = multiplyDecimal(amountAfterExchageFee({ amount }), oldRate.sub(newRate));

		return {
			reclaimAmount: result.isNeg() ? new web3.utils.BN(0) : result,
			rebateAmount: result.isNeg() ? result.abs() : new web3.utils.BN(0),
		};
	};

	/**
	 * Ensure a settle() transaction emits the expected events
	 */
	const ensureTxnEmitsSettlementEvents = async ({ hash, synth, expected }) => {
		// Get receipt to collect all transaction events
		const logs = await getDecodedLogs({ hash });

		const currencyKey = await synth.currencyKey();
		// Can only either be reclaim or rebate - not both
		const isReclaim = !expected.reclaimAmount.isZero();
		const expectedAmount = isReclaim ? expected.reclaimAmount : expected.rebateAmount;

		const synthProxyAddress = await synth.proxy();

		decodedEventEqual({
			log: logs[0],
			event: 'Transfer',
			emittedFrom: synthProxyAddress,
			args: [
				isReclaim ? account1 : ZERO_ADDRESS,
				isReclaim ? ZERO_ADDRESS : account1,
				expectedAmount,
			],
			bnCloseVariance,
		});

		decodedEventEqual({
			log: logs[1],
			event: isReclaim ? 'Burned' : 'Issued',
			emittedFrom: synthProxyAddress,
			args: [account1, expectedAmount],
			bnCloseVariance,
		});

		decodedEventEqual({
			log: logs[2],
			event: `Exchange${isReclaim ? 'Reclaim' : 'Rebate'}`,
			emittedFrom: await shadows.proxy(),
			args: [account1, currencyKey, expectedAmount],
			bnCloseVariance,
		});

		// return all logs for any other usage
		return logs;
	};

	describe('settlement', () => {
		describe('given the xEUR rate is 2, and xETH is 100, xBTC is 9000', () => {
			beforeEach(async () => {
				// set xUSD:xEUR as 2:1, xUSD:xETH at 100:1, xUSD:xBTC at 9000:1
				await exchangeRates.updateRates(
					[xEUR, xETH, xBTC],
					['2', '100', '9000'].map(toUnit),
					timestamp,
					{
						from: oracle,
					}
				);
			});
			describe('and the exchange fee rate is 1% for easier human consumption', () => {
				beforeEach(async () => {
					exchangeFeeRate = toUnit('0.01');
					await setExchangeFee({ owner, exchangeFeeRate });
				});
				describe('and the waitingPeriodSecs is set to 60', () => {
					beforeEach(async () => {
						await exchanger.setWaitingPeriodSecs('60', { from: owner });
					});
					describe('when the first user exchanges 100 xUSD into xUSD:xEUR at 2:1', () => {
						let amountOfSrcExchanged;
						beforeEach(async () => {
							amountOfSrcExchanged = toUnit('100');
							await shadows.exchange(xUSD, amountOfSrcExchanged, xEUR, { from: account1 });
						});
						it('then settlement reclaimAmount shows 0 reclaim and 0 refund', async () => {
							const settlement = await exchanger.settlementOwing(account1, xEUR);
							assert.equal(settlement.reclaimAmount, '0', 'Nothing can be reclaimAmount');
							assert.equal(settlement.rebateAmount, '0', 'Nothing can be rebateAmount');
						});
						describe('when settle() is invoked on xEUR', () => {
							it('then it reverts as the waiting period has not ended', async () => {
								await assert.revert(shadows.settle(xEUR, { from: account1 }));
							});
						});
						it('when xEUR is attempted to be exchanged away by the user, it reverts', async () => {
							await assert.revert(
								shadows.exchange(xEUR, toUnit('1'), xBTC, { from: account1 }),
								'Cannot settle during waiting period'
							);
						});
						it('when xEUR is attempted to be transferred away by the user, it reverts', async () => {
							await assert.revert(
								xEURContract.transfer(account2, toUnit('1'), { from: account1 }),
								'Cannot transfer during waiting period'
							);
						});
						it('when xEUR is attempted to be transferFrom away by another user, it reverts', async () => {
							await assert.revert(
								xEURContract.transferFrom(account1, account2, toUnit('1'), { from: account1 }),
								'Cannot transfer during waiting period'
							);
						});
						describe('when settle() is invoked on the src synth - xUSD', () => {
							it('then it completes with no reclaim or rebate', async () => {
								const txn = await shadows.settle(xUSD, {
									from: account1,
								});
								assert.equal(
									txn.logs.length,
									0,
									'Must not emit any events as no settlement required'
								);
							});
						});
						describe('when settle() is invoked on xEUR by another user', () => {
							it('then it completes with no reclaim or rebate', async () => {
								const txn = await shadows.settle(xEUR, {
									from: account2,
								});
								assert.equal(
									txn.logs.length,
									0,
									'Must not emit any events as no settlement required'
								);
							});
						});
						describe('when the price doubles for xUSD:xEUR to 4:1', () => {
							beforeEach(async () => {
								fastForward(5);
								timestamp = await currentTime();

								await exchangeRates.updateRates([xEUR], ['4'].map(toUnit), timestamp, {
									from: oracle,
								});
							});
							it('then settlement reclaimAmount shows a reclaim of half the entire balance of xEUR', async () => {
								const expected = calculateExpectedSettlementAmount({
									amount: amountOfSrcExchanged,
									oldRate: divideDecimal(1, 2),
									newRate: divideDecimal(1, 4),
								});

								const { reclaimAmount, rebateAmount } = await exchanger.settlementOwing(
									account1,
									xEUR
								);

								assert.bnEqual(rebateAmount, expected.rebateAmount);
								assert.bnEqual(reclaimAmount, expected.reclaimAmount);
							});
							describe('when settle() is invoked', () => {
								it('then it reverts as the waiting period has not ended', async () => {
									await assert.revert(shadows.settle(xEUR, { from: account1 }));
								});
							});
							describe('when another minute passes', () => {
								let expectedSettlement;
								let srcBalanceBeforeExchange;

								beforeEach(async () => {
									await fastForward(60);
									srcBalanceBeforeExchange = await xEURContract.balanceOf(account1);

									expectedSettlement = calculateExpectedSettlementAmount({
										amount: amountOfSrcExchanged,
										oldRate: divideDecimal(1, 2),
										newRate: divideDecimal(1, 4),
									});
								});
								describe('when settle() is invoked', () => {
									it('then it settles with a reclaim', async () => {
										const { tx: hash } = await shadows.settle(xEUR, {
											from: account1,
										});
										await ensureTxnEmitsSettlementEvents({
											hash,
											synth: xEURContract,
											expected: expectedSettlement,
										});
									});
								});

								// The user has ~49.5 xEUR and has a reclaim of ~24.75 - so 24.75 after settlement
								describe(
									'when an exchange out of xEUR for more than the balance after settlement,' +
										'but less than the total initially',
									() => {
										let txn;
										beforeEach(async () => {
											txn = await shadows.exchange(xEUR, toUnit('30'), xBTC, {
												from: account1,
											});
										});
										it('then it succeeds, exchanging the entire amount after settlement', async () => {
											const srcBalanceAfterExchange = await xEURContract.balanceOf(account1);
											assert.equal(srcBalanceAfterExchange, '0');

											const decodedLogs = await ensureTxnEmitsSettlementEvents({
												hash: txn.tx,
												synth: xEURContract,
												expected: expectedSettlement,
											});

											decodedEventEqual({
												log: decodedLogs.slice(-1)[0],
												event: 'SynthExchange',
												emittedFrom: await shadows.proxy(),
												args: [
													account1,
													xEUR,
													srcBalanceBeforeExchange.sub(expectedSettlement.reclaimAmount),
													xBTC,
												],
											});
										});
									}
								);

								describe(
									'when an exchange out of xEUR for more than the balance after settlement,' +
										'and more than the total initially',
									() => {
										let txn;
										beforeEach(async () => {
											txn = await shadows.exchange(xEUR, toUnit('50'), xBTC, {
												from: account1,
											});
										});
										it('then it succeeds, exchanging the entire amount after settlement', async () => {
											const srcBalanceAfterExchange = await xEURContract.balanceOf(account1);
											assert.equal(srcBalanceAfterExchange, '0');

											const decodedLogs = await ensureTxnEmitsSettlementEvents({
												hash: txn.tx,
												synth: xEURContract,
												expected: expectedSettlement,
											});

											decodedEventEqual({
												log: decodedLogs.slice(-1)[0],
												event: 'SynthExchange',
												emittedFrom: await shadows.proxy(),
												args: [
													account1,
													xEUR,
													srcBalanceBeforeExchange.sub(expectedSettlement.reclaimAmount),
													xBTC,
												],
											});
										});
									}
								);

								describe('when an exchange out of xEUR for less than the balance after settlement', () => {
									let newAmountToExchange;
									let txn;
									beforeEach(async () => {
										newAmountToExchange = toUnit('10');
										txn = await shadows.exchange(xEUR, newAmountToExchange, xBTC, {
											from: account1,
										});
									});
									it('then it succeeds, exchanging the amount given', async () => {
										const srcBalanceAfterExchange = await xEURContract.balanceOf(account1);

										assert.bnClose(
											srcBalanceAfterExchange,
											srcBalanceBeforeExchange
												.sub(expectedSettlement.reclaimAmount)
												.sub(newAmountToExchange)
										);

										const decodedLogs = await ensureTxnEmitsSettlementEvents({
											hash: txn.tx,
											synth: xEURContract,
											expected: expectedSettlement,
										});

										decodedEventEqual({
											log: decodedLogs.slice(-1)[0],
											event: 'SynthExchange',
											emittedFrom: await shadows.proxy(),
											args: [account1, xEUR, newAmountToExchange, xBTC], // amount to exchange must be the reclaim amount
										});
									});
								});

								['transfer', 'transferFrom'].forEach(type => {
									it(`when all of the original xEUR is attempted to be ${type} away by the user, it reverts`, async () => {
										const xEURBalance = await xEURContract.balanceOf(account1);

										let from = account1;
										let optionalFirstArg = [];
										if (type === 'transferFrom') {
											await xEURContract.approve(account2, xEURBalance, { from: account1 });
											optionalFirstArg = account1;
											from = account2;
										}
										const args = [].concat(optionalFirstArg).concat([
											account3,
											xEURBalance,
											{
												from,
											},
										]);

										await assert.revert(xEURContract[type](...args), 'Transfer requires settle');
									});
									it(`when less than the reclaim amount of xEUR is attempted to be ${type} away by the user, it succeeds`, async () => {
										const xEURBalance = await xEURContract.balanceOf(account1);

										let from = account1;
										let optionalFirstArg = [];
										if (type === 'transferFrom') {
											await xEURContract.approve(account2, xEURBalance, { from: account1 });
											optionalFirstArg = account1;
											from = account2;
										}

										const args = [].concat(optionalFirstArg).concat([
											account3,
											// this is less than the reclaim amount
											toUnit('1'),
											{
												from,
											},
										]);
										await xEURContract[type](...args);
									});
								});
							});
						});
						describe('when the price halves for xUSD:xEUR to 1:1', () => {
							beforeEach(async () => {
								await fastForward(5);

								timestamp = await currentTime();

								await exchangeRates.updateRates([xEUR], ['1'].map(toUnit), timestamp, {
									from: oracle,
								});
							});
							it('then settlement rebateAmount shows a rebate of half the entire balance of xEUR', async () => {
								const expected = calculateExpectedSettlementAmount({
									amount: amountOfSrcExchanged,
									oldRate: divideDecimal(1, 2),
									newRate: divideDecimal(1, 1),
								});

								const { reclaimAmount, rebateAmount } = await exchanger.settlementOwing(
									account1,
									xEUR
								);

								assert.bnEqual(rebateAmount, expected.rebateAmount);
								assert.bnEqual(reclaimAmount, expected.reclaimAmount);
							});
							describe('when settlement is invoked', () => {
								it('then it reverts as the waiting period has not ended', async () => {
									await assert.revert(shadows.settle(xEUR, { from: account1 }));
								});
								describe('when another minute passes', () => {
									let expectedSettlement;
									let srcBalanceBeforeExchange;

									beforeEach(async () => {
										await fastForward(60);
										srcBalanceBeforeExchange = await xEURContract.balanceOf(account1);

										expectedSettlement = calculateExpectedSettlementAmount({
											amount: amountOfSrcExchanged,
											oldRate: divideDecimal(1, 2),
											newRate: divideDecimal(1, 1),
										});
									});

									describe('when settle() is invoked', () => {
										it('then it settles with a rebate', async () => {
											const { tx: hash } = await shadows.settle(xEUR, {
												from: account1,
											});
											await ensureTxnEmitsSettlementEvents({
												hash,
												synth: xEURContract,
												expected: expectedSettlement,
											});
										});
									});

									// The user has 49.5 xEUR and has a rebate of 49.5 - so 99 after settlement
									describe('when an exchange out of xEUR for their expected balance before exchange', () => {
										let txn;
										beforeEach(async () => {
											txn = await shadows.exchange(xEUR, toUnit('49.5'), xBTC, {
												from: account1,
											});
										});
										it('then it succeeds, exchanging the entire amount plus the rebate', async () => {
											const srcBalanceAfterExchange = await xEURContract.balanceOf(account1);
											assert.equal(srcBalanceAfterExchange, '0');

											const decodedLogs = await ensureTxnEmitsSettlementEvents({
												hash: txn.tx,
												synth: xEURContract,
												expected: expectedSettlement,
											});

											decodedEventEqual({
												log: decodedLogs.slice(-1)[0],
												event: 'SynthExchange',
												emittedFrom: await shadows.proxy(),
												args: [
													account1,
													xEUR,
													srcBalanceBeforeExchange.add(expectedSettlement.rebateAmount),
													xBTC,
												],
											});
										});
									});

									describe('when an exchange out of xEUR for some amount less than their balance before exchange', () => {
										let txn;
										beforeEach(async () => {
											txn = await shadows.exchange(xEUR, toUnit('10'), xBTC, {
												from: account1,
											});
										});
										it('then it succeeds, exchanging the amount plus the rebate', async () => {
											const decodedLogs = await ensureTxnEmitsSettlementEvents({
												hash: txn.tx,
												synth: xEURContract,
												expected: expectedSettlement,
											});

											decodedEventEqual({
												log: decodedLogs.slice(-1)[0],
												event: 'SynthExchange',
												emittedFrom: await shadows.proxy(),
												args: [
													account1,
													xEUR,
													toUnit('10').add(expectedSettlement.rebateAmount),
													xBTC,
												],
											});
										});
									});
								});
							});
							describe('when the price returns to xUSD:xEUR to 2:1', () => {
								beforeEach(async () => {
									await fastForward(12);

									timestamp = await currentTime();

									await exchangeRates.updateRates([xEUR], ['2'].map(toUnit), timestamp, {
										from: oracle,
									});
								});
								it('then settlement reclaimAmount shows 0 reclaim and 0 refund', async () => {
									const settlement = await exchanger.settlementOwing(account1, xEUR);
									assert.equal(settlement.reclaimAmount, '0', 'Nothing can be reclaimAmount');
									assert.equal(settlement.rebateAmount, '0', 'Nothing can be rebateAmount');
								});
								describe('when another minute elapses and the xETH price changes', () => {
									beforeEach(async () => {
										await fastForward(60);
										timestamp = await currentTime();

										await exchangeRates.updateRates([xEUR], ['3'].map(toUnit), timestamp, {
											from: oracle,
										});
									});
									it('then settlement reclaimAmount still shows 0 reclaim and 0 refund as the timeout period ended', async () => {
										const settlement = await exchanger.settlementOwing(account1, xEUR);
										assert.equal(settlement.reclaimAmount, '0', 'Nothing can be reclaimAmount');
										assert.equal(settlement.rebateAmount, '0', 'Nothing can be rebateAmount');
									});
									describe('when settle() is invoked', () => {
										it('then it settles with no reclaim or rebate', async () => {
											const txn = await shadows.settle(xEUR, {
												from: account1,
											});
											assert.equal(
												txn.logs.length,
												0,
												'Must not emit any events as no settlement required'
											);
										});
									});
								});
							});
						});
					});
					describe('given the first user has 1000 xEUR', () => {
						beforeEach(async () => {
							await issueSynthsToUser({
								owner,
								user: account1,
								amount: toUnit('1000'),
								synth: xEUR,
							});
						});
						describe('when the first user exchanges 100 xEUR into xEUR:xBTC at 9000:2', () => {
							let amountOfSrcExchanged;
							beforeEach(async () => {
								amountOfSrcExchanged = toUnit('100');
								await shadows.exchange(xEUR, amountOfSrcExchanged, xBTC, { from: account1 });
							});
							it('then settlement reclaimAmount shows 0 reclaim and 0 refund', async () => {
								const settlement = await exchanger.settlementOwing(account1, xBTC);
								assert.equal(settlement.reclaimAmount, '0', 'Nothing can be reclaimAmount');
								assert.equal(settlement.rebateAmount, '0', 'Nothing can be rebateAmount');
							});
							describe('when the price doubles for xUSD:xEUR to 4:1', () => {
								beforeEach(async () => {
									fastForward(5);
									timestamp = await currentTime();

									await exchangeRates.updateRates([xEUR], ['4'].map(toUnit), timestamp, {
										from: oracle,
									});
								});
								it('then settlement shows a rebate rebateAmount', async () => {
									const { reclaimAmount, rebateAmount } = await exchanger.settlementOwing(
										account1,
										xBTC
									);

									const expected = calculateExpectedSettlementAmount({
										amount: amountOfSrcExchanged,
										oldRate: divideDecimal(2, 9000),
										newRate: divideDecimal(4, 9000),
									});

									assert.bnClose(rebateAmount, expected.rebateAmount, bnCloseVariance);
									assert.bnEqual(reclaimAmount, expected.reclaimAmount);
								});
								describe('when settlement is invoked', () => {
									it('then it reverts as the waiting period has not ended', async () => {
										await assert.revert(shadows.settle(xBTC, { from: account1 }));
									});
								});
								describe('when the price gains for xBTC more than the loss of the xEUR change', () => {
									beforeEach(async () => {
										await exchangeRates.updateRates([xBTC], ['20000'].map(toUnit), timestamp, {
											from: oracle,
										});
									});
									it('then the reclaimAmount is whats left when subtracting the rebate', async () => {
										const { reclaimAmount, rebateAmount } = await exchanger.settlementOwing(
											account1,
											xBTC
										);

										const expected = calculateExpectedSettlementAmount({
											amount: amountOfSrcExchanged,
											oldRate: divideDecimal(2, 9000),
											newRate: divideDecimal(4, 20000),
										});

										assert.bnEqual(rebateAmount, expected.rebateAmount);
										assert.bnClose(reclaimAmount, expected.reclaimAmount, bnCloseVariance);
									});
									describe('when the same user exchanges some xUSD into xBTC - the same destination', () => {
										let amountOfSrcExchangedSecondary;
										beforeEach(async () => {
											amountOfSrcExchangedSecondary = toUnit('10');
											await shadows.exchange(xUSD, amountOfSrcExchangedSecondary, xBTC, {
												from: account1,
											});
										});
										it('then the reclaimAmount is unchanged', async () => {
											const { reclaimAmount, rebateAmount } = await exchanger.settlementOwing(
												account1,
												xBTC
											);

											const expected = calculateExpectedSettlementAmount({
												amount: amountOfSrcExchanged,
												oldRate: divideDecimal(2, 9000),
												newRate: divideDecimal(4, 20000),
											});

											assert.bnEqual(rebateAmount, expected.rebateAmount);
											assert.bnClose(reclaimAmount, expected.reclaimAmount, bnCloseVariance);
										});
										describe('when the price of xBTC lowers, turning the profit to a loss', () => {
											let expectedFromFirst;
											let expectedFromSecond;
											beforeEach(async () => {
												fastForward(5);
												timestamp = await currentTime();

												await exchangeRates.updateRates([xBTC], ['10000'].map(toUnit), timestamp, {
													from: oracle,
												});

												expectedFromFirst = calculateExpectedSettlementAmount({
													amount: amountOfSrcExchanged,
													oldRate: divideDecimal(2, 9000),
													newRate: divideDecimal(4, 10000),
												});
												expectedFromSecond = calculateExpectedSettlementAmount({
													amount: amountOfSrcExchangedSecondary,
													oldRate: divideDecimal(1, 20000),
													newRate: divideDecimal(1, 10000),
												});
											});
											it('then the reclaimAmount calculation of settlementOwing on xBTC includes both exchanges', async () => {
												const { reclaimAmount, rebateAmount } = await exchanger.settlementOwing(
													account1,
													xBTC
												);

												assert.equal(reclaimAmount, '0');

												assert.bnClose(
													rebateAmount,
													expectedFromFirst.rebateAmount.add(expectedFromSecond.rebateAmount),
													bnCloseVariance
												);
											});
											describe('when another minute passes', () => {
												beforeEach(async () => {
													await fastForward(60);
												});
												describe('when settle() is invoked for xBTC', () => {
													it('then it settles with a rebate', async () => {
														const { tx: hash } = await shadows.settle(xBTC, {
															from: account1,
														});
														const xBTCContract = await Synth.at(await shadows.synths(xBTC));
														await ensureTxnEmitsSettlementEvents({
															hash,
															synth: xBTCContract,
															expected: {
																reclaimAmount: new web3.utils.BN(0),
																rebateAmount: expectedFromFirst.rebateAmount.add(
																	expectedFromSecond.rebateAmount
																),
															},
														});
													});
												});
											});
										});
									});
								});
							});
						});

						describe('and the max number of exchange entries is 5', () => {
							beforeEach(async () => {
								await exchangeState.setMaxEntriesInQueue('5', { from: owner });
							});
							describe('when a user tries to exchange 100 xEUR into xBTC 5 times', () => {
								beforeEach(async () => {
									const txns = [];
									for (let i = 0; i < 5; i++) {
										txns.push(
											await shadows.exchange(xEUR, toUnit('100'), xBTC, { from: account1 })
										);
									}
								});
								it('then all succeed', () => {});
								it('when one more is tried, then if fails', async () => {
									await assert.revert(
										shadows.exchange(xEUR, toUnit('100'), xBTC, { from: account1 }),
										'Max queue length reached'
									);
								});
								describe('when more than 60s elapses', () => {
									beforeEach(async () => {
										await fastForward(70);
									});
									describe('and the user invokes settle() on the dest synth', () => {
										beforeEach(async () => {
											await shadows.settle(xBTC, { from: account1 });
										});
										it('then when the user performs 5 more exchanges into the same synth, it succeeds', async () => {
											for (let i = 0; i < 5; i++) {
												await shadows.exchange(xEUR, toUnit('100'), xBTC, { from: account1 });
											}
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

	describe('calculateAmountAfterSettlement()', () => {
		describe('given a user has 1000 xEUR', () => {
			beforeEach(async () => {
				await issueSynthsToUser({ owner, user: account1, amount: toUnit('1000'), synth: xEUR });
			});
			describe('when calculatAmountAfterSettlement is invoked with and amount < 1000 and no refund', () => {
				let response;
				beforeEach(async () => {
					response = await exchanger.calculateAmountAfterSettlement(
						account1,
						xEUR,
						toUnit('500'),
						'0'
					);
				});
				it('then the response is the given amount of 500', () => {
					assert.bnEqual(response, toUnit('500'));
				});
			});
			describe('when calculatAmountAfterSettlement is invoked with and amount < 1000 and a refund', () => {
				let response;
				beforeEach(async () => {
					response = await exchanger.calculateAmountAfterSettlement(
						account1,
						xEUR,
						toUnit('500'),
						toUnit('25')
					);
				});
				it('then the response is the given amount of 500 plus the refund', () => {
					assert.bnEqual(response, toUnit('525'));
				});
			});
			describe('when calculatAmountAfterSettlement is invoked with and amount > 1000 and no refund', () => {
				let response;
				beforeEach(async () => {
					response = await exchanger.calculateAmountAfterSettlement(
						account1,
						xEUR,
						toUnit('1200'),
						'0'
					);
				});
				it('then the response is the balance of 1000', () => {
					assert.bnEqual(response, toUnit('1000'));
				});
			});
			describe('when calculatAmountAfterSettlement is invoked with and amount > 1000 and a refund', () => {
				let response;
				beforeEach(async () => {
					response = await exchanger.calculateAmountAfterSettlement(
						account1,
						xEUR,
						toUnit('1200'),
						toUnit('50')
					);
				});
				it('then the response is the given amount of 1000 plus the refund', () => {
					assert.bnEqual(response, toUnit('1050'));
				});
			});
		});
	});

	describe('exchange()', () => {
		it('exchange() cannot be invoked directly by any account', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: exchanger.exchange,
				accounts,
				args: [account1, xUSD, toUnit('100'), xAUD, account1],
				reason: 'Only shadows or a synth contract can perform this action',
			});
		});
		it('should allow a user to exchange the synths they hold in one flavour for another', async () => {
			// Give some DOWS to account1
			await shadows.transfer(account1, toUnit('300000'), {
				from: owner,
			});
			// Issue
			const amountIssued = toUnit('2000');
			await shadows.issueSynths(amountIssued, { from: account1 });

			// Get the exchange fee in USD
			const exchangeFeeUSD = await feePool.exchangeFeeIncurred(amountIssued);

			// Exchange xUSD to xAUD
			await shadows.exchange(xUSD, amountIssued, xAUD, { from: account1 });

			// how much xAUD the user is supposed to get
			const effectiveValue = await exchangeRates.effectiveValue(xUSD, amountIssued, xAUD);

			// chargeFee = true so we need to minus the fees for this exchange
			const effectiveValueMinusFees = await feePool.amountReceivedFromExchange(effectiveValue);

			// Assert we have the correct AUD value - exchange fee
			const xAUDBalance = await xAUDContract.balanceOf(account1);
			assert.bnEqual(effectiveValueMinusFees, xAUDBalance);

			// Assert we have the exchange fee to distribute
			const feePeriodZero = await feePool.recentFeePeriods(0);
			assert.bnEqual(exchangeFeeUSD, feePeriodZero.feesToDistribute);
		});

		it('should emit a SynthExchange event', async () => {
			// Give some DOWS to account1
			await shadows.transfer(account1, toUnit('300000'), {
				from: owner,
			});
			// Issue
			const amountIssued = toUnit('2000');
			await shadows.issueSynths(amountIssued, { from: account1 });

			// Exchange xUSD to xAUD
			const txn = await shadows.exchange(xUSD, amountIssued, xAUD, {
				from: account1,
			});

			const xAUDBalance = await xAUDContract.balanceOf(account1);

			const synthExchangeEvent = txn.logs.find(log => log.event === 'SynthExchange');
			assert.eventEqual(synthExchangeEvent, 'SynthExchange', {
				account: account1,
				fromCurrencyKey: toBytes32('xUSD'),
				fromAmount: amountIssued,
				toCurrencyKey: toBytes32('xAUD'),
				toAmount: xAUDBalance,
				toAddress: account1,
			});
		});

		describe('when dealing with inverted synths', () => {
			let iBTCContract;
			beforeEach(async () => {
				iBTCContract = await Synth.at(await shadows.synths(iBTC));
			});
			describe('when the iBTC synth is set with inverse pricing', () => {
				const iBTCEntryPoint = toUnit(4000);
				beforeEach(async () => {
					exchangeRates.setInversePricing(
						iBTC,
						iBTCEntryPoint,
						toUnit(6500),
						toUnit(1000),
						false,
						false,
						{
							from: owner,
						}
					);
				});
				describe('when a user holds holds 100,000 DOWS', () => {
					beforeEach(async () => {
						await shadows.transfer(account1, toUnit(1e5), {
							from: owner,
						});
					});

					describe('when a price within bounds for iBTC is received', () => {
						const iBTCPrice = toUnit(6000);
						beforeEach(async () => {
							await exchangeRates.updateRates([iBTC], [iBTCPrice], timestamp, {
								from: oracle,
							});
						});
						describe('when the user tries to mint 1% of their DOWS value', () => {
							const amountIssued = toUnit(1e3);
							beforeEach(async () => {
								// Issue
								await shadows.issueSynths(amountIssued, { from: account1 });
							});
							describe('when the user tries to exchange some xUSD into iBTC', () => {
								const assertExchangeSucceeded = async ({
									amountExchanged,
									txn,
									exchangeFeeRateMultiplier = 1,
									from = xUSD,
									to = iBTC,
									toContract = iBTCContract,
									prevBalance,
								}) => {
									// Note: this presumes balance was empty before the exchange - won't work when
									// exchanging into xUSD as there is an existing xUSD balance from minting
									const exchangeFeeRate = await feePool.exchangeFeeRate();
									const actualExchangeFee = multiplyDecimal(
										exchangeFeeRate,
										toUnit(exchangeFeeRateMultiplier)
									);
									const balance = await toContract.balanceOf(account1);
									const effectiveValue = await exchangeRates.effectiveValue(
										from,
										amountExchanged,
										to
									);
									const effectiveValueMinusFees = effectiveValue.sub(
										multiplyDecimal(effectiveValue, actualExchangeFee)
									);

									const balanceFromExchange = prevBalance ? balance.sub(prevBalance) : balance;

									assert.bnEqual(balanceFromExchange, effectiveValueMinusFees);

									// check logs
									const synthExchangeEvent = txn.logs.find(log => log.event === 'SynthExchange');

									assert.eventEqual(synthExchangeEvent, 'SynthExchange', {
										fromCurrencyKey: from,
										fromAmount: amountExchanged,
										toCurrencyKey: to,
										toAmount: effectiveValueMinusFees,
										toAddress: account1,
									});
								};
								let exchangeTxns;
								const amountExchanged = toUnit(1e2);
								beforeEach(async () => {
									exchangeTxns = [];
									exchangeTxns.push(
										await shadows.exchange(xUSD, amountExchanged, iBTC, {
											from: account1,
										})
									);
								});
								it('then it exchanges correctly into iBTC', async () => {
									await assertExchangeSucceeded({
										amountExchanged,
										txn: exchangeTxns[0],
										from: xUSD,
										to: iBTC,
										toContract: iBTCContract,
									});
								});
								describe('when the user tries to exchange some iBTC into another synth', () => {
									const newAmountExchanged = toUnit(0.003); // current iBTC balance is a bit under 0.05

									beforeEach(async () => {
										fastForward(500); // fast forward through waiting period
										exchangeTxns.push(
											await shadows.exchange(iBTC, newAmountExchanged, xAUD, {
												from: account1,
											})
										);
									});
									it('then it exchanges correctly out of iBTC', async () => {
										await assertExchangeSucceeded({
											amountExchanged: newAmountExchanged,
											txn: exchangeTxns[1],
											from: iBTC,
											to: xAUD,
											toContract: xAUDContract,
											exchangeFeeRateMultiplier: 2,
										});
									});

									describe('when a price outside of bounds for iBTC is received', () => {
										const newiBTCPrice = toUnit(7500);
										beforeEach(async () => {
											const newTimestamp = await currentTime();
											await exchangeRates.updateRates([iBTC], [newiBTCPrice], newTimestamp, {
												from: oracle,
											});
										});
										describe('when the user tries to exchange some iBTC again', () => {
											beforeEach(async () => {
												fastForward(500); // fast forward through waiting period

												exchangeTxns.push(
													await shadows.exchange(iBTC, toUnit(0.001), xEUR, {
														from: account1,
													})
												);
											});
											it('then it still exchanges correctly into iBTC even when frozen', async () => {
												await assertExchangeSucceeded({
													amountExchanged: toUnit(0.001),
													txn: exchangeTxns[2],
													from: iBTC,
													to: xEUR,
													toContract: xEURContract,
													exchangeFeeRateMultiplier: 2,
												});
											});
										});
										describe('when the user tries to exchange iBTC into another synth', () => {
											beforeEach(async () => {
												fastForward(500); // fast forward through waiting period

												exchangeTxns.push(
													await shadows.exchange(iBTC, newAmountExchanged, xEUR, {
														from: account1,
													})
												);
											});
											it('then it exchanges correctly out of iBTC, even while frozen', async () => {
												await assertExchangeSucceeded({
													amountExchanged: newAmountExchanged,
													txn: exchangeTxns[2],
													from: iBTC,
													to: xEUR,
													toContract: xEURContract,
													exchangeFeeRateMultiplier: 2,
												});
											});
										});
									});
								});
								describe('doubling of fees for swing trades', () => {
									const iBTCexchangeAmount = toUnit(0.002); // current iBTC balance is a bit under 0.05
									let txn;
									describe('when the user tries to exchange some short iBTC into long xBTC', () => {
										beforeEach(async () => {
											fastForward(500); // fast forward through waiting period

											txn = await shadows.exchange(iBTC, iBTCexchangeAmount, xBTC, {
												from: account1,
											});
										});
										it('then it exchanges correctly from iBTC to xBTC, doubling the fee', async () => {
											await assertExchangeSucceeded({
												amountExchanged: iBTCexchangeAmount,
												txn,
												exchangeFeeRateMultiplier: 2,
												from: iBTC,
												to: xBTC,
												toContract: xBTCContract,
											});
										});
										describe('when the user tries to exchange some short iBTC into xEUR', () => {
											beforeEach(async () => {
												fastForward(500); // fast forward through waiting period

												txn = await shadows.exchange(iBTC, iBTCexchangeAmount, xEUR, {
													from: account1,
												});
											});
											it('then it exchanges correctly from iBTC to xEUR, doubling the fee', async () => {
												await assertExchangeSucceeded({
													amountExchanged: iBTCexchangeAmount,
													txn,
													exchangeFeeRateMultiplier: 2,
													from: iBTC,
													to: xEUR,
													toContract: xEURContract,
												});
											});
											describe('when the user tries to exchange some xEUR for iBTC', () => {
												const xEURExchangeAmount = toUnit(0.001);
												let prevBalance;
												beforeEach(async () => {
													fastForward(500); // fast forward through waiting period

													prevBalance = await iBTCContract.balanceOf(account1);
													txn = await shadows.exchange(xEUR, xEURExchangeAmount, iBTC, {
														from: account1,
													});
												});
												it('then it exchanges correctly from xEUR to iBTC, doubling the fee', async () => {
													await assertExchangeSucceeded({
														amountExchanged: xEURExchangeAmount,
														txn,
														exchangeFeeRateMultiplier: 2,
														from: xEUR,
														to: iBTC,
														toContract: iBTCContract,
														prevBalance,
													});
												});
											});
										});
									});
									describe('when the user tries to exchange some short iBTC for xUSD', () => {
										let prevBalance;

										beforeEach(async () => {
											fastForward(500); // fast forward through waiting period

											prevBalance = await xUSDContract.balanceOf(account1);
											txn = await shadows.exchange(iBTC, iBTCexchangeAmount, xUSD, {
												from: account1,
											});
										});
										it('then it exchanges correctly out of iBTC, with the regular fee', async () => {
											await assertExchangeSucceeded({
												amountExchanged: iBTCexchangeAmount,
												txn,
												from: iBTC,
												to: xUSD,
												toContract: xUSDContract,
												prevBalance,
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
});
