require('.'); // import common test scaffolding

const ExchangeRates = artifacts.require('ExchangeRates');
const Escrow = artifacts.require('ShadowsEscrow');
const RewardEscrow = artifacts.require('RewardEscrow');
const SupplySchedule = artifacts.require('SupplySchedule');
const ShadowsState = artifacts.require('ShadowsState');
const Shadows = artifacts.require('Shadows');
const Synth = artifacts.require('Synth');
const AddressResolver = artifacts.require('AddressResolver');
const EtherCollateral = artifacts.require('EtherCollateral');
const MockEtherCollateral = artifacts.require('MockEtherCollateral');

const {
	currentTime,
	fastForward,
	fastForwardTo,
	divideDecimal,
	multiplyDecimal,
	toUnit,
	fromUnit,
	ZERO_ADDRESS,
} = require('../utils/testUtils');

const { toBytes32 } = require('../..');

contract('Shadows', async accounts => {
	const [xUSD, xAUD, xEUR, DOWS, xBTC, iBTC, xETH] = [
		'xUSD',
		'xAUD',
		'xEUR',
		'DOWS',
		'xBTC',
		'iBTC',
		'xETH',
	].map(toBytes32);

	const [deployerAccount, owner, account1, account2, account3] = accounts;

	let shadows,
		exchangeRates,
		supplySchedule,
		escrow,
		oracle,
		timestamp,
		addressResolver,
		shadowsState;

	// Updates rates with defaults so they're not stale.
	const updateRatesWithDefaults = async () => {
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[xAUD, xEUR, DOWS, xBTC, iBTC],
			['0.5', '1.25', '0.1', '5000', '4000'].map(toUnit),
			timestamp,
			{
				from: oracle,
			}
		);
	};

	const getRemainingIssuableSynths = async account =>
		(await shadows.remainingIssuableSynths(account))[0];

	beforeEach(async () => {
		// Save ourselves from having to await deployed() in every single test.
		// We do this in a beforeEach instead of before to ensure we isolate
		// contract interfaces to prevent test bleed.
		exchangeRates = await ExchangeRates.deployed();
		supplySchedule = await SupplySchedule.deployed();
		escrow = await Escrow.deployed();

		shadows = await Shadows.deployed();
		shadowsState = await ShadowsState.deployed();

		addressResolver = await AddressResolver.deployed();

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

	describe('constructor', () => {
		it('should set constructor params on deployment', async () => {
			const SHADOWS_TOTAL_SUPPLY = web3.utils.toWei('100000000');
			const instance = await Shadows.new(
				account1,
				account2,
				owner,
				SHADOWS_TOTAL_SUPPLY,
				addressResolver.address,
				{
					from: deployerAccount,
				}
			);

			assert.equal(await instance.proxy(), account1);
			assert.equal(await instance.tokenState(), account2);
			assert.equal(await instance.owner(), owner);
			assert.equal(await instance.totalSupply(), SHADOWS_TOTAL_SUPPLY);
			assert.equal(await instance.resolver(), addressResolver.address);
		});

		it('should set constructor params on upgrade to new totalSupply', async () => {
			const YEAR_2_SHADOWS_TOTAL_SUPPLY = web3.utils.toWei('175000000');
			const instance = await Shadows.new(
				account1,
				account2,
				owner,
				YEAR_2_SHADOWS_TOTAL_SUPPLY,
				addressResolver.address,
				{
					from: deployerAccount,
				}
			);

			assert.equal(await instance.proxy(), account1);
			assert.equal(await instance.tokenState(), account2);
			assert.equal(await instance.owner(), owner);
			assert.equal(await instance.totalSupply(), YEAR_2_SHADOWS_TOTAL_SUPPLY);
			assert.equal(await instance.resolver(), addressResolver.address);
		});
	});

	describe('adding and removing synths', () => {
		it('should allow adding a Synth contract', async () => {
			const previousSynthCount = await shadows.availableSynthCount();

			const synth = await Synth.new(
				account1,
				account2,
				'Synth XYZ123',
				'sXYZ123',
				owner,
				toBytes32('sXYZ123'),
				web3.utils.toWei('0'), // _totalSupply
				addressResolver.address,
				{ from: deployerAccount }
			);

			await shadows.addSynth(synth.address, { from: owner });

			// Assert that we've successfully added a Synth
			assert.bnEqual(
				await shadows.availableSynthCount(),
				previousSynthCount.add(web3.utils.toBN(1))
			);
			// Assert that it's at the end of the array
			assert.equal(await shadows.availableSynths(previousSynthCount), synth.address);
			// Assert that it's retrievable by its currencyKey
			assert.equal(await shadows.synths(toBytes32('sXYZ123')), synth.address);
		});

		it('should disallow adding a Synth contract when the user is not the owner', async () => {
			const synth = await Synth.new(
				account1,
				account2,
				'Synth XYZ123',
				'sXYZ123',
				owner,
				toBytes32('sXYZ123'),
				web3.utils.toWei('0'), // _totalSupply
				addressResolver.address,
				{ from: deployerAccount }
			);

			await assert.revert(shadows.addSynth(synth.address, { from: account1 }));
		});

		it('should disallow double adding a Synth contract with the same address', async () => {
			const synth = await Synth.new(
				account1,
				account2,
				'Synth XYZ123',
				'sXYZ123',
				owner,
				toBytes32('sXYZ123'),
				web3.utils.toWei('0'), // _totalSupply
				addressResolver.address,
				{ from: deployerAccount }
			);

			await shadows.addSynth(synth.address, { from: owner });
			await assert.revert(shadows.addSynth(synth.address, { from: owner }));
		});

		it('should disallow double adding a Synth contract with the same currencyKey', async () => {
			const synth1 = await Synth.new(
				account1,
				account2,
				'Synth XYZ123',
				'sXYZ123',
				owner,
				toBytes32('sXYZ123'),
				web3.utils.toWei('0'), // _totalSupply
				addressResolver.address,
				{ from: deployerAccount }
			);

			const synth2 = await Synth.new(
				account1,
				account2,
				'Synth XYZ123',
				'sXYZ123',
				owner,
				toBytes32('sXYZ123'),
				web3.utils.toWei('0'), // _totalSupply
				addressResolver.address,
				{ from: deployerAccount }
			);

			await shadows.addSynth(synth1.address, { from: owner });
			await assert.revert(shadows.addSynth(synth2.address, { from: owner }));
		});

		it('should allow removing a Synth contract when it has no issued balance', async () => {
			// Note: This test depends on state in the migration script, that there are hooked up synths
			// without balances and we just remove one.
			const currencyKey = xAUD;
			const synthCount = await shadows.availableSynthCount();

			assert.notEqual(await shadows.synths(currencyKey), ZERO_ADDRESS);

			await shadows.removeSynth(currencyKey, { from: owner });

			// Assert that we have one less synth, and that the specific currency key is gone.
			assert.bnEqual(await shadows.availableSynthCount(), synthCount.sub(web3.utils.toBN(1)));
			assert.equal(await shadows.synths(currencyKey), ZERO_ADDRESS);

			// TODO: Check that an event was successfully fired ?
		});

		it('should disallow removing a Synth contract when it has an issued balance', async () => {
			// Note: This test depends on state in the migration script, that there are hooked up synths
			// without balances
			const xAUDContractAddress = await shadows.synths(xAUD);

			// Assert that we can remove the synth and add it back in before we do anything.
			await shadows.removeSynth(xAUD, { from: owner });
			await shadows.addSynth(xAUDContractAddress, { from: owner });

			// Issue one sUSd
			await shadows.issueSynths(toUnit('1'), { from: owner });

			// exchange to xAUD
			await shadows.exchange(xUSD, toUnit('1'), xAUD, { from: owner });

			// Assert that we can't remove the synth now
			await assert.revert(shadows.removeSynth(xAUD, { from: owner }));
		});

		it('should disallow removing a Synth contract when requested by a non-owner', async () => {
			// Note: This test depends on state in the migration script, that there are hooked up synths
			// without balances
			await assert.revert(shadows.removeSynth(xEUR, { from: account1 }));
		});

		it('should revert when requesting to remove a non-existent synth', async () => {
			// Note: This test depends on state in the migration script, that there are hooked up synths
			// without balances
			const currencyKey = toBytes32('NOPE');

			// Assert that we can't remove the synth
			await assert.revert(shadows.removeSynth(currencyKey, { from: owner }));
		});
	});

	describe('totalIssuedSynths()', () => {
		it('should correctly calculate the total issued synths in a single currency', async () => {
			// Two people issue 10 xUSD each. Assert that total issued value is 20 xUSD.

			// Send a price update to guarantee we're not depending on values from outside this test.

			await exchangeRates.updateRates(
				[xAUD, xEUR, DOWS],
				['0.5', '1.25', '0.1'].map(toUnit),
				timestamp,
				{ from: oracle }
			);

			// Give some DOWS to account1 and account2
			await shadows.transfer(account1, toUnit('1000'), { from: owner });
			await shadows.transfer(account2, toUnit('1000'), { from: owner });

			// Issue 10 xUSD each
			await shadows.issueSynths(toUnit('10'), { from: account1 });
			await shadows.issueSynths(toUnit('10'), { from: account2 });

			// Assert that there's 20 xUSD of value in the system
			assert.bnEqual(await shadows.totalIssuedSynths(xUSD), toUnit('20'));
		});

		it('should correctly calculate the total issued synths in multiple currencies', async () => {
			// Alice issues 10 xUSD. Bob issues 20 xAUD. Assert that total issued value is 20 xUSD, and 40 xAUD.

			// Send a price update to guarantee we're not depending on values from outside this test.

			await exchangeRates.updateRates(
				[xAUD, xEUR, DOWS],
				['0.5', '1.25', '0.1'].map(toUnit),
				timestamp,
				{ from: oracle }
			);

			// Give some DOWS to account1 and account2
			await shadows.transfer(account1, toUnit('1000'), { from: owner });
			await shadows.transfer(account2, toUnit('1000'), { from: owner });

			// Issue 10 xUSD each
			await shadows.issueSynths(toUnit('10'), { from: account1 });
			await shadows.issueSynths(toUnit('20'), { from: account2 });

			await shadows.exchange(xUSD, toUnit('20'), xAUD, { from: account2 });

			// Assert that there's 30 xUSD of value in the system
			assert.bnEqual(await shadows.totalIssuedSynths(xUSD), toUnit('30'));

			// And that there's 60 xAUD (minus fees) of value in the system
			assert.bnEqual(await shadows.totalIssuedSynths(xAUD), toUnit('60'));
		});

		it('should return the correct value for the different quantity of total issued synths', async () => {
			// Send a price update to guarantee we're not depending on values from outside this test.

			const rates = ['0.5', '1.25', '0.1'].map(toUnit);

			await exchangeRates.updateRates([xAUD, xEUR, DOWS], rates, timestamp, { from: oracle });

			const aud2usdRate = await exchangeRates.rateForCurrency(xAUD);
			// const eur2usdRate = await exchangeRates.rateForCurrency(xEUR);

			// Give some DOWS to account1 and account2
			await shadows.transfer(account1, toUnit('100000'), {
				from: owner,
			});
			await shadows.transfer(account2, toUnit('100000'), {
				from: owner,
			});

			const issueAmountUSD = toUnit('100');
			const exchangeAmountToAUD = toUnit('95');
			const exchangeAmountToEUR = toUnit('5');

			// Issue
			await shadows.issueSynths(issueAmountUSD, { from: account1 });
			await shadows.issueSynths(issueAmountUSD, { from: account2 });

			// Exchange
			await shadows.exchange(xUSD, exchangeAmountToEUR, xEUR, { from: account1 });
			await shadows.exchange(xUSD, exchangeAmountToEUR, xEUR, { from: account2 });

			await shadows.exchange(xUSD, exchangeAmountToAUD, xAUD, { from: account1 });
			await shadows.exchange(xUSD, exchangeAmountToAUD, xAUD, { from: account2 });

			const totalIssuedAUD = await shadows.totalIssuedSynths(xAUD);

			assert.bnClose(totalIssuedAUD, divideDecimal(toUnit('200'), aud2usdRate));
		});

		it('should not allow checking total issued synths when a rate other than the priced currency is stale', async () => {
			await fastForward((await exchangeRates.rateStalePeriod()).add(web3.utils.toBN('300')));

			await exchangeRates.updateRates([DOWS, xAUD], ['0.1', '0.78'].map(toUnit), timestamp, {
				from: oracle,
			});
			await assert.revert(shadows.totalIssuedSynths(xAUD));
		});

		it('should not allow checking total issued synths when the priced currency is stale', async () => {
			await fastForward((await exchangeRates.rateStalePeriod()).add(web3.utils.toBN('300')));

			await exchangeRates.updateRates([DOWS, xEUR], ['0.1', '1.25'].map(toUnit), timestamp, {
				from: oracle,
			});
			await assert.revert(shadows.totalIssuedSynths(xAUD));
		});
	});

	describe('transfer()', () => {
		it('should transfer using the ERC20 transfer function', async () => {
			// Ensure our environment is set up correctly for our assumptions
			// e.g. owner owns all DOWS.

			assert.bnEqual(await shadows.totalSupply(), await shadows.balanceOf(owner));

			const transaction = await shadows.transfer(account1, toUnit('10'), { from: owner });
			assert.eventEqual(transaction, 'Transfer', {
				from: owner,
				to: account1,
				value: toUnit('10'),
			});

			assert.bnEqual(await shadows.balanceOf(account1), toUnit('10'));
		});

		it('should revert when exceeding locked shadows and calling the ERC20 transfer function', async () => {
			// Ensure our environment is set up correctly for our assumptions
			// e.g. owner owns all DOWS.
			assert.bnEqual(await shadows.totalSupply(), await shadows.balanceOf(owner));

			// Issue max synths.
			await shadows.issueMaxSynths({ from: owner });

			// Try to transfer 0.000000000000000001 DOWS
			await assert.revert(shadows.transfer(account1, '1', { from: owner }));
		});

		it('should transfer using the ERC20 transferFrom function', async () => {
			// Ensure our environment is set up correctly for our assumptions
			// e.g. owner owns all DOWS.
			const previousOwnerBalance = await shadows.balanceOf(owner);
			assert.bnEqual(await shadows.totalSupply(), previousOwnerBalance);

			// Approve account1 to act on our behalf for 10 DOWS.
			let transaction = await shadows.approve(account1, toUnit('10'), { from: owner });
			assert.eventEqual(transaction, 'Approval', {
				owner: owner,
				spender: account1,
				value: toUnit('10'),
			});

			// Assert that transferFrom works.
			transaction = await shadows.transferFrom(owner, account2, toUnit('10'), { from: account1 });
			assert.eventEqual(transaction, 'Transfer', {
				from: owner,
				to: account2,
				value: toUnit('10'),
			});

			// Assert that account2 has 10 DOWS and owner has 10 less DOWS
			assert.bnEqual(await shadows.balanceOf(account2), toUnit('10'));
			assert.bnEqual(await shadows.balanceOf(owner), previousOwnerBalance.sub(toUnit('10')));

			// Assert that we can't transfer more even though there's a balance for owner.
			await assert.revert(
				shadows.transferFrom(owner, account2, '1', {
					from: account1,
				})
			);
		});

		it('should revert when exceeding locked shadows and calling the ERC20 transferFrom function', async () => {
			// Ensure our environment is set up correctly for our assumptions
			// e.g. owner owns all DOWS.
			assert.bnEqual(await shadows.totalSupply(), await shadows.balanceOf(owner));

			// Send a price update to guarantee we're not depending on values from outside this test.

			await exchangeRates.updateRates(
				[xAUD, xEUR, DOWS],
				['0.5', '1.25', '0.1'].map(toUnit),
				timestamp,
				{ from: oracle }
			);

			// Approve account1 to act on our behalf for 10 DOWS.
			const transaction = await shadows.approve(account1, toUnit('10'), { from: owner });
			assert.eventEqual(transaction, 'Approval', {
				owner: owner,
				spender: account1,
				value: toUnit('10'),
			});

			// Issue max synths
			await shadows.issueMaxSynths({ from: owner });

			// Assert that transferFrom fails even for the smallest amount of DOWS.
			await assert.revert(
				shadows.transferFrom(owner, account2, '1', {
					from: account1,
				})
			);
		});

		it('should not allow transfer if the exchange rate for shadows is stale', async () => {
			// Give some DOWS to account1 & account2
			const value = toUnit('300');
			await shadows.transfer(account1, toUnit('10000'), {
				from: owner,
			});
			await shadows.transfer(account2, toUnit('10000'), {
				from: owner,
			});

			// Ensure that we can do a successful transfer before rates go stale
			await shadows.transfer(account2, value, { from: account1 });

			await shadows.approve(account3, value, { from: account2 });
			await shadows.transferFrom(account2, account1, value, {
				from: account3,
			});

			// Now jump forward in time so the rates are stale
			await fastForward((await exchangeRates.rateStalePeriod()) + 1);

			// Send a price update to guarantee we're not depending on values from outside this test.

			await exchangeRates.updateRates([xAUD, xEUR], ['0.5', '1.25'].map(toUnit), timestamp, {
				from: oracle,
			});

			// Subsequent transfers fail
			await assert.revert(shadows.transfer(account2, value, { from: account1 }));

			await shadows.approve(account3, value, { from: account2 });
			await assert.revert(
				shadows.transferFrom(account2, account1, value, {
					from: account3,
				})
			);
		});

		it('should not allow transfer of shadows in escrow', async () => {
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

			// Ensure the transfer fails as all the shadows are in escrow
			await assert.revert(shadows.transfer(account2, toUnit('100'), { from: account1 }));
		});

		it('should not be possible to transfer locked shadows', async () => {
			const issuedShadowss = web3.utils.toBN('200000');
			await shadows.transfer(account1, toUnit(issuedShadowss), {
				from: owner,
			});

			// Issue
			const amountIssued = toUnit('2000');
			await shadows.issueSynths(amountIssued, { from: account1 });

			await assert.revert(
				shadows.transfer(account2, toUnit(issuedShadowss), {
					from: account1,
				})
			);
		});

		it("should lock newly received shadows if the user's collaterisation is too high", async () => {
			// Set xEUR for purposes of this test
			const timestamp1 = await currentTime();
			await exchangeRates.updateRates([xEUR], [toUnit('0.75')], timestamp1, { from: oracle });

			const issuedShadowss = web3.utils.toBN('200000');
			await shadows.transfer(account1, toUnit(issuedShadowss), {
				from: owner,
			});
			await shadows.transfer(account2, toUnit(issuedShadowss), {
				from: owner,
			});

			const maxIssuableSynths = await shadows.maxIssuableSynths(account1);

			// Issue
			await shadows.issueSynths(maxIssuableSynths, { from: account1 });

			// Exchange into xEUR
			await shadows.exchange(xUSD, maxIssuableSynths, xEUR, { from: account1 });

			// Ensure that we can transfer in and out of the account successfully
			await shadows.transfer(account1, toUnit('10000'), {
				from: account2,
			});
			await shadows.transfer(account2, toUnit('10000'), {
				from: account1,
			});

			// Increase the value of xEUR relative to shadows
			const timestamp2 = await currentTime();
			await exchangeRates.updateRates([xEUR], [toUnit('2.10')], timestamp2, { from: oracle });

			// Ensure that the new shadows account1 receives cannot be transferred out.
			await shadows.transfer(account1, toUnit('10000'), {
				from: account2,
			});
			await assert.revert(shadows.transfer(account2, toUnit('10000'), { from: account1 }));
		});

		it('should unlock shadows when collaterisation ratio changes', async () => {
			// Set xAUD for purposes of this test
			const timestamp1 = await currentTime();
			const aud2usdrate = toUnit('2');

			await exchangeRates.updateRates([xAUD], [aud2usdrate], timestamp1, { from: oracle });

			const issuedShadowss = web3.utils.toBN('200000');
			await shadows.transfer(account1, toUnit(issuedShadowss), {
				from: owner,
			});

			// Issue
			const issuedSynths = await shadows.maxIssuableSynths(account1);
			await shadows.issueSynths(issuedSynths, { from: account1 });
			const remainingIssuable = await getRemainingIssuableSynths(account1);
			assert.bnClose(remainingIssuable, '0');

			const transferable1 = await shadows.transferableShadows(account1);
			assert.bnEqual(transferable1, '0');

			// Exchange into xAUD
			await shadows.exchange(xUSD, issuedSynths, xAUD, { from: account1 });

			// Increase the value of xAUD relative to shadows
			const timestamp2 = await currentTime();
			const newAUDExchangeRate = toUnit('1');
			await exchangeRates.updateRates([xAUD], [newAUDExchangeRate], timestamp2, { from: oracle });

			const transferable2 = await shadows.transferableShadows(account1);
			assert.equal(transferable2.gt(toUnit('1000')), true);
		});
	});

	describe('debtBalance()', () => {
		it('should not change debt balance % if exchange rates change', async () => {
			let newAUDRate = toUnit('0.5');
			let timestamp = await currentTime();
			await exchangeRates.updateRates([xAUD], [newAUDRate], timestamp, { from: oracle });

			await shadows.transfer(account1, toUnit('20000'), {
				from: owner,
			});
			await shadows.transfer(account2, toUnit('20000'), {
				from: owner,
			});

			const amountIssuedAcc1 = toUnit('30');
			const amountIssuedAcc2 = toUnit('50');
			await shadows.issueSynths(amountIssuedAcc1, { from: account1 });
			await shadows.issueSynths(amountIssuedAcc2, { from: account2 });
			await shadows.exchange(xUSD, amountIssuedAcc2, xAUD, { from: account2 });

			const PRECISE_UNIT = web3.utils.toWei(web3.utils.toBN('1'), 'gether');
			let totalIssuedSynthxUSD = await shadows.totalIssuedSynths(xUSD);
			const account1DebtRatio = divideDecimal(amountIssuedAcc1, totalIssuedSynthxUSD, PRECISE_UNIT);
			const account2DebtRatio = divideDecimal(amountIssuedAcc2, totalIssuedSynthxUSD, PRECISE_UNIT);

			timestamp = await currentTime();
			newAUDRate = toUnit('1.85');
			await exchangeRates.updateRates([xAUD], [newAUDRate], timestamp, { from: oracle });

			totalIssuedSynthxUSD = await shadows.totalIssuedSynths(xUSD);
			const conversionFactor = web3.utils.toBN(1000000000);
			const expectedDebtAccount1 = multiplyDecimal(
				account1DebtRatio,
				totalIssuedSynthxUSD.mul(conversionFactor),
				PRECISE_UNIT
			).div(conversionFactor);
			const expectedDebtAccount2 = multiplyDecimal(
				account2DebtRatio,
				totalIssuedSynthxUSD.mul(conversionFactor),
				PRECISE_UNIT
			).div(conversionFactor);

			assert.bnClose(await shadows.debtBalanceOf(account1, xUSD), expectedDebtAccount1);
			assert.bnClose(await shadows.debtBalanceOf(account2, xUSD), expectedDebtAccount2);
		});

		it("should correctly calculate a user's debt balance without prior issuance", async () => {
			await shadows.transfer(account1, toUnit('200000'), {
				from: owner,
			});
			await shadows.transfer(account2, toUnit('10000'), {
				from: owner,
			});

			const debt1 = await shadows.debtBalanceOf(account1, toBytes32('xUSD'));
			const debt2 = await shadows.debtBalanceOf(account2, toBytes32('xUSD'));
			assert.bnEqual(debt1, 0);
			assert.bnEqual(debt2, 0);
		});

		it("should correctly calculate a user's debt balance with prior issuance", async () => {
			// Give some DOWS to account1
			await shadows.transfer(account1, toUnit('200000'), {
				from: owner,
			});

			// Issue
			const issuedSynths = toUnit('1001');
			await shadows.issueSynths(issuedSynths, { from: account1 });

			const debt = await shadows.debtBalanceOf(account1, toBytes32('xUSD'));
			assert.bnEqual(debt, issuedSynths);
		});
	});

	describe('maxIssuableSynths()', () => {
		it("should correctly calculate a user's maximum issuable synths without prior issuance", async () => {
			const rate = await exchangeRates.rateForCurrency(toBytes32('DOWS'));
			const issuedShadowss = web3.utils.toBN('200000');
			await shadows.transfer(account1, toUnit(issuedShadowss), {
				from: owner,
			});
			const issuanceRatio = await shadowsState.issuanceRatio();

			const expectedIssuableSynths = multiplyDecimal(
				toUnit(issuedShadowss),
				multiplyDecimal(rate, issuanceRatio)
			);
			const maxIssuableSynths = await shadows.maxIssuableSynths(account1);

			assert.bnEqual(expectedIssuableSynths, maxIssuableSynths);
		});

		it("should correctly calculate a user's maximum issuable synths without any DOWS", async () => {
			const maxIssuableSynths = await shadows.maxIssuableSynths(account1);
			assert.bnEqual(0, maxIssuableSynths);
		});

		it("should correctly calculate a user's maximum issuable synths with prior issuance", async () => {
			const dows2usdRate = await exchangeRates.rateForCurrency(DOWS);

			const issuedShadowss = web3.utils.toBN('320001');
			await shadows.transfer(account1, toUnit(issuedShadowss), {
				from: owner,
			});

			const issuanceRatio = await shadowsState.issuanceRatio();
			const amountIssued = web3.utils.toBN('1234');
			await shadows.issueSynths(toUnit(amountIssued), { from: account1 });

			const expectedIssuableSynths = multiplyDecimal(
				toUnit(issuedShadowss),
				multiplyDecimal(dows2usdRate, issuanceRatio)
			);

			const maxIssuableSynths = await shadows.maxIssuableSynths(account1);
			assert.bnEqual(expectedIssuableSynths, maxIssuableSynths);
		});

		it('should error when calculating maximum issuance when the DOWS rate is stale', async () => {
			// Add stale period to the time to ensure we go stale.
			await fastForward((await exchangeRates.rateStalePeriod()) + 1);

			await exchangeRates.updateRates([xAUD, xEUR], ['0.5', '1.25'].map(toUnit), timestamp, {
				from: oracle,
			});

			await assert.revert(shadows.maxIssuableSynths(account1));
		});

		it('should error when calculating maximum issuance when the currency rate is stale', async () => {
			// Add stale period to the time to ensure we go stale.
			await fastForward((await exchangeRates.rateStalePeriod()) + 1);

			await exchangeRates.updateRates([xEUR, DOWS], ['1.25', '0.12'].map(toUnit), timestamp, {
				from: oracle,
			});

			await assert.revert(shadows.maxIssuableSynths(account1));
		});
	});

	describe('remainingIssuableSynths()', () => {
		it("should correctly calculate a user's remaining issuable synths with prior issuance", async () => {
			const dows2usdRate = await exchangeRates.rateForCurrency(DOWS);
			const issuanceRatio = await shadowsState.issuanceRatio();

			const issuedShadowss = web3.utils.toBN('200012');
			await shadows.transfer(account1, toUnit(issuedShadowss), {
				from: owner,
			});

			// Issue
			const amountIssued = toUnit('2011');
			await shadows.issueSynths(amountIssued, { from: account1 });

			const expectedIssuableSynths = multiplyDecimal(
				toUnit(issuedShadowss),
				multiplyDecimal(dows2usdRate, issuanceRatio)
			).sub(amountIssued);

			const remainingIssuable = await getRemainingIssuableSynths(account1);
			assert.bnEqual(remainingIssuable, expectedIssuableSynths);
		});

		it("should correctly calculate a user's remaining issuable synths without prior issuance", async () => {
			const dows2usdRate = await exchangeRates.rateForCurrency(DOWS);
			const issuanceRatio = await shadowsState.issuanceRatio();

			const issuedShadowss = web3.utils.toBN('20');
			await shadows.transfer(account1, toUnit(issuedShadowss), {
				from: owner,
			});

			const expectedIssuableSynths = multiplyDecimal(
				toUnit(issuedShadowss),
				multiplyDecimal(dows2usdRate, issuanceRatio)
			);

			const remainingIssuable = await getRemainingIssuableSynths(account1);
			assert.bnEqual(remainingIssuable, expectedIssuableSynths);
		});
	});

	describe('mint() - inflationary supply minting', async () => {
		// These tests are using values modeled from https://sips.shadows.io/sips/sip-23
		// https://docs.google.com/spreadsheets/d/1a5r9aFP5bh6wGG4-HIW2MWPf4yMthZvesZOurnG-v_8/edit?ts=5deef2a7#gid=0
		const INITIAL_WEEKLY_SUPPLY = 75e6 / 52;

		const DAY = 86400;
		const WEEK = 604800;

		const INFLATION_START_DATE = 1551830400; // 2019-03-06T00:00:00+00:00

		it('should allow shadows contract to mint inflationary decay for 234 weeks', async () => {
			// fast forward EVM to end of inflation supply decay at week 234
			const week234 = INFLATION_START_DATE + WEEK * 234;
			await fastForwardTo(new Date(week234 * 1000));
			updateRatesWithDefaults();

			const existingSupply = await shadows.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();
			const mintableSupplyDecimal = parseFloat(fromUnit(mintableSupply));
			const currentRewardEscrowBalance = await shadows.balanceOf(RewardEscrow.address);

			// Call mint on Shadows
			await shadows.mint();

			const newTotalSupply = await shadows.totalSupply();
			const newTotalSupplyDecimal = parseFloat(fromUnit(newTotalSupply));
			const minterReward = await supplySchedule.minterReward();

			const expectedEscrowBalance = currentRewardEscrowBalance
				.add(mintableSupply)
				.sub(minterReward);

			// Here we are only checking to 2 decimal places from the excel model referenced above
			// as the precise rounding is not exact but has no effect on the end result to 6 decimals.
			const expectedSupplyToMint = 160387922.86;
			const expectedNewTotalSupply = 260387922.86;
			assert.equal(mintableSupplyDecimal.toFixed(2), expectedSupplyToMint);
			assert.equal(newTotalSupplyDecimal.toFixed(2), expectedNewTotalSupply);

			assert.bnEqual(newTotalSupply, existingSupply.add(mintableSupply));
			assert.bnEqual(await shadows.balanceOf(RewardEscrow.address), expectedEscrowBalance);
		});

		it('should allow shadows contract to mint 2 weeks of supply and minus minterReward', async () => {
			// Issue
			const supplyToMint = toUnit(INITIAL_WEEKLY_SUPPLY * 2);

			// fast forward EVM to Week 3 in of the inflationary supply
			const weekThree = INFLATION_START_DATE + WEEK * 2 + DAY;
			await fastForwardTo(new Date(weekThree * 1000));
			updateRatesWithDefaults();

			const existingSupply = await shadows.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();
			const mintableSupplyDecimal = parseFloat(fromUnit(mintableSupply));
			const currentRewardEscrowBalance = await shadows.balanceOf(RewardEscrow.address);

			// call mint on Shadows
			await shadows.mint();

			const newTotalSupply = await shadows.totalSupply();
			const newTotalSupplyDecimal = parseFloat(fromUnit(newTotalSupply));

			const minterReward = await supplySchedule.minterReward();
			const expectedEscrowBalance = currentRewardEscrowBalance
				.add(mintableSupply)
				.sub(minterReward);

			// Here we are only checking to 2 decimal places from the excel model referenced above
			const expectedSupplyToMintDecimal = parseFloat(fromUnit(supplyToMint));
			const expectedNewTotalSupply = existingSupply.add(supplyToMint);
			const expectedNewTotalSupplyDecimal = parseFloat(fromUnit(expectedNewTotalSupply));
			assert.equal(mintableSupplyDecimal.toFixed(2), expectedSupplyToMintDecimal.toFixed(2));
			assert.equal(newTotalSupplyDecimal.toFixed(2), expectedNewTotalSupplyDecimal.toFixed(2));

			assert.bnEqual(newTotalSupply, existingSupply.add(mintableSupply));
			assert.bnEqual(await shadows.balanceOf(RewardEscrow.address), expectedEscrowBalance);
		});

		it('should allow shadows contract to mint the same supply for 39 weeks into the inflation prior to decay', async () => {
			// 39 weeks mimics the inflationary supply minted on mainnet
			const expectedTotalSupply = toUnit(1e8 + INITIAL_WEEKLY_SUPPLY * 39);
			const expectedSupplyToMint = toUnit(INITIAL_WEEKLY_SUPPLY * 39);

			// fast forward EVM to Week 2 in Year 3 schedule starting at UNIX 1583971200+
			const weekThirtyNine = INFLATION_START_DATE + WEEK * 39 + DAY;
			await fastForwardTo(new Date(weekThirtyNine * 1000));
			updateRatesWithDefaults();

			const existingTotalSupply = await shadows.totalSupply();
			const currentRewardEscrowBalance = await shadows.balanceOf(RewardEscrow.address);
			const mintableSupply = await supplySchedule.mintableSupply();

			// call mint on Shadows
			await shadows.mint();

			const newTotalSupply = await shadows.totalSupply();
			const minterReward = await supplySchedule.minterReward();
			const expectedEscrowBalance = currentRewardEscrowBalance
				.add(expectedSupplyToMint)
				.sub(minterReward);

			// The precision is slightly off using 18 wei. Matches mainnet.
			assert.bnClose(newTotalSupply, expectedTotalSupply, 27);
			assert.bnClose(mintableSupply, expectedSupplyToMint, 27);

			assert.bnClose(newTotalSupply, existingTotalSupply.add(expectedSupplyToMint), 27);
			assert.bnClose(await shadows.balanceOf(RewardEscrow.address), expectedEscrowBalance, 27);
		});

		it('should allow shadows contract to mint 2 weeks into Terminal Inflation', async () => {
			// fast forward EVM to week 236
			const september142023 = INFLATION_START_DATE + 236 * WEEK + DAY;
			await fastForwardTo(new Date(september142023 * 1000));
			updateRatesWithDefaults();

			const existingTotalSupply = await shadows.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();

			// call mint on Shadows
			await shadows.mint();

			const newTotalSupply = await shadows.totalSupply();

			const expectedTotalSupply = toUnit('260638356.052421715910204590');
			const expectedSupplyToMint = expectedTotalSupply.sub(existingTotalSupply);

			assert.bnEqual(newTotalSupply, existingTotalSupply.add(expectedSupplyToMint));
			assert.bnEqual(newTotalSupply, expectedTotalSupply);
			assert.bnEqual(mintableSupply, expectedSupplyToMint);
		});

		it('should allow shadows contract to mint Terminal Inflation to 2030', async () => {
			// fast forward EVM to week 236
			const week573 = INFLATION_START_DATE + 572 * WEEK + DAY;
			await fastForwardTo(new Date(week573 * 1000));
			updateRatesWithDefaults();

			const existingTotalSupply = await shadows.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();

			// call mint on Shadows
			await shadows.mint();

			const newTotalSupply = await shadows.totalSupply();

			const expectedTotalSupply = toUnit('306320971.934765774167963072');
			const expectedSupplyToMint = expectedTotalSupply.sub(existingTotalSupply);

			assert.bnEqual(newTotalSupply, existingTotalSupply.add(expectedSupplyToMint));
			assert.bnEqual(newTotalSupply, expectedTotalSupply);
			assert.bnEqual(mintableSupply, expectedSupplyToMint);
		});

		it('should be able to mint again after another 7 days period', async () => {
			// fast forward EVM to Week 3 in Year 2 schedule starting at UNIX 1553040000+
			const weekThree = INFLATION_START_DATE + 2 * WEEK + 1 * DAY;
			await fastForwardTo(new Date(weekThree * 1000));
			updateRatesWithDefaults();

			let existingTotalSupply = await shadows.totalSupply();
			let mintableSupply = await supplySchedule.mintableSupply();

			// call mint on Shadows
			await shadows.mint();

			let newTotalSupply = await shadows.totalSupply();
			assert.bnEqual(newTotalSupply, existingTotalSupply.add(mintableSupply));

			// fast forward EVM to Week 4
			const weekFour = weekThree + 1 * WEEK + 1 * DAY;
			await fastForwardTo(new Date(weekFour * 1000));
			updateRatesWithDefaults();

			existingTotalSupply = await shadows.totalSupply();
			mintableSupply = await supplySchedule.mintableSupply();

			// call mint on Shadows
			await shadows.mint();

			newTotalSupply = await shadows.totalSupply();
			assert.bnEqual(newTotalSupply, existingTotalSupply.add(mintableSupply));
		});

		it('should revert when trying to mint again within the 7 days period', async () => {
			// fast forward EVM to Week 3 of inflation
			const weekThree = INFLATION_START_DATE + 2 * WEEK + DAY;
			await fastForwardTo(new Date(weekThree * 1000));
			updateRatesWithDefaults();

			const existingTotalSupply = await shadows.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();

			// call mint on Shadows
			await shadows.mint();

			const newTotalSupply = await shadows.totalSupply();
			assert.bnEqual(newTotalSupply, existingTotalSupply.add(mintableSupply));

			const weekFour = weekThree + DAY * 1;
			await fastForwardTo(new Date(weekFour * 1000));
			updateRatesWithDefaults();

			// should revert if try to mint again within 7 day period / mintable supply is 0
			await assert.revert(shadows.mint());
		});
	});

	describe('when etherCollateral is set', async () => {
		const collateralKey = 'EtherCollateral';

		let etherCollateral;
		beforeEach(async () => {
			etherCollateral = await EtherCollateral.at(
				await addressResolver.getAddress(toBytes32(collateralKey))
			);
		});
		it('should have zero totalIssuedSynths', async () => {
			// no synths issued in etherCollateral
			assert.bnEqual(0, await etherCollateral.totalIssuedSynths());

			// totalIssuedSynthsExcludeEtherCollateral equal totalIssuedSynths
			assert.bnEqual(
				await shadows.totalIssuedSynths(xUSD),
				await shadows.totalIssuedSynthsExcludeEtherCollateral(xUSD)
			);
		});
		describe('creating a loan on etherCollateral to issue xETH', async () => {
			let xETHContract;
			beforeEach(async () => {
				// mock etherCollateral
				etherCollateral = await MockEtherCollateral.new({ from: owner });
				// have the owner simulate being MultiCollateral so we can invoke issue and burn
				await addressResolver.importAddresses(
					[toBytes32(collateralKey)],
					[etherCollateral.address],
					{ from: owner }
				);

				xETHContract = await Synth.at(await shadows.synths(xETH));

				// Give some DOWS to account1
				await shadows.transfer(account1, toUnit('1000'), { from: owner });

				// account1 should be able to issue
				await shadows.issueSynths(toUnit('10'), { from: account1 });

				// set owner as Shadows on resolver to allow issuing by owner
				await addressResolver.importAddresses([toBytes32('Shadows')], [owner], { from: owner });
			});

			it('should be able to exclude xETH issued by ether Collateral from totalIssuedSynths', async () => {
				const totalSupplyBefore = await shadows.totalIssuedSynths(xETH);

				// issue xETH
				const amountToIssue = toUnit('10');
				await xETHContract.issue(account1, amountToIssue, { from: owner });

				// openLoan of same amount on Ether Collateral
				await etherCollateral.openLoan(amountToIssue, { from: owner });

				// totalSupply of synths should exclude Ether Collateral issued synths
				assert.bnEqual(
					totalSupplyBefore,
					await shadows.totalIssuedSynthsExcludeEtherCollateral(xETH)
				);

				// totalIssuedSynths after includes amount issued
				assert.bnEqual(
					await shadows.totalIssuedSynths(xETH),
					totalSupplyBefore.add(amountToIssue)
				);
			});

			it('should exclude xETH issued by ether Collateral from debtBalanceOf', async () => {
				// account1 should own 100% of the debt.
				const debtBefore = await shadows.debtBalanceOf(account1, xUSD);
				assert.bnEqual(debtBefore, toUnit('10'));

				// issue xETH to mimic loan
				const amountToIssue = toUnit('10');
				await xETHContract.issue(account1, amountToIssue, { from: owner });
				await etherCollateral.openLoan(amountToIssue, { from: owner });

				// After account1 owns 100% of xUSD debt.
				assert.bnEqual(await shadows.totalIssuedSynthsExcludeEtherCollateral(xUSD), toUnit('10'));
				assert.bnEqual(await shadows.debtBalanceOf(account1, xUSD), debtBefore);
			});
		});
	});
});
