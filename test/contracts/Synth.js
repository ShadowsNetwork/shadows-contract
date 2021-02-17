require('.'); // import common test scaffolding

const ExchangeRates = artifacts.require('ExchangeRates');
const MockExchanger = artifacts.require('MockExchanger');
const FeePool = artifacts.require('FeePool');
const ShadowsProxy = artifacts.require('Proxy');
const Shadows = artifacts.require('Shadows');
const Synth = artifacts.require('Synth');
const AddressResolver = artifacts.require('AddressResolver');

const { currentTime, toUnit, ZERO_ADDRESS, bytesToString } = require('../utils/testUtils');
const {
	issueSynthsToUser,
	ensureOnlyExpectedMutativeFunctions,
	onlyGivenAddressCanInvoke,
} = require('../utils/setupUtils');
const { toBytes32 } = require('../..');

contract('Synth', async accounts => {
	const [xUSD, DOWS, xEUR] = ['xUSD', 'DOWS', 'xEUR'].map(toBytes32);

	const [
		deployerAccount,
		owner, // Oracle next, is not needed
		,
		,
		account1,
		account2,
	] = accounts;

	let feePool,
		FEE_ADDRESS,
		shadowsProxy,
		shadows,
		exchangeRates,
		xUSDContract,
		addressResolver,
		xEURContract;

	beforeEach(async () => {
		// Save ourselves from having to await deployed() in every single test.
		// We do this in a beforeEach instead of before to ensure we isolate
		// contract interfaces to prevent test bleed.
		exchangeRates = await ExchangeRates.deployed();
		feePool = await FeePool.deployed();
		FEE_ADDRESS = await feePool.FEE_ADDRESS();

		shadows = await Shadows.deployed();
		shadowsProxy = await ShadowsProxy.deployed();
		xUSDContract = await Synth.at(await shadows.synths(xUSD));
		xEURContract = await Synth.at(await shadows.synths(xEUR));

		addressResolver = await AddressResolver.deployed();

		// Send a price update to guarantee we're not stale.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates([DOWS], ['0.1'].map(toUnit), timestamp, {
			from: oracle,
		});
	});

	it('should set constructor params on deployment', async () => {
		// address _proxy, TokenState _tokenState, address _shadowsProxy, address _feePoolProxy,
		// string _tokenName, string _tokenSymbol, address _owner, bytes32 _currencyKey, uint _totalSupply)
		const synth = await Synth.new(
			account1,
			account2,
			'Synth XYZ',
			'sXYZ',
			owner,
			toBytes32('sXYZ'),
			web3.utils.toWei('100'),
			addressResolver.address,
			{ from: deployerAccount }
		);

		assert.equal(await synth.proxy(), account1);
		assert.equal(await synth.tokenState(), account2);
		assert.equal(await synth.name(), 'Synth XYZ');
		assert.equal(await synth.symbol(), 'sXYZ');
		assert.bnEqual(await synth.decimals(), 18);
		assert.equal(await synth.owner(), owner);
		assert.equal(bytesToString(await synth.currencyKey()), 'sXYZ');
		assert.bnEqual(await synth.totalSupply(), toUnit('100'));
		assert.equal(await synth.resolver(), addressResolver.address);
	});

	describe('mutative functions and access', () => {
		it('ensure only known functions are mutative', () => {
			ensureOnlyExpectedMutativeFunctions({
				abi: xUSDContract.abi,
				ignoreParents: ['ExternStateToken', 'MixinResolver'],
				expected: [
					'issue',
					'burn',
					'setTotalSupply',
					'transfer',
					'transferAndSettle',
					'transferFrom',
					'transferFromAndSettle',
				],
			});
		});

		describe('when non-internal contract tries to issue', () => {
			it('then it fails', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: xUSDContract.issue,
					args: [account1, toUnit('1')],
					accounts,
					reason: 'Only Shadows, FeePool, Exchanger or Issuer contracts allowed',
				});
			});
		});
		describe('when non-internal tries to burn', () => {
			it('then it fails', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: xUSDContract.burn,
					args: [account1, toUnit('1')],
					accounts,
					reason: 'Only Shadows, FeePool, Exchanger or Issuer contracts allowed',
				});
			});
		});
	});

	it('should transfer (ERC20) without error', async () => {
		// Issue 10,000 xUSD.
		const amount = toUnit('10000');
		await shadows.issueSynths(amount, { from: owner });

		// Do a single transfer of all our xUSD.
		const transaction = await xUSDContract.methods['transfer(address,uint256)'](account1, amount, {
			from: owner,
		});

		// Events should be a fee exchange and a transfer to account1
		assert.eventEqual(
			transaction,
			// The original synth transfer
			'Transfer',
			{ from: owner, to: account1, value: amount }
		);

		// Sender should have nothing
		assert.bnEqual(await xUSDContract.balanceOf(owner), 0);

		// The recipient should have the correct amount
		assert.bnEqual(await xUSDContract.balanceOf(account1), amount);
	});

	it('should revert when transferring (ERC20) with insufficient balance', async () => {
		// Issue 10,000 xUSD.
		const amount = toUnit('10000');
		await shadows.issueSynths(amount, { from: owner });

		// Try to transfer 10,000 + 1 wei, which we don't have the balance for.
		await assert.revert(
			xUSDContract.methods['transfer(address,uint256)'](
				account1,
				amount.add(web3.utils.toBN('1')),
				{ from: owner }
			)
		);
	});

	it('should transferFrom (ERC20) without error', async () => {
		// Issue 10,000 xUSD.
		const amount = toUnit('10000');
		await shadows.issueSynths(amount, { from: owner });

		// Give account1 permission to act on our behalf
		await xUSDContract.approve(account1, amount, { from: owner });

		// Do a single transfer of all our xUSD.
		const transaction = await xUSDContract.transferFrom(owner, account1, amount, {
			from: account1,
		});

		// Events should be a transfer to account1
		assert.eventEqual(
			transaction,
			// The original synth transfer
			'Transfer',
			{ from: owner, to: account1, value: amount }
		);

		// Sender should have nothing
		assert.bnEqual(await xUSDContract.balanceOf(owner), 0);

		// The recipient should have the correct amount
		assert.bnEqual(await xUSDContract.balanceOf(account1), amount);

		// And allowance should be exhausted
		assert.bnEqual(await xUSDContract.allowance(owner, account1), 0);
	});

	it('should revert when calling transferFrom (ERC20) with insufficient allowance', async () => {
		// Issue 10,000 xUSD.
		const amount = toUnit('10000');
		await shadows.issueSynths(amount, { from: owner });

		// Approve for 1 wei less than amount
		await xUSDContract.approve(account1, amount.sub(web3.utils.toBN('1')), {
			from: owner,
		});

		// Try to transfer 10,000, which we don't have the allowance for.
		await assert.revert(
			xUSDContract.methods['transferFrom(address,address,uint256)'](owner, account1, amount, {
				from: account1,
			})
		);
	});

	it('should revert when calling transferFrom (ERC20) with insufficient balance', async () => {
		// Issue 10,000 - 1 wei xUSD.
		const amount = toUnit('10000');
		await shadows.issueSynths(amount.sub(web3.utils.toBN('1')), { from: owner });

		// Approve for full amount
		await xUSDContract.approve(account1, amount, { from: owner });

		// Try to transfer 10,000, which we don't have the balance for.
		await assert.revert(
			xUSDContract.methods['transferFrom(address,address,uint256)'](owner, account1, amount, {
				from: account1,
			})
		);
	});

	it('should issue successfully when called by Shadows', async () => {
		// Overwrite Shadows address to the owner to allow us to invoke issue on the Synth
		await addressResolver.importAddresses(['Shadows'].map(toBytes32), [owner], { from: owner });
		const transaction = await xUSDContract.issue(account1, toUnit('10000'), {
			from: owner,
		});
		assert.eventsEqual(
			transaction,
			'Transfer',
			{
				from: ZERO_ADDRESS,
				to: account1,
				value: toUnit('10000'),
			},
			'Issued',
			{
				account: account1,
				value: toUnit('10000'),
			}
		);
	});

	it('should burn successfully when called by Shadows', async () => {
		// Issue a bunch of synths so we can play with them.
		await shadows.issueSynths(toUnit('10000'), { from: owner });

		// In order to invoke burn as the owner, temporarily overwrite the Shadows address
		// in the resolver
		await addressResolver.importAddresses(['Shadows'].map(toBytes32), [owner], { from: owner });
		const transaction = await xUSDContract.burn(owner, toUnit('10000'), { from: owner });
		await addressResolver.importAddresses(['Shadows'].map(toBytes32), [shadows.address], {
			from: owner,
		});

		assert.eventsEqual(
			transaction,
			'Transfer',
			{ from: owner, to: ZERO_ADDRESS, value: toUnit('10000') },
			'Burned',
			{ account: owner, value: toUnit('10000') }
		);
	});

	it('should revert when burning more synths than exist', async () => {
		// Issue a bunch of synths so we can play with them.
		await shadows.issueSynths(toUnit('10000'), { from: owner });

		// Set the Shadows target of the ShadowsProxy to owner
		await shadowsProxy.setTarget(owner, { from: owner });

		// Burning 10000 + 1 wei should fail.
		await assert.revert(
			xUSDContract.burn(owner, toUnit('10000').add(web3.utils.toBN('1')), { from: owner })
		);
	});

	it('should transfer (ERC20) with no fee', async () => {
		// Issue 10,000 xUSD.
		const amount = toUnit('10000');

		await shadows.issueSynths(amount, { from: owner });

		// Do a single transfer of all our xUSD.
		const transaction = await xUSDContract.methods['transfer(address,uint256)'](account1, amount, {
			from: owner,
		});

		// Event should be only a transfer to account1
		assert.eventEqual(
			transaction,

			// The original synth transfer
			'Transfer',
			{ from: owner, to: account1, value: amount }
		);

		// Sender should have nothing
		assert.bnEqual(await xUSDContract.balanceOf(owner), 0);

		// The recipient should have the correct amount
		assert.bnEqual(await xUSDContract.balanceOf(account1), amount);

		// The fee pool should have zero balance
		assert.bnEqual(await xUSDContract.balanceOf(FEE_ADDRESS), 0);
	});

	describe('transfer / transferFrom And Settle', async () => {
		let exchanger;
		let amount;
		beforeEach(async () => {
			// set mock exchanger as exchanger
			exchanger = await MockExchanger.new(shadows.address);

			await addressResolver.importAddresses(['Exchanger'].map(toBytes32), [exchanger.address], {
				from: owner,
			});

			// Issue 1,000 xUSD.
			amount = toUnit('1000');

			await shadows.issueSynths(amount, { from: owner });
		});
		it('then transferableSynths should be the total amount', async () => {
			assert.bnEqual(await xUSDContract.transferableSynths(owner), toUnit('1000'));
		});
		describe('when reclaim amount is set to 10', async () => {
			const reclaimAmount = toUnit('10');
			beforeEach(async () => {
				await exchanger.setReclaim(reclaimAmount);
			});
			it('then transferableSynths should be the total amount minus the reclaim', async () => {
				assert.bnEqual(await xUSDContract.transferableSynths(owner), toUnit('990'));
			});
			it('should transfer all and settle 1000 xUSD less reclaim amount', async () => {
				// Do a single transfer of all our xUSD.
				await xUSDContract.transferAndSettle(account1, amount, {
					from: owner,
				});

				const expectedAmountTransferred = amount.sub(reclaimAmount);

				// Sender balance should be 0
				assert.bnEqual(await xUSDContract.balanceOf(owner), 0);

				// The recipient should have the correct amount minus reclaimed
				assert.bnEqual(await xUSDContract.balanceOf(account1), expectedAmountTransferred);
			});
			it('should transferFrom all and settle 1000 xUSD less reclaim amount', async () => {
				// Give account1 permission to act on our behalf
				await xUSDContract.approve(account1, amount, { from: owner });

				// Do a single transfer of all our xUSD.
				await xUSDContract.transferFromAndSettle(owner, account1, amount, {
					from: account1,
				});

				const expectedAmountTransferred = amount.sub(reclaimAmount);

				// Sender balance should be 0
				assert.bnEqual(await xUSDContract.balanceOf(owner), 0);

				// The recipient should have the correct amount minus reclaimed
				assert.bnEqual(await xUSDContract.balanceOf(account1), expectedAmountTransferred);
			});
			describe('when account has more balance than transfer amount + reclaim', async () => {
				it('should transfer 50 xUSD and burn 10 xUSD', async () => {
					const transferAmount = toUnit('50');
					// Do a single transfer of all our xUSD.
					await xUSDContract.transferAndSettle(account1, transferAmount, {
						from: owner,
					});

					const expectedAmountTransferred = transferAmount;

					// Sender balance should be balance - transfer - reclaimed
					assert.bnEqual(
						await xUSDContract.balanceOf(owner),
						amount.sub(transferAmount).sub(reclaimAmount)
					);

					// The recipient should have the correct amount
					assert.bnEqual(await xUSDContract.balanceOf(account1), expectedAmountTransferred);
				});
				it('should transferFrom 50 xUSD and settle reclaim amount', async () => {
					const transferAmount = toUnit('50');

					// Give account1 permission to act on our behalf
					await xUSDContract.approve(account1, transferAmount, { from: owner });

					// Do a single transferFrom of transferAmount.
					await xUSDContract.transferFromAndSettle(owner, account1, transferAmount, {
						from: account1,
					});

					const expectedAmountTransferred = transferAmount;

					// Sender balance should be balance - transfer - reclaimed
					assert.bnEqual(
						await xUSDContract.balanceOf(owner),
						amount.sub(transferAmount).sub(reclaimAmount)
					);

					// The recipient should have the correct amount
					assert.bnEqual(await xUSDContract.balanceOf(account1), expectedAmountTransferred);
				});
			});
		});
		describe('when synth balance after reclamation is less than requested transfer value', async () => {
			let balanceBefore;
			const reclaimAmount = toUnit('600');
			beforeEach(async () => {
				await exchanger.setReclaim(reclaimAmount);
				balanceBefore = await xUSDContract.balanceOf(owner);
			});
			describe('when reclaim 600 xUSD and transferring 500 xUSD synths', async () => {
				// original balance is 1000, reclaim 600 and should send 400
				const transferAmount = toUnit('500');

				it('then transferableSynths should be the total amount', async () => {
					assert.bnEqual(await xUSDContract.transferableSynths(owner), toUnit('400'));
				});

				it('should transfer remaining balance less reclaimed', async () => {
					// Do a single transfer of all our xUSD.
					await xUSDContract.transferAndSettle(account1, transferAmount, {
						from: owner,
					});

					// should transfer balanceAfter if less than value
					const balanceAfterReclaim = balanceBefore.sub(reclaimAmount);

					// Sender balance should be 0
					assert.bnEqual(await xUSDContract.balanceOf(owner), 0);

					// The recipient should have the correct amount
					assert.bnEqual(await xUSDContract.balanceOf(account1), balanceAfterReclaim);
				});
				it('should transferFrom and send balance minus reclaimed amount', async () => {
					// Give account1 permission to act on our behalf
					await xUSDContract.approve(account1, transferAmount, { from: owner });

					// Do a single transferFrom of transferAmount.
					await xUSDContract.transferFromAndSettle(owner, account1, transferAmount, {
						from: account1,
					});

					const balanceAfterReclaim = balanceBefore.sub(reclaimAmount);

					// Sender balance should be 0
					assert.bnEqual(await xUSDContract.balanceOf(owner), 0);

					// The recipient should have the correct amount
					assert.bnEqual(await xUSDContract.balanceOf(account1), balanceAfterReclaim);
				});
			});
		});
	});
	describe('when transferring synths to FEE_ADDRESS', async () => {
		let amount;
		beforeEach(async () => {
			// Issue 10,000 xUSD.
			amount = toUnit('10000');

			await shadows.issueSynths(amount, { from: owner });
		});
		it('should transfer to FEE_ADDRESS and recorded as fee', async () => {
			const feeBalanceBefore = await xUSDContract.balanceOf(FEE_ADDRESS);

			// Do a single transfer of all our xUSD.
			const transaction = await xUSDContract.transfer(FEE_ADDRESS, amount, {
				from: owner,
			});

			// Event should be only a transfer to FEE_ADDRESS
			assert.eventEqual(
				transaction,

				// The original synth transfer
				'Transfer',
				{ from: owner, to: FEE_ADDRESS, value: amount }
			);

			const firstFeePeriod = await feePool.recentFeePeriods(0);
			// FEE_ADDRESS balance of xUSD increased
			assert.bnEqual(await xUSDContract.balanceOf(FEE_ADDRESS), feeBalanceBefore.add(amount));

			// fees equal to amount are recorded in feesToDistribute
			assert.bnEqual(firstFeePeriod.feesToDistribute, feeBalanceBefore.add(amount));
		});
		it('should transfer to FEE_ADDRESS and exchange non-xUSD synths', async () => {
			// allocate the user some xEUR
			await issueSynthsToUser({ owner, user: owner, amount, synth: xEUR });

			// Get balanceOf FEE_ADDRESS
			const feeBalanceBefore = await xUSDContract.balanceOf(FEE_ADDRESS);

			// balance of xEUR after exchange fees
			const balanceOf = await xEURContract.balanceOf(owner);

			const amountInUSD = await exchangeRates.effectiveValue(xEUR, balanceOf, xUSD);

			// Do a single transfer of all xEUR to FEE_ADDRESS
			await xEURContract.transfer(FEE_ADDRESS, balanceOf, {
				from: owner,
			});

			const firstFeePeriod = await feePool.recentFeePeriods(0);

			// FEE_ADDRESS balance of xUSD increased by USD amount given from exchange
			assert.bnEqual(await xUSDContract.balanceOf(FEE_ADDRESS), feeBalanceBefore.add(amountInUSD));

			// fees equal to amountInUSD are recorded in feesToDistribute
			assert.bnEqual(firstFeePeriod.feesToDistribute, feeBalanceBefore.add(amountInUSD));
		});
	});
	describe('when transferring synths to ZERO_ADDRESS', async () => {
		let amount;
		beforeEach(async () => {
			// Issue 10,000 xUSD.
			amount = toUnit('1000');

			await shadows.issueSynths(amount, { from: owner });
		});
		it('should burn the synths and reduce totalSupply', async () => {
			const balanceBefore = await xUSDContract.balanceOf(owner);
			const totalSupplyBefore = await xUSDContract.totalSupply();

			// Do a single transfer of all our xUSD to ZERO_ADDRESS.
			const transaction = await xUSDContract.transfer(ZERO_ADDRESS, amount, {
				from: owner,
			});

			// Event should be only a transfer to ZERO_ADDRESS and burn
			assert.eventsEqual(
				transaction,
				'Transfer',
				{ from: owner, to: ZERO_ADDRESS, value: amount },
				'Burned',
				{ account: owner, value: amount }
			);

			// owner balance should be less amount burned
			assert.bnEqual(await xUSDContract.balanceOf(owner), balanceBefore.sub(amount));

			// total supply of synth reduced by amount
			assert.bnEqual(await xUSDContract.totalSupply(), totalSupplyBefore.sub(amount));
		});
	});
});
