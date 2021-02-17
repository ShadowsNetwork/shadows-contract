require('.'); // import common test scaffolding

const Shadows = artifacts.require('Shadows');
const ShadowsState = artifacts.require('ShadowsState');
const Synth = artifacts.require('Synth');

const { toUnit } = require('../utils/testUtils');
const { toBytes32 } = require('../..');

contract('ShadowsState', async accounts => {
	const xUSD = toBytes32('xUSD');

	const [deployerAccount, owner, account1, account2] = accounts;

	let shadows, shadowsState, xUSDContract;

	beforeEach(async () => {
		// Save ourselves from having to await deployed() in every single test.
		// We do this in a beforeEach instead of before to ensure we isolate
		// contract interfaces to prevent test bleed.
		shadows = await Shadows.deployed();
		shadowsState = await ShadowsState.deployed();
		xUSDContract = await Synth.at(await shadows.synths(xUSD));
	});

	it('should set constructor params on deployment', async () => {
		// constructor(address _owner, address _associatedContract)
		const instance = await ShadowsState.new(account1, account2, {
			from: deployerAccount,
		});

		assert.equal(await instance.owner(), account1);
		assert.equal(await instance.associatedContract(), account2);
	});

	it('should allow the owner to set the issuance ratio', async () => {
		const ratio = toUnit('0.2');

		const transaction = await shadowsState.setIssuanceRatio(ratio, {
			from: owner,
		});

		assert.eventEqual(transaction, 'IssuanceRatioUpdated', { newRatio: ratio });
	});

	it('should allow the owner to set the issuance ratio to zero', async () => {
		const ratio = web3.utils.toBN('0');

		const transaction = await shadowsState.setIssuanceRatio(ratio, {
			from: owner,
		});

		assert.eventEqual(transaction, 'IssuanceRatioUpdated', { newRatio: ratio });
	});

	it('should disallow a non-owner from setting the issuance ratio', async () => {
		const ratio = toUnit('0.2');

		await assert.revert(
			shadowsState.setIssuanceRatio(ratio, {
				from: account1,
			})
		);
	});

	it('should disallow setting the issuance ratio above the MAX ratio', async () => {
		const max = toUnit('1');

		// It should succeed when setting it to max
		const transaction = await shadowsState.setIssuanceRatio(max, {
			from: owner,
		});
		assert.eventEqual(transaction, 'IssuanceRatioUpdated', { newRatio: max });

		// But max + 1 should fail
		await assert.revert(
			shadowsState.setIssuanceRatio(web3.utils.toBN(max).add(web3.utils.toBN('1')), {
				from: account1,
			})
		);
	});

	it('should allow the associated contract to setCurrentIssuanceData', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });
		await shadowsState.setCurrentIssuanceData(account2, toUnit('0.1'), { from: account1 });
	});

	it('should disallow another address from calling setCurrentIssuanceData', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });
		await assert.revert(
			shadowsState.setCurrentIssuanceData(account2, toUnit('0.1'), { from: account2 })
		);
	});

	it('should allow the associated contract to clearIssuanceData', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });
		await shadowsState.setCurrentIssuanceData(account2, toUnit('0.1'), { from: account1 });
		await shadowsState.clearIssuanceData(account2, { from: account1 });
		assert.bnEqual((await shadowsState.issuanceData(account2)).initialDebtOwnership, 0);
	});

	it('should disallow another address from calling clearIssuanceData', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });
		await assert.revert(shadowsState.clearIssuanceData(account2, { from: account2 }));
	});

	it('should allow the associated contract to incrementTotalIssuerCount', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });

		await shadowsState.incrementTotalIssuerCount({ from: account1 });
		assert.bnEqual(await shadowsState.totalIssuerCount(), 1);
	});

	it('should disallow another address from calling incrementTotalIssuerCount', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });
		await assert.revert(shadowsState.incrementTotalIssuerCount({ from: account2 }));
	});

	it('should allow the associated contract to decrementTotalIssuerCount', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });

		// We need to increment first or we'll overflow on subtracting from zero and revert that way
		await shadowsState.incrementTotalIssuerCount({ from: account1 });
		await shadowsState.decrementTotalIssuerCount({ from: account1 });
		assert.bnEqual(await shadowsState.totalIssuerCount(), 0);
	});

	it('should disallow another address from calling decrementTotalIssuerCount', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });

		// We need to increment first or we'll overflow on subtracting from zero and revert that way
		await shadowsState.incrementTotalIssuerCount({ from: account1 });
		await assert.revert(shadowsState.decrementTotalIssuerCount({ from: account2 }));
	});

	it('should allow the associated contract to appendDebtLedgerValue', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });

		await shadowsState.appendDebtLedgerValue(toUnit('0.1'), { from: account1 });
		assert.bnEqual(await shadowsState.lastDebtLedgerEntry(), toUnit('0.1'));
	});

	it('should disallow another address from calling appendDebtLedgerValue', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });

		await assert.revert(shadowsState.appendDebtLedgerValue(toUnit('0.1'), { from: account2 }));
	});

	it('should correctly report debtLedgerLength', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });

		assert.bnEqual(await shadowsState.debtLedgerLength(), 0);
		await shadowsState.appendDebtLedgerValue(toUnit('0.1'), { from: account1 });
		assert.bnEqual(await shadowsState.debtLedgerLength(), 1);
	});

	it('should correctly report lastDebtLedgerEntry', async () => {
		await shadowsState.setAssociatedContract(account1, { from: owner });

		// Nothing in the array, so we should revert on invalid opcode
		await assert.invalidOpcode(shadowsState.lastDebtLedgerEntry());
		await shadowsState.appendDebtLedgerValue(toUnit('0.1'), { from: account1 });
		assert.bnEqual(await shadowsState.lastDebtLedgerEntry(), toUnit('0.1'));
	});

	it('should correctly report hasIssued for an address', async () => {
		assert.equal(await shadowsState.hasIssued(owner), false);

		await shadows.issueMaxSynths({ from: owner });
		const synthBalance = await xUSDContract.balanceOf(owner);

		assert.equal(await shadowsState.hasIssued(owner), true);

		await shadows.burnSynths(synthBalance, { from: owner });

		assert.equal(await shadowsState.hasIssued(owner), false);
	});
});
