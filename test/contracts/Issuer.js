require('.'); // import common test scaffolding

const ExchangeRates = artifacts.require('ExchangeRates');
const Escrow = artifacts.require('ShadowsEscrow');
const RewardEscrow = artifacts.require('RewardEscrow');
const Issuer = artifacts.require('Issuer');
const FeePool = artifacts.require('FeePool');
const Shadows = artifacts.require('Shadows');
const ShadowsState = artifacts.require('ShadowsState');
const Synth = artifacts.require('Synth');

const {
	currentTime,
	multiplyDecimal,
	divideDecimal,
	toUnit,
	fastForward,
} = require('../utils/testUtils');

const {
	setExchangeWaitingPeriod,
	setExchangeFee,
	getDecodedLogs,
	decodedEventEqual,
	onlyGivenAddressCanInvoke,
	ensureOnlyExpectedMutativeFunctions,
} = require('../utils/setupUtils');

const { toBytes32 } = require('../..');

contract('Issuer (via Shadows)', async accounts => {
	const [xUSD, xAUD, xEUR, DOWS, xBTC, iBTC] = ['xUSD', 'xAUD', 'xEUR', 'DOWS', 'xBTC', 'iBTC'].map(
		toBytes32
	);

	const [, owner, account1, account2, account3, account6] = accounts;

	let shadows,
		shadowsState,
		exchangeRates,
		feePool,
		xUSDContract,
		escrow,
		rewardEscrow,
		oracle,
		timestamp,
		issuer;

	const getRemainingIssuableSynths = async account =>
		(await shadows.remainingIssuableSynths(account))[0];

	beforeEach(async () => {
		// Save ourselves from having to await deployed() in every single test.
		// We do this in a beforeEach instead of before to ensure we isolate
		// contract interfaces to prevent test bleed.
		exchangeRates = await ExchangeRates.deployed();
		feePool = await FeePool.deployed();
		escrow = await Escrow.deployed();
		rewardEscrow = await RewardEscrow.deployed();

		shadows = await Shadows.deployed();
		shadowsState = await ShadowsState.deployed();
		xUSDContract = await Synth.at(await shadows.synths(xUSD));
		issuer = await Issuer.deployed();
		// Send a price update to guarantee we're not stale.
		oracle = await exchangeRates.oracle();
		timestamp = await currentTime();

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS, xBTC, iBTC],
			['0.5', '1.25', '0.1', '5000', '4000'].map(toUnit),
			timestamp,
			{
				from: oracle,
			}
		);
	});

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: issuer.abi,
			ignoreParents: ['MixinResolver'],
			expected: ['issueSynths', 'issueMaxSynths', 'burnSynths'],
		});
	});

	describe('protected methods', () => {
		it('issueSynths() cannot be invoked directly by a user', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: issuer.issueSynths,
				args: [account1, toUnit('1')],
				accounts,
				reason: 'Only the shadows contract can perform this action',
			});
		});
		it('issueMaxSynths() cannot be invoked directly by a user', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: issuer.issueMaxSynths,
				args: [account1],
				accounts,
				reason: 'Only the shadows contract can perform this action',
			});
		});
		it('burnSynths() cannot be invoked directly by a user', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: issuer.burnSynths,
				args: [account1, toUnit('1')],
				accounts,
				reason: 'Only the shadows contract can perform this action',
			});
		});
	});
	// Issuance
	it('should allow the issuance of a small amount of synths', async () => {
		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('1000'), { from: owner });

		// account1 should be able to issue
		// Note: If a too small amount of synths are issued here, the amount may be
		// rounded to 0 in the debt register. This will revert. As such, there is a minimum
		// number of synths that need to be issued each time issue is invoked. The exact
		// amount depends on the Synth exchange rate and the total supply.
		await shadows.issueSynths(web3.utils.toBN('5'), { from: account1 });
	});

	it('should be possible to issue the maximum amount of synths via issueSynths', async () => {
		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('1000'), { from: owner });

		const maxSynths = await shadows.maxIssuableSynths(account1);

		// account1 should be able to issue
		await shadows.issueSynths(maxSynths, { from: account1 });
	});

	it('should allow an issuer to issue synths in one flavour', async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('1000'), { from: owner });

		// account1 should be able to issue
		await shadows.issueSynths(toUnit('10'), { from: account1 });

		// There should be 10 xUSD of value in the system
		assert.bnEqual(await shadows.totalIssuedSynths(xUSD), toUnit('10'));

		// And account1 should own 100% of the debt.
		assert.bnEqual(await shadows.totalIssuedSynths(xUSD), toUnit('10'));
		assert.bnEqual(await shadows.debtBalanceOf(account1, xUSD), toUnit('10'));
	});

	// TODO: Check that the rounding errors are acceptable
	it('should allow two issuers to issue synths in one flavour', async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some DOWS to account1 and account2
		await shadows.transfer(account1, toUnit('10000'), {
			from: owner,
		});
		await shadows.transfer(account2, toUnit('10000'), {
			from: owner,
		});

		// Issue
		await shadows.issueSynths(toUnit('10'), { from: account1 });
		await shadows.issueSynths(toUnit('20'), { from: account2 });

		// There should be 30xUSD of value in the system
		assert.bnEqual(await shadows.totalIssuedSynths(xUSD), toUnit('30'));

		// And the debt should be split 50/50.
		// But there's a small rounding error.
		// This is ok, as when the last person exits the system, their debt percentage is always 100% so
		// these rounding errors don't cause the system to be out of balance.
		assert.bnClose(await shadows.debtBalanceOf(account1, xUSD), toUnit('10'));
		assert.bnClose(await shadows.debtBalanceOf(account2, xUSD), toUnit('20'));
	});

	it('should allow multi-issuance in one flavour', async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some DOWS to account1 and account2
		await shadows.transfer(account1, toUnit('10000'), {
			from: owner,
		});
		await shadows.transfer(account2, toUnit('10000'), {
			from: owner,
		});

		// Issue
		await shadows.issueSynths(toUnit('10'), { from: account1 });
		await shadows.issueSynths(toUnit('20'), { from: account2 });
		await shadows.issueSynths(toUnit('10'), { from: account1 });

		// There should be 40 xUSD of value in the system
		assert.bnEqual(await shadows.totalIssuedSynths(xUSD), toUnit('40'));

		// And the debt should be split 50/50.
		// But there's a small rounding error.
		// This is ok, as when the last person exits the system, their debt percentage is always 100% so
		// these rounding errors don't cause the system to be out of balance.
		assert.bnClose(await shadows.debtBalanceOf(account1, xUSD), toUnit('20'));
		assert.bnClose(await shadows.debtBalanceOf(account2, xUSD), toUnit('20'));
	});

	it('should allow an issuer to issue max synths in one flavour', async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('10000'), {
			from: owner,
		});

		// Issue
		await shadows.issueMaxSynths({ from: account1 });

		// There should be 200 xUSD of value in the system
		assert.bnEqual(await shadows.totalIssuedSynths(xUSD), toUnit('200'));

		// And account1 should own all of it.
		assert.bnEqual(await shadows.debtBalanceOf(account1, xUSD), toUnit('200'));
	});

	it('should allow an issuer to issue max synths via the standard issue call', async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('10000'), {
			from: owner,
		});

		// Determine maximum amount that can be issued.
		const maxIssuable = await shadows.maxIssuableSynths(account1);

		// Issue
		await shadows.issueSynths(maxIssuable, { from: account1 });

		// There should be 200 xUSD of value in the system
		assert.bnEqual(await shadows.totalIssuedSynths(xUSD), toUnit('200'));

		// And account1 should own all of it.
		assert.bnEqual(await shadows.debtBalanceOf(account1, xUSD), toUnit('200'));
	});

	it('should disallow an issuer from issuing synths beyond their remainingIssuableSynths', async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('10000'), {
			from: owner,
		});

		// They should now be able to issue xUSD
		const issuableSynths = await getRemainingIssuableSynths(account1);
		assert.bnEqual(issuableSynths, toUnit('200'));

		// Issue that amount.
		await shadows.issueSynths(issuableSynths, { from: account1 });

		// They should now have 0 issuable synths.
		assert.bnEqual(await getRemainingIssuableSynths(account1), '0');

		// And trying to issue the smallest possible unit of one should fail.
		await assert.revert(shadows.issueSynths('1', { from: account1 }));
	});

	it('should allow an issuer with outstanding debt to burn synths and decrease debt', async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('10000'), {
			from: owner,
		});

		// Issue
		await shadows.issueMaxSynths({ from: account1 });

		// account1 should now have 200 xUSD of debt.
		assert.bnEqual(await shadows.debtBalanceOf(account1, xUSD), toUnit('200'));

		// Burn 100 xUSD
		await shadows.burnSynths(toUnit('100'), { from: account1 });

		// account1 should now have 100 xUSD of debt.
		assert.bnEqual(await shadows.debtBalanceOf(account1, xUSD), toUnit('100'));
	});

	it('should disallow an issuer without outstanding debt from burning synths', async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.
		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('10000'), {
			from: owner,
		});

		// Issue
		await shadows.issueMaxSynths({ from: account1 });

		// account2 should not have anything and can't burn.
		await assert.revert(shadows.burnSynths(toUnit('10'), { from: account2 }));

		// And even when we give account2 synths, it should not be able to burn.
		await xUSDContract.transfer(account2, toUnit('100'), {
			from: account1,
		});
		await assert.revert(shadows.burnSynths(toUnit('10'), { from: account2 }));
	});

	it('should burn 0 when trying to burn synths that do not exist', async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('10000'), {
			from: owner,
		});

		// Issue
		await shadows.issueMaxSynths({ from: account1 });

		// Transfer all newly issued synths to account2
		await xUSDContract.transfer(account2, toUnit('200'), {
			from: account1,
		});

		const debtBefore = await shadows.debtBalanceOf(account1, xUSD);
		assert.ok(!debtBefore.isNeg());
		// Burning any amount of xUSD will reduce the amount down to the current supply, which is 0
		await shadows.burnSynths('1', { from: account1 });
		const debtAfter = await shadows.debtBalanceOf(account1, xUSD);
		// So assert their debt balabce is unchanged from the burn of 0
		assert.bnEqual(debtBefore, debtAfter);
	});

	it("should only burn up to a user's actual debt level", async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('10000'), {
			from: owner,
		});
		await shadows.transfer(account2, toUnit('10000'), {
			from: owner,
		});

		// Issue
		const fullAmount = toUnit('210');
		const account1Payment = toUnit('10');
		const account2Payment = fullAmount.sub(account1Payment);
		await shadows.issueSynths(account1Payment, { from: account1 });
		await shadows.issueSynths(account2Payment, { from: account2 });

		// Transfer all of account2's synths to account1
		await xUSDContract.transfer(account1, toUnit('200'), {
			from: account2,
		});
		// return;

		// Calculate the amount that account1 should actually receive
		const amountReceived = await feePool.amountReceivedFromTransfer(toUnit('200'));

		const balanceOfAccount1 = await xUSDContract.balanceOf(account1);

		// Then try to burn them all. Only 10 synths (and fees) should be gone.
		await shadows.burnSynths(balanceOfAccount1, { from: account1 });
		const balanceOfAccount1AfterBurn = await xUSDContract.balanceOf(account1);

		// console.log('##### txn', txn);
		// for (let i = 0; i < txn.logs.length; i++) {
		// 	const result = txn.logs[i].args;
		// 	// console.log('##### txn ???', result);
		// 	for (let j = 0; j < result.__length__; j++) {
		// 		if (txn.logs[i].event === 'SomethingElse' && j === 0) {
		// 			console.log(`##### txn ${i} str`, web3.utils.hexToAscii(txn.logs[i].args[j]));
		// 		} else {
		// 			console.log(`##### txn ${i}`, txn.logs[i].args[j].toString());
		// 		}
		// 	}
		// }

		// Recording debts in the debt ledger reduces accuracy.
		//   Let's allow for a 1000 margin of error.
		assert.bnClose(balanceOfAccount1AfterBurn, amountReceived, '1000');
	});

	it('should correctly calculate debt in a multi-issuance scenario', async () => {
		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('200000'), {
			from: owner,
		});
		await shadows.transfer(account2, toUnit('200000'), {
			from: owner,
		});

		// Issue
		const issuedSynthsPt1 = toUnit('2000');
		const issuedSynthsPt2 = toUnit('2000');
		await shadows.issueSynths(issuedSynthsPt1, { from: account1 });
		await shadows.issueSynths(issuedSynthsPt2, { from: account1 });
		await shadows.issueSynths(toUnit('1000'), { from: account2 });

		const debt = await shadows.debtBalanceOf(account1, xUSD);
		assert.bnClose(debt, toUnit('4000'));
	});

	it('should correctly calculate debt in a multi-issuance multi-burn scenario', async () => {
		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('500000'), {
			from: owner,
		});
		await shadows.transfer(account2, toUnit('14000'), {
			from: owner,
		});

		// Issue
		const issuedSynthsPt1 = toUnit('2000');
		const burntSynthsPt1 = toUnit('1500');
		const issuedSynthsPt2 = toUnit('1600');
		const burntSynthsPt2 = toUnit('500');

		await shadows.issueSynths(issuedSynthsPt1, { from: account1 });
		await shadows.burnSynths(burntSynthsPt1, { from: account1 });
		await shadows.issueSynths(issuedSynthsPt2, { from: account1 });

		await shadows.issueSynths(toUnit('100'), { from: account2 });
		await shadows.issueSynths(toUnit('51'), { from: account2 });
		await shadows.burnSynths(burntSynthsPt2, { from: account1 });

		const debt = await shadows.debtBalanceOf(account1, toBytes32('xUSD'));
		const expectedDebt = issuedSynthsPt1
			.add(issuedSynthsPt2)
			.sub(burntSynthsPt1)
			.sub(burntSynthsPt2);

		assert.bnClose(debt, expectedDebt);
	});

	it("should allow me to burn all synths I've issued when there are other issuers", async () => {
		const totalSupply = await shadows.totalSupply();
		const account2Shadowss = toUnit('120000');
		const account1Shadowss = totalSupply.sub(account2Shadowss);

		await shadows.transfer(account1, account1Shadowss, {
			from: owner,
		}); // Issue the massive majority to account1
		await shadows.transfer(account2, account2Shadowss, {
			from: owner,
		}); // Issue a small amount to account2

		// Issue from account1
		const account1AmountToIssue = await shadows.maxIssuableSynths(account1);
		await shadows.issueMaxSynths({ from: account1 });
		const debtBalance1 = await shadows.debtBalanceOf(account1, xUSD);
		assert.bnClose(debtBalance1, account1AmountToIssue);

		// Issue and burn from account 2 all debt
		await shadows.issueSynths(toUnit('43'), { from: account2 });
		let debt = await shadows.debtBalanceOf(account2, xUSD);
		await shadows.burnSynths(toUnit('43'), { from: account2 });
		debt = await shadows.debtBalanceOf(account2, xUSD);

		assert.bnEqual(debt, 0);

		// Should set user issuanceData to 0 debtOwnership and retain debtEntryIndex of last action
		assert.deepEqual(await shadowsState.issuanceData(account2), {
			initialDebtOwnership: 0,
			debtEntryIndex: 2,
		});
	});

	// These tests take a long time to run
	// ****************************************
	describe('multiple issue and burn scenarios', () => {
		it('should correctly calculate debt in a high issuance and burn scenario', async () => {
			const getRandomInt = (min, max) => {
				return min + Math.floor(Math.random() * Math.floor(max));
			};

			const totalSupply = await shadows.totalSupply();
			const account2Shadowss = toUnit('120000');
			const account1Shadowss = totalSupply.sub(account2Shadowss);

			await shadows.transfer(account1, account1Shadowss, {
				from: owner,
			}); // Issue the massive majority to account1
			await shadows.transfer(account2, account2Shadowss, {
				from: owner,
			}); // Issue a small amount to account2

			const account1AmountToIssue = await shadows.maxIssuableSynths(account1);
			await shadows.issueMaxSynths({ from: account1 });
			const debtBalance1 = await shadows.debtBalanceOf(account1, xUSD);
			assert.bnClose(debtBalance1, account1AmountToIssue);

			let expectedDebtForAccount2 = web3.utils.toBN('0');
			const totalTimesToIssue = 40;
			for (let i = 0; i < totalTimesToIssue; i++) {
				// Seems that in this case, issuing 43 each time leads to increasing the variance regularly each time.
				const amount = toUnit('43');
				await shadows.issueSynths(amount, { from: account2 });
				expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);

				const desiredAmountToBurn = toUnit(web3.utils.toBN(getRandomInt(4, 14)));
				const amountToBurn = desiredAmountToBurn.lte(expectedDebtForAccount2)
					? desiredAmountToBurn
					: expectedDebtForAccount2;
				await shadows.burnSynths(amountToBurn, { from: account2 });
				expectedDebtForAccount2 = expectedDebtForAccount2.sub(amountToBurn);

				// Useful debug logging
				// const db = await shadows.debtBalanceOf(account2, xUSD);
				// const variance = fromUnit(expectedDebtForAccount2.sub(db));
				// console.log(
				// 	`#### debtBalance: ${db}\t\t expectedDebtForAccount2: ${expectedDebtForAccount2}\t\tvariance: ${variance}`
				// );
			}
			const debtBalance = await shadows.debtBalanceOf(account2, xUSD);

			// Here we make the variance a calculation of the number of times we issue/burn.
			// This is less than ideal, but is the result of calculating the debt based on
			// the results of the issue/burn each time.
			const variance = web3.utils.toBN(totalTimesToIssue).mul(web3.utils.toBN('2'));
			assert.bnClose(debtBalance, expectedDebtForAccount2, variance);
		});

		it('should correctly calculate debt in a high (random) issuance and burn scenario', async () => {
			const getRandomInt = (min, max) => {
				return min + Math.floor(Math.random() * Math.floor(max));
			};

			const totalSupply = await shadows.totalSupply();
			const account2Shadowss = toUnit('120000');
			const account1Shadowss = totalSupply.sub(account2Shadowss);

			await shadows.transfer(account1, account1Shadowss, {
				from: owner,
			}); // Issue the massive majority to account1
			await shadows.transfer(account2, account2Shadowss, {
				from: owner,
			}); // Issue a small amount to account2

			const account1AmountToIssue = await shadows.maxIssuableSynths(account1);
			await shadows.issueMaxSynths({ from: account1 });
			const debtBalance1 = await shadows.debtBalanceOf(account1, xUSD);
			assert.bnClose(debtBalance1, account1AmountToIssue);

			let expectedDebtForAccount2 = web3.utils.toBN('0');
			const totalTimesToIssue = 40;
			for (let i = 0; i < totalTimesToIssue; i++) {
				// Seems that in this case, issuing 43 each time leads to increasing the variance regularly each time.
				const amount = toUnit(web3.utils.toBN(getRandomInt(40, 49)));
				await shadows.issueSynths(amount, { from: account2 });
				expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);

				const desiredAmountToBurn = toUnit(web3.utils.toBN(getRandomInt(37, 46)));
				const amountToBurn = desiredAmountToBurn.lte(expectedDebtForAccount2)
					? desiredAmountToBurn
					: expectedDebtForAccount2;
				await shadows.burnSynths(amountToBurn, { from: account2 });
				expectedDebtForAccount2 = expectedDebtForAccount2.sub(amountToBurn);

				// Useful debug logging
				// const db = await shadows.debtBalanceOf(account2, xUSD);
				// const variance = fromUnit(expectedDebtForAccount2.sub(db));
				// console.log(
				// 	`#### debtBalance: ${db}\t\t expectedDebtForAccount2: ${expectedDebtForAccount2}\t\tvariance: ${variance}`
				// );
			}
			const debtBalance = await shadows.debtBalanceOf(account2, xUSD);

			// Here we make the variance a calculation of the number of times we issue/burn.
			// This is less than ideal, but is the result of calculating the debt based on
			// the results of the issue/burn each time.
			const variance = web3.utils.toBN(totalTimesToIssue).mul(web3.utils.toBN('2'));
			assert.bnClose(debtBalance, expectedDebtForAccount2, variance);
		});

		it('should correctly calculate debt in a high volume contrast issuance and burn scenario', async () => {
			const totalSupply = await shadows.totalSupply();

			// Give only 100 Shadows to account2
			const account2Shadowss = toUnit('100');

			// Give the vast majority to account1 (ie. 99,999,900)
			const account1Shadowss = totalSupply.sub(account2Shadowss);

			await shadows.transfer(account1, account1Shadowss, {
				from: owner,
			}); // Issue the massive majority to account1
			await shadows.transfer(account2, account2Shadowss, {
				from: owner,
			}); // Issue a small amount to account2

			const account1AmountToIssue = await shadows.maxIssuableSynths(account1);
			await shadows.issueMaxSynths({ from: account1 });
			const debtBalance1 = await shadows.debtBalanceOf(account1, xUSD);
			assert.bnEqual(debtBalance1, account1AmountToIssue);

			let expectedDebtForAccount2 = web3.utils.toBN('0');
			const totalTimesToIssue = 40;
			for (let i = 0; i < totalTimesToIssue; i++) {
				const amount = toUnit('0.000000000000000002');
				await shadows.issueSynths(amount, { from: account2 });
				expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);
			}
			const debtBalance2 = await shadows.debtBalanceOf(account2, xUSD);

			// Here we make the variance a calculation of the number of times we issue/burn.
			// This is less than ideal, but is the result of calculating the debt based on
			// the results of the issue/burn each time.
			const variance = web3.utils.toBN(totalTimesToIssue).mul(web3.utils.toBN('2'));
			assert.bnClose(debtBalance2, expectedDebtForAccount2, variance);
		});
	});

	// ****************************************

	it("should prevent more issuance if the user's collaterisation changes to be insufficient", async () => {
		// Set xEUR for purposes of this test
		const timestamp1 = await currentTime();
		await exchangeRates.updateRates([xEUR], [toUnit('0.75')], timestamp1, { from: oracle });

		const issuedShadowss = web3.utils.toBN('200000');
		await shadows.transfer(account1, toUnit(issuedShadowss), {
			from: owner,
		});

		const maxIssuableSynths = await shadows.maxIssuableSynths(account1);

		// Issue
		const synthsToNotIssueYet = web3.utils.toBN('2000');
		const issuedSynths = maxIssuableSynths.sub(synthsToNotIssueYet);
		await shadows.issueSynths(issuedSynths, { from: account1 });

		// exchange into xEUR
		await shadows.exchange(xUSD, issuedSynths, xEUR, { from: account1 });

		// Increase the value of xEUR relative to shadows
		const timestamp2 = await currentTime();
		await exchangeRates.updateRates([xEUR], [toUnit('1.10')], timestamp2, { from: oracle });

		await assert.revert(shadows.issueSynths(synthsToNotIssueYet, { from: account1 }));
	});

	// Check user's collaterisation ratio

	it('should return 0 if user has no shadows when checking the collaterisation ratio', async () => {
		const ratio = await shadows.collateralisationRatio(account1);
		assert.bnEqual(ratio, new web3.utils.BN(0));
	});

	it('Any user can check the collaterisation ratio for a user', async () => {
		const issuedShadowss = web3.utils.toBN('320000');
		await shadows.transfer(account1, toUnit(issuedShadowss), {
			from: owner,
		});

		// Issue
		const issuedSynths = toUnit(web3.utils.toBN('6400'));
		await shadows.issueSynths(issuedSynths, { from: account1 });

		await shadows.collateralisationRatio(account1, { from: account2 });
	});

	it('should be able to read collaterisation ratio for a user with shadows but no debt', async () => {
		const issuedShadowss = web3.utils.toBN('30000');
		await shadows.transfer(account1, toUnit(issuedShadowss), {
			from: owner,
		});

		const ratio = await shadows.collateralisationRatio(account1);
		assert.bnEqual(ratio, new web3.utils.BN(0));
	});

	it('should be able to read collaterisation ratio for a user with shadows and debt', async () => {
		const issuedShadowss = web3.utils.toBN('320000');
		await shadows.transfer(account1, toUnit(issuedShadowss), {
			from: owner,
		});

		// Issue
		const issuedSynths = toUnit(web3.utils.toBN('6400'));
		await shadows.issueSynths(issuedSynths, { from: account1 });

		const ratio = await shadows.collateralisationRatio(account1, { from: account2 });
		assert.unitEqual(ratio, '0.2');
	});

	it("should include escrowed shadows when calculating a user's collaterisation ratio", async () => {
		const dows2usdRate = await exchangeRates.rateForCurrency(DOWS);
		const transferredShadowss = toUnit('60000');
		await shadows.transfer(account1, transferredShadowss, {
			from: owner,
		});

		// Setup escrow
		const oneWeek = 60 * 60 * 24 * 7;
		const twelveWeeks = oneWeek * 12;
		const now = await currentTime();
		const escrowedShadowss = toUnit('30000');
		await shadows.transfer(escrow.address, escrowedShadowss, {
			from: owner,
		});
		await escrow.appendVestingEntry(
			account1,
			web3.utils.toBN(now + twelveWeeks),
			escrowedShadowss,
			{
				from: owner,
			}
		);

		// Issue
		const maxIssuable = await shadows.maxIssuableSynths(account1);
		await shadows.issueSynths(maxIssuable, { from: account1 });

		// Compare
		const collaterisationRatio = await shadows.collateralisationRatio(account1);
		const expectedCollaterisationRatio = divideDecimal(
			maxIssuable,
			multiplyDecimal(escrowedShadowss.add(transferredShadowss), dows2usdRate)
		);
		assert.bnEqual(collaterisationRatio, expectedCollaterisationRatio);
	});

	it("should include escrowed reward shadows when calculating a user's collaterisation ratio", async () => {
		const dows2usdRate = await exchangeRates.rateForCurrency(DOWS);
		const transferredShadowss = toUnit('60000');
		await shadows.transfer(account1, transferredShadowss, {
			from: owner,
		});

		// Setup reward escrow
		const feePoolAccount = account6;
		await rewardEscrow.setFeePool(feePoolAccount, { from: owner });

		const escrowedShadowss = toUnit('30000');
		await shadows.transfer(rewardEscrow.address, escrowedShadowss, {
			from: owner,
		});
		await rewardEscrow.appendVestingEntry(account1, escrowedShadowss, { from: feePoolAccount });

		// Issue
		const maxIssuable = await shadows.maxIssuableSynths(account1);
		await shadows.issueSynths(maxIssuable, { from: account1 });

		// Compare
		const collaterisationRatio = await shadows.collateralisationRatio(account1);
		const expectedCollaterisationRatio = divideDecimal(
			maxIssuable,
			multiplyDecimal(escrowedShadowss.add(transferredShadowss), dows2usdRate)
		);
		assert.bnEqual(collaterisationRatio, expectedCollaterisationRatio);
	});

	it('should permit user to issue xUSD debt with only escrowed DOWS as collateral (no DOWS in wallet)', async () => {
		const oneWeek = 60 * 60 * 24 * 7;
		const twelveWeeks = oneWeek * 12;
		const now = await currentTime();

		// Send a price update to guarantee we're not depending on values from outside this test.
		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// ensure collateral of account1 is empty
		let collateral = await shadows.collateral(account1, { from: account1 });
		assert.bnEqual(collateral, 0);

		// ensure account1 has no DOWS balance
		const dowsBalance = await shadows.balanceOf(account1);
		assert.bnEqual(dowsBalance, 0);

		// Append escrow amount to account1
		const escrowedAmount = toUnit('15000');
		await shadows.transfer(escrow.address, escrowedAmount, {
			from: owner,
		});
		await escrow.appendVestingEntry(account1, web3.utils.toBN(now + twelveWeeks), escrowedAmount, {
			from: owner,
		});

		// collateral should include escrowed amount
		collateral = await shadows.collateral(account1, { from: account1 });
		assert.bnEqual(collateral, escrowedAmount);

		// Issue max synths. (300 xUSD)
		await shadows.issueMaxSynths({ from: account1 });

		// There should be 300 xUSD of value for account1
		assert.bnEqual(await shadows.debtBalanceOf(account1, xUSD), toUnit('300'));
	});

	it('should permit user to issue xUSD debt with only reward escrow as collateral (no DOWS in wallet)', async () => {
		// Setup reward escrow
		const feePoolAccount = account6;
		await rewardEscrow.setFeePool(feePoolAccount, { from: owner });

		// Send a price update to guarantee we're not depending on values from outside this test.
		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// ensure collateral of account1 is empty
		let collateral = await shadows.collateral(account1, { from: account1 });
		assert.bnEqual(collateral, 0);

		// ensure account1 has no DOWS balance
		const dowsBalance = await shadows.balanceOf(account1);
		assert.bnEqual(dowsBalance, 0);

		// Append escrow amount to account1
		const escrowedAmount = toUnit('15000');
		await shadows.transfer(RewardEscrow.address, escrowedAmount, {
			from: owner,
		});
		await rewardEscrow.appendVestingEntry(account1, escrowedAmount, { from: feePoolAccount });

		// collateral now should include escrowed amount
		collateral = await shadows.collateral(account1, { from: account1 });
		assert.bnEqual(collateral, escrowedAmount);

		// Issue max synths. (300 xUSD)
		await shadows.issueMaxSynths({ from: account1 });

		// There should be 300 xUSD of value for account1
		assert.bnEqual(await shadows.debtBalanceOf(account1, xUSD), toUnit('300'));
	});

	it("should permit anyone checking another user's collateral", async () => {
		const amount = toUnit('60000');
		await shadows.transfer(account1, amount, { from: owner });
		const collateral = await shadows.collateral(account1, { from: account2 });
		assert.bnEqual(collateral, amount);
	});

	it("should include escrowed shadows when checking a user's collateral", async () => {
		const oneWeek = 60 * 60 * 24 * 7;
		const twelveWeeks = oneWeek * 12;
		const now = await currentTime();
		const escrowedAmount = toUnit('15000');
		await shadows.transfer(escrow.address, escrowedAmount, {
			from: owner,
		});
		await escrow.appendVestingEntry(account1, web3.utils.toBN(now + twelveWeeks), escrowedAmount, {
			from: owner,
		});

		const amount = toUnit('60000');
		await shadows.transfer(account1, amount, { from: owner });
		const collateral = await shadows.collateral(account1, { from: account2 });
		assert.bnEqual(collateral, amount.add(escrowedAmount));
	});

	it("should include escrowed reward shadows when checking a user's collateral", async () => {
		const feePoolAccount = account6;
		const escrowedAmount = toUnit('15000');
		await shadows.transfer(rewardEscrow.address, escrowedAmount, {
			from: owner,
		});
		await rewardEscrow.setFeePool(feePoolAccount, { from: owner });
		await rewardEscrow.appendVestingEntry(account1, escrowedAmount, { from: feePoolAccount });
		const amount = toUnit('60000');
		await shadows.transfer(account1, amount, { from: owner });
		const collateral = await shadows.collateral(account1, { from: account2 });
		assert.bnEqual(collateral, amount.add(escrowedAmount));
	});

	// Stale rate check

	it('should allow anyone to check if any rates are stale', async () => {
		const instance = await ExchangeRates.deployed();
		const result = await instance.anyRateIsStale([xEUR, xAUD], { from: owner });
		assert.equal(result, false);
	});

	it("should calculate a user's remaining issuable synths", async () => {
		const transferredShadowss = toUnit('60000');
		await shadows.transfer(account1, transferredShadowss, {
			from: owner,
		});

		// Issue
		const maxIssuable = await shadows.maxIssuableSynths(account1);
		const issued = maxIssuable.div(web3.utils.toBN(3));
		await shadows.issueSynths(issued, { from: account1 });
		const expectedRemaining = maxIssuable.sub(issued);
		const remaining = await getRemainingIssuableSynths(account1);
		assert.bnEqual(expectedRemaining, remaining);
	});

	it("should correctly calculate a user's max issuable synths with escrowed shadows", async () => {
		const dows2usdRate = await exchangeRates.rateForCurrency(DOWS);
		const transferredShadowss = toUnit('60000');
		await shadows.transfer(account1, transferredShadowss, {
			from: owner,
		});

		// Setup escrow
		const oneWeek = 60 * 60 * 24 * 7;
		const twelveWeeks = oneWeek * 12;
		const now = await currentTime();
		const escrowedShadowss = toUnit('30000');
		await shadows.transfer(escrow.address, escrowedShadowss, {
			from: owner,
		});
		await escrow.appendVestingEntry(
			account1,
			web3.utils.toBN(now + twelveWeeks),
			escrowedShadowss,
			{
				from: owner,
			}
		);

		const maxIssuable = await shadows.maxIssuableSynths(account1);
		// await shadows.issueSynths(maxIssuable, { from: account1 });

		// Compare
		const issuanceRatio = await shadowsState.issuanceRatio();
		const expectedMaxIssuable = multiplyDecimal(
			multiplyDecimal(escrowedShadowss.add(transferredShadowss), dows2usdRate),
			issuanceRatio
		);
		assert.bnEqual(maxIssuable, expectedMaxIssuable);
	});

	// Burning Synths

	it("should successfully burn all user's synths", async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.

		await exchangeRates.updateRates([DOWS], [toUnit('0.1')], timestamp, {
			from: oracle,
		});

		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('10000'), {
			from: owner,
		});

		// Issue
		await shadows.issueSynths(toUnit('199'), { from: account1 });

		// Then try to burn them all. Only 10 synths (and fees) should be gone.
		await shadows.burnSynths(await xUSDContract.balanceOf(account1), { from: account1 });
		assert.bnEqual(await xUSDContract.balanceOf(account1), web3.utils.toBN(0));
	});

	it('should burn the correct amount of synths', async () => {
		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('400000'), {
			from: owner,
		});

		// Issue
		await shadows.issueSynths(toUnit('3987'), { from: account1 });

		// Then try to burn some of them. There should be 3000 left.
		await shadows.burnSynths(toUnit('987'), { from: account1 });
		assert.bnEqual(await xUSDContract.balanceOf(account1), toUnit('3000'));
	});

	it("should successfully burn all user's synths even with transfer", async () => {
		// Send a price update to guarantee we're not depending on values from outside this test.

		await exchangeRates.updateRates([DOWS], [toUnit('0.1')], timestamp, {
			from: oracle,
		});

		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('300000'), {
			from: owner,
		});

		// Issue
		const amountIssued = toUnit('2000');
		await shadows.issueSynths(amountIssued, { from: account1 });

		// Transfer account1's synths to account2 and back
		const amountToTransfer = toUnit('1800');
		await xUSDContract.transfer(account2, amountToTransfer, {
			from: account1,
		});
		const remainingAfterTransfer = await xUSDContract.balanceOf(account1);
		await xUSDContract.transfer(account1, await xUSDContract.balanceOf(account2), {
			from: account2,
		});

		// Calculate the amount that account1 should actually receive
		const amountReceived = await feePool.amountReceivedFromTransfer(toUnit('1800'));
		const amountReceived2 = await feePool.amountReceivedFromTransfer(amountReceived);
		const amountLostToFees = amountToTransfer.sub(amountReceived2);

		// Check that the transfer worked ok.
		const amountExpectedToBeLeftInWallet = amountIssued.sub(amountLostToFees);
		assert.bnEqual(amountReceived2.add(remainingAfterTransfer), amountExpectedToBeLeftInWallet);

		// Now burn 1000 and check we end up with the right amount
		await shadows.burnSynths(toUnit('1000'), { from: account1 });
		assert.bnEqual(
			await xUSDContract.balanceOf(account1),
			amountExpectedToBeLeftInWallet.sub(toUnit('1000'))
		);
	});

	it('should allow the last user in the system to burn all their synths to release their shadows', async () => {
		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('500000'), {
			from: owner,
		});
		await shadows.transfer(account2, toUnit('140000'), {
			from: owner,
		});
		await shadows.transfer(account3, toUnit('1400000'), {
			from: owner,
		});

		// Issue
		const issuedSynths1 = toUnit('2000');
		const issuedSynths2 = toUnit('2000');
		const issuedSynths3 = toUnit('2000');

		// Send more than their synth balance to burn all
		const burnAllSynths = toUnit('2050');

		await shadows.issueSynths(issuedSynths1, { from: account1 });
		await shadows.issueSynths(issuedSynths2, { from: account2 });
		await shadows.issueSynths(issuedSynths3, { from: account3 });

		await shadows.burnSynths(burnAllSynths, { from: account1 });
		await shadows.burnSynths(burnAllSynths, { from: account2 });
		await shadows.burnSynths(burnAllSynths, { from: account3 });

		const debtBalance1After = await shadows.debtBalanceOf(account1, xUSD);
		const debtBalance2After = await shadows.debtBalanceOf(account2, xUSD);
		const debtBalance3After = await shadows.debtBalanceOf(account3, xUSD);

		assert.bnEqual(debtBalance1After, '0');
		assert.bnEqual(debtBalance2After, '0');
		assert.bnEqual(debtBalance3After, '0');
	});

	it('should allow user to burn all synths issued even after other users have issued', async () => {
		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('500000'), {
			from: owner,
		});
		await shadows.transfer(account2, toUnit('140000'), {
			from: owner,
		});
		await shadows.transfer(account3, toUnit('1400000'), {
			from: owner,
		});

		// Issue
		const issuedSynths1 = toUnit('2000');
		const issuedSynths2 = toUnit('2000');
		const issuedSynths3 = toUnit('2000');

		await shadows.issueSynths(issuedSynths1, { from: account1 });
		await shadows.issueSynths(issuedSynths2, { from: account2 });
		await shadows.issueSynths(issuedSynths3, { from: account3 });

		const debtBalanceBefore = await shadows.debtBalanceOf(account1, xUSD);
		await shadows.burnSynths(debtBalanceBefore, { from: account1 });
		const debtBalanceAfter = await shadows.debtBalanceOf(account1, xUSD);

		assert.bnEqual(debtBalanceAfter, '0');
	});

	it('should allow a user to burn up to their balance if they try too burn too much', async () => {
		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('500000'), {
			from: owner,
		});

		// Issue
		const issuedSynths1 = toUnit('10');

		await shadows.issueSynths(issuedSynths1, { from: account1 });
		await shadows.burnSynths(issuedSynths1.add(toUnit('9000')), {
			from: account1,
		});
		const debtBalanceAfter = await shadows.debtBalanceOf(account1, xUSD);

		assert.bnEqual(debtBalanceAfter, '0');
	});

	it('should allow users to burn their debt and adjust the debtBalanceOf correctly for remaining users', async () => {
		// Give some DOWS to account1
		await shadows.transfer(account1, toUnit('40000000'), {
			from: owner,
		});
		await shadows.transfer(account2, toUnit('40000000'), {
			from: owner,
		});

		// Issue
		const issuedSynths1 = toUnit('150000');
		const issuedSynths2 = toUnit('50000');

		await shadows.issueSynths(issuedSynths1, { from: account1 });
		await shadows.issueSynths(issuedSynths2, { from: account2 });

		let debtBalance1After = await shadows.debtBalanceOf(account1, xUSD);
		let debtBalance2After = await shadows.debtBalanceOf(account2, xUSD);

		// debtBalanceOf has rounding error but is within tolerance
		assert.bnClose(debtBalance1After, toUnit('150000'));
		assert.bnClose(debtBalance2After, toUnit('50000'));

		// Account 1 burns 100,000
		await shadows.burnSynths(toUnit('100000'), { from: account1 });

		debtBalance1After = await shadows.debtBalanceOf(account1, xUSD);
		debtBalance2After = await shadows.debtBalanceOf(account2, xUSD);

		assert.bnClose(debtBalance1After, toUnit('50000'));
		assert.bnClose(debtBalance2After, toUnit('50000'));
	});

	it('should revert if sender tries to issue synths with 0 amount', async () => {
		// Issue 0 amount of synth
		const issuedSynths1 = toUnit('0');

		await assert.revert(shadows.issueSynths(issuedSynths1, { from: account1 }));
	});

	describe('burnSynths() after exchange()', () => {
		describe('given the waiting period is set to 60s', () => {
			let amount;
			beforeEach(async () => {
				amount = toUnit('1250');
				await setExchangeWaitingPeriod({ owner, secs: 60 });
				// set the exchange fee to 0 to effectively ignore it
				await setExchangeFee({ owner, exchangeFeeRate: '0' });
			});
			describe('and a user has 1250 xUSD issued', () => {
				beforeEach(async () => {
					await shadows.transfer(account1, toUnit('1000000'), { from: owner });
					await shadows.issueSynths(amount, { from: account1 });
				});
				describe('and is has been exchanged into xEUR at a rate of 1.25:1 and the waiting period has expired', () => {
					beforeEach(async () => {
						await shadows.exchange(xUSD, amount, xEUR, { from: account1 });
						await fastForward(90); // make sure the waiting period is expired on this
					});
					describe('and they have exchanged all of it back into xUSD', () => {
						// let xUSDBalanceAfterExchange;
						beforeEach(async () => {
							await shadows.exchange(xEUR, toUnit('1000'), xUSD, { from: account1 });
							// xUSDBalanceAfterExchange = await xUSDContract.balanceOf(account1);
						});
						describe('when they attempt to burn the xUSD', () => {
							it('then it fails as the waiting period is ongoing', async () => {
								await assert.revert(
									shadows.burnSynths(amount, { from: account1 }),
									'Cannot settle during waiting period'
								);
							});
						});
						describe('and 60s elapses with no change in the xEUR rate', () => {
							beforeEach(async () => {
								fastForward(60);
							});
							describe('when they attempt to burn the xUSD', () => {
								let txn;
								beforeEach(async () => {
									txn = await shadows.burnSynths(amount, { from: account1 });
								});
								it('then it succeeds and burns the entire xUSD amount', async () => {
									const logs = await getDecodedLogs({ hash: txn.tx });
									const xUSDProxy = await xUSDContract.proxy();

									decodedEventEqual({
										event: 'Burned',
										emittedFrom: xUSDProxy,
										args: [account1, amount],
										log: logs.find(({ name }) => name === 'Burned'),
									});

									const xUSDBalance = await xUSDContract.balanceOf(account1);
									assert.equal(xUSDBalance, '0');

									const debtBalance = await shadows.debtBalanceOf(account1, xUSD);
									assert.equal(debtBalance, '0');
								});
							});
						});
						describe('and the xEUR price decreases by 20% to 1', () => {
							beforeEach(async () => {
								// fastForward(1);
								// timestamp = await currentTime();
								await exchangeRates.updateRates([xEUR], ['1'].map(toUnit), timestamp, {
									from: oracle,
								});
							});
							describe('and 60s elapses', () => {
								beforeEach(async () => {
									fastForward(60);
								});
								describe('when they attempt to burn the entire amount xUSD', () => {
									let txn;
									beforeEach(async () => {
										txn = await shadows.burnSynths(amount, { from: account1 });
									});
									it('then it succeeds and burns their xUSD minus the reclaim amount from settlement', async () => {
										const logs = await getDecodedLogs({ hash: txn.tx });
										const xUSDProxy = await xUSDContract.proxy();

										decodedEventEqual({
											event: 'Burned',
											emittedFrom: xUSDProxy,
											args: [account1, amount.sub(toUnit('250'))],
											log: logs
												.reverse()
												.filter(l => !!l)
												.find(({ name }) => name === 'Burned'),
										});

										const xUSDBalance = await xUSDContract.balanceOf(account1);
										assert.equal(xUSDBalance, '0');
									});
									it('and their debt balance is now 0 because they are the only debt holder in the system', async () => {
										// the debt balance remaining is what was reclaimed from the exchange
										const debtBalance = await shadows.debtBalanceOf(account1, xUSD);
										// because this user is the only one holding debt, when we burn 250 xUSD in a reclaim,
										// it removes it from the totalIssuedSynths and
										assert.equal(debtBalance, '0');
									});
								});
								describe('when another user also has the same amount of debt', () => {
									beforeEach(async () => {
										await shadows.transfer(account2, toUnit('1000000'), { from: owner });
										await shadows.issueSynths(amount, { from: account2 });
									});
									describe('when the first user attempts to burn the entire amount xUSD', () => {
										let txn;
										beforeEach(async () => {
											txn = await shadows.burnSynths(amount, { from: account1 });
										});
										it('then it succeeds and burns their xUSD minus the reclaim amount from settlement', async () => {
											const logs = await getDecodedLogs({ hash: txn.tx });
											const xUSDProxy = await xUSDContract.proxy();

											decodedEventEqual({
												event: 'Burned',
												emittedFrom: xUSDProxy,
												args: [account1, amount.sub(toUnit('250'))],
												log: logs
													.reverse()
													.filter(l => !!l)
													.find(({ name }) => name === 'Burned'),
											});

											const xUSDBalance = await xUSDContract.balanceOf(account1);
											assert.equal(xUSDBalance, '0');
										});
										it('and their debt balance is now half of the reclaimed balance because they owe half of the pool', async () => {
											// the debt balance remaining is what was reclaimed from the exchange
											const debtBalance = await shadows.debtBalanceOf(account1, xUSD);
											// because this user is holding half the debt, when we burn 250 xUSD in a reclaim,
											// it removes it from the totalIssuedSynths and so both users have half of 250
											// in owing synths
											assert.bnEqual(debtBalance, divideDecimal('250', 2));
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
