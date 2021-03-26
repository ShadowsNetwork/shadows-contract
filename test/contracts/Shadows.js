require(".");
const Oracle = artifacts.require("Oracle");
const Shadows = artifacts.require("Shadows");
const FeePool = artifacts.require("FeePool");
const Exchanger = artifacts.require("Exchanger");
const SafeDecimalMath = artifacts.require("SafeDecimalMath");
const AddressResolver = artifacts.require("AddressResolver");
const Synth = artifacts.require("Synth");
const {
  toBytes32,
  toUnit,
  ZERO_ADDRESS,
  fastForward,
  currentTime,
  divideDecimal,
  multiplyDecimal,
} = require("../testUtils");

contract("Shadows", async (accounts) => {
  let shadows,
    oracle,
    feePool,
    exchanger,
    addressResolver,
    safeDecimalMath,
    timestamp;

  const [
    deployerAccount,
    owner,
    oracleAccount,
    account1,
    account2,
    account3,
  ] = accounts;

  const [xUSD, xAUD, xEUR, DOWS, xBTC, xETH] = [
    "xUSD",
    "xAUD",
    "xEUR",
    "DOWS",
    "xBTC",
    "xETH",
  ].map(toBytes32);

  const getRemainingIssuableSynths = async (account) =>
    (await shadows.remainingIssuableSynths(account))[0];

  before(async () => {
    safeDecimalMath = await SafeDecimalMath.new();
    await Shadows.link(safeDecimalMath);
    await Oracle.link(safeDecimalMath);
    await FeePool.link(safeDecimalMath);
    await Exchanger.link(safeDecimalMath);
  });

  beforeEach(async () => {
    timestamp = await currentTime();
    addressResolver = await AddressResolver.new();

    shadows = await Shadows.new();
    shadows.initialize(addressResolver.address, { from: owner });

    //oracle
    oracle = await Oracle.new();
    oracle.initialize(
      oracleAccount,
      [xAUD, xEUR, DOWS, xBTC],
      ["0.5", "1.25", "0.1", "5000"].map(toUnit),
      {
        from: oracleAccount,
      }
    );

    feePool = await FeePool.new();
    feePool.initialize(toUnit("0.0030"), addressResolver.address, {
      from: owner,
    });

    exchanger = await Exchanger.new();
    exchanger.initialize(addressResolver.address, { from: owner });

    await addressResolver.importAddresses(
      [
        toBytes32("Shadows"),
        toBytes32("Oracle"),
        toBytes32("FeePool"),
        toBytes32("Exchanger"),
      ],
      [shadows.address, oracle.address, feePool.address, exchanger.address]
    );

    //add xAUD
    const xAUDSynth = await Synth.new();
    await xAUDSynth.initialize(
      "Synth xAUD",
      "xAUD",
      xAUD,
      addressResolver.address,
      { from: owner }
    );
    await shadows.addSynth(xAUDSynth.address, { from: owner });

    //add xUSD
    const xUSDSynth = await Synth.new();
    await xUSDSynth.initialize(
      "Synth xUSD",
      "xUSD",
      xUSD,
      addressResolver.address,
      { from: owner }
    );
    await shadows.addSynth(xUSDSynth.address, { from: owner });

    //add xEUR
    const xEURSynth = await Synth.new();
    await xEURSynth.initialize(
      "Synth xEUR",
      "xEUR",
      xEUR,
      addressResolver.address,
      { from: owner }
    );
    await shadows.addSynth(xEURSynth.address, { from: owner });
  });

  describe("constructor", () => {
    it("should set params on initialize", async () => {
      assert.equal(await shadows.name(), "Shadows Network Token");
      assert.equal(await shadows.symbol(), "DOWS");
      assert.equal(await shadows.owner(), owner);
      assert.equal(await shadows.resolver(), addressResolver.address);
    });
  });

  describe("adding and removing synths", () => {
    it("should allow adding a Synth contract", async () => {
      const previousSynthCount = await shadows.availableSynthCount();
      const synth = await Synth.new();
      await synth.initialize(
        "Synth TEST1",
        "xTEST",
        toBytes32("xTEST"),
        addressResolver.address,
        { from: owner }
      );

      assert.bnEqual(await synth.owner(), owner);

      await shadows.addSynth(synth.address, { from: owner });

      // Assert that we've successfully added a Synth
      assert.bnEqual(
        await shadows.availableSynthCount(),
        previousSynthCount.add(web3.utils.toBN(1))
      );
      // Assert that it's at the end of the array
      assert.equal(
        await shadows.availableSynths(previousSynthCount),
        synth.address
      );
      // Assert that it's retrievable by its currencyKey
      assert.equal(await shadows.synths(toBytes32("xTEST")), synth.address);
    });

    it("should disallow adding a Synth contract when the user is not the owner", async () => {
      const synth = await Synth.new();
      await synth.initialize(
        "Synth TEST1",
        "xTEST",
        toBytes32("xTEST"),
        addressResolver.address,
        { from: owner }
      );

      await assert.revert(shadows.addSynth(synth.address, { from: account1 }));
    });

    it("should disallow double adding a Synth contract with the same address", async () => {
      const synth = await Synth.new();
      await synth.initialize(
        "Synth TEST1",
        "xTEST",
        toBytes32("xTEST"),
        addressResolver.address,
        { from: owner }
      );

      await shadows.addSynth(synth.address, { from: owner });
      await assert.revert(shadows.addSynth(synth.address, { from: owner }));
    });

    it("should disallow double adding a Synth contract with the same currencyKey", async () => {
      const synth = await Synth.new();
      await synth.initialize(
        "Synth TEST1",
        "xTEST",
        toBytes32("xTEST"),
        addressResolver.address,
        { from: owner }
      );

      const synth2 = await Synth.new();
      await synth2.initialize(
        "Synth TEST1",
        "xTEST",
        toBytes32("xTEST"),
        addressResolver.address,
        { from: owner }
      );

      await shadows.addSynth(synth.address, { from: owner });
      await assert.revert(shadows.addSynth(synth2.address, { from: owner }));
    });

    it("should allow removing a Synth contract when it has no issued balance", async () => {
      // without balances and we just remove one.
      const currencyKey = xAUD;
      const synthCount = await shadows.availableSynthCount();

      assert.notEqual(await shadows.synths(currencyKey), ZERO_ADDRESS);

      await shadows.removeSynth(currencyKey, { from: owner });

      // Assert that we have one less synth, and that the specific currency key is gone.
      assert.bnEqual(
        await shadows.availableSynthCount(),
        synthCount.sub(web3.utils.toBN(1))
      );
      assert.equal(await shadows.synths(currencyKey), ZERO_ADDRESS);
    });

    it("should disallow removing a Synth contract when it has an issued balance", async () => {
      // without balances
      const xAUDContractAddress = await shadows.synths(xAUD);

      // Assert that we can remove the synth and add it back in before we do anything.
      await shadows.removeSynth(xAUD, { from: owner });
      await shadows.addSynth(xAUDContractAddress, { from: owner });

      // Issue one sUSd
      await shadows.issueSynths(toUnit("1"), { from: owner });

      // exchange to xAUD
      await shadows.exchange(xUSD, toUnit("1"), xAUD, { from: owner });

      // Assert that we can't remove the synth now
      await assert.revert(shadows.removeSynth(xAUD, { from: owner }));
    });

    it("should disallow removing a Synth contract when requested by a non-owner", async () => {
      await assert.revert(shadows.removeSynth(xEUR, { from: account1 }));
    });

    it("should revert when requesting to remove a non-existent synth", async () => {
      const currencyKey = toBytes32("NOPE");
      await assert.revert(shadows.removeSynth(currencyKey, { from: owner }));
    });
  });

  describe("totalIssuedSynths()", () => {
    it("should correctly calculate the total issued synths in a single currency", async () => {
      // Two people issue 10 xUSD each. Assert that total issued value is 20 xUSD.

      // Send a price update to guarantee we're not depending on values from outside this test.

      await oracle.updateRates(
        [xAUD, xEUR, DOWS],
        ["0.5", "1.25", "0.1"].map(toUnit),
        timestamp,
        { from: oracleAccount }
      );

      // Give some DOWS to account1 and account2
      await shadows.transfer(account1, toUnit("1000"), { from: owner });
      await shadows.transfer(account2, toUnit("1000"), { from: owner });

      // Issue 10 xUSD each
      await shadows.issueSynths(toUnit("10"), { from: account1 });
      await shadows.issueSynths(toUnit("10"), { from: account2 });

      // Assert that there's 20 xUSD of value in the system
      assert.bnEqual(await shadows.totalIssuedSynths(xUSD), toUnit("20"));
    });

    it("should correctly calculate the total issued synths in multiple currencies", async () => {
      // Alice issues 10 xUSD. Bob issues 20 xAUD. Assert that total issued value is 20 xUSD, and 40 xAUD.

      // Send a price update to guarantee we're not depending on values from outside this test.

      await oracle.updateRates(
        [xAUD, xEUR, DOWS],
        ["0.5", "1.25", "0.1"].map(toUnit),
        timestamp,
        { from: oracleAccount }
      );

      // Give some DOWS to account1 and account2
      await shadows.transfer(account1, toUnit("1000"), { from: owner });
      await shadows.transfer(account2, toUnit("1000"), { from: owner });

      // Issue 10 xUSD each
      await shadows.issueSynths(toUnit("10"), { from: account1 });
      await shadows.issueSynths(toUnit("20"), { from: account2 });

      await shadows.exchange(xUSD, toUnit("20"), xAUD, { from: account2 });

      // Assert that there's 30 xUSD of value in the system
      assert.bnEqual(await shadows.totalIssuedSynths(xUSD), toUnit("30"));

      // And that there's 60 xAUD (minus fees) of value in the system
      assert.bnEqual(await shadows.totalIssuedSynths(xAUD), toUnit("60"));
    });

    it("should return the correct value for the different quantity of total issued synths", async () => {
      // Send a price update to guarantee we're not depending on values from outside this test.

      const rates = ["0.5", "1.25", "0.1"].map(toUnit);

      await oracle.updateRates([xAUD, xEUR, DOWS], rates, timestamp, {
        from: oracleAccount,
      });

      const aud2usdRate = await oracle.rateForCurrency(xAUD);
      // const eur2usdRate = await oracle.rateForCurrency(xEUR);

      // Give some DOWS to account1 and account2
      await shadows.transfer(account1, toUnit("100000"), {
        from: owner,
      });
      await shadows.transfer(account2, toUnit("100000"), {
        from: owner,
      });

      const issueAmountUSD = toUnit("100");
      const exchangeAmountToAUD = toUnit("95");
      const exchangeAmountToEUR = toUnit("5");

      // Issue
      await shadows.issueSynths(issueAmountUSD, { from: account1 });
      await shadows.issueSynths(issueAmountUSD, { from: account2 });

      // Exchange
      await shadows.exchange(xUSD, exchangeAmountToEUR, xEUR, {
        from: account1,
      });
      await shadows.exchange(xUSD, exchangeAmountToEUR, xEUR, {
        from: account2,
      });

      await shadows.exchange(xUSD, exchangeAmountToAUD, xAUD, {
        from: account1,
      });
      await shadows.exchange(xUSD, exchangeAmountToAUD, xAUD, {
        from: account2,
      });

      const totalIssuedAUD = await shadows.totalIssuedSynths(xAUD);

      assert.bnClose(totalIssuedAUD, divideDecimal(toUnit("200"), aud2usdRate));
    });

    it("should not allow checking total issued synths when a rate other than the priced currency is stale", async () => {
      await fastForward(
        (await oracle.rateStalePeriod()).add(web3.utils.toBN("300"))
      );

      await oracle.updateRates(
        [DOWS, xAUD],
        ["0.1", "0.78"].map(toUnit),
        timestamp,
        {
          from: oracleAccount,
        }
      );
      await assert.revert(shadows.totalIssuedSynths(xAUD));
    });

    it("should not allow checking total issued synths when the priced currency is stale", async () => {
      await fastForward(
        (await oracle.rateStalePeriod()).add(web3.utils.toBN("300"))
      );

      await oracle.updateRates(
        [DOWS, xEUR],
        ["0.1", "1.25"].map(toUnit),
        timestamp,
        {
          from: oracleAccount,
        }
      );
      await assert.revert(shadows.totalIssuedSynths(xAUD));
    });
  });

  describe("transfer()", () => {
    it("should transfer using the ERC20 transfer function", async () => {
      // Ensure our environment is set up correctly for our assumptions
      // e.g. owner owns all DOWS.

      assert.bnEqual(
        await shadows.totalSupply(),
        await shadows.balanceOf(owner)
      );

      const transaction = await shadows.transfer(account1, toUnit("10"), {
        from: owner,
      });
      assert.eventEqual(transaction, "Transfer", {
        from: owner,
        to: account1,
        value: toUnit("10"),
      });

      assert.bnEqual(await shadows.balanceOf(account1), toUnit("10"));
    });

    it("should revert when exceeding locked shadows and calling the ERC20 transfer function", async () => {
      // Ensure our environment is set up correctly for our assumptions
      // e.g. owner owns all DOWS.
      assert.bnEqual(
        await shadows.totalSupply(),
        await shadows.balanceOf(owner)
      );

      // Issue max synths.
      await shadows.issueMaxSynths(owner);

      // Try to transfer 0.000000000000000001 DOWS
      await assert.revert(shadows.transfer(account1, "1", { from: owner }));
    });

    it("should transfer using the ERC20 transferFrom function", async () => {
      // Ensure our environment is set up correctly for our assumptions
      // e.g. owner owns all DOWS.
      const previousOwnerBalance = await shadows.balanceOf(owner);
      assert.bnEqual(await shadows.totalSupply(), previousOwnerBalance);

      // Approve account1 to act on our behalf for 10 DOWS.
      let transaction = await shadows.approve(account1, toUnit("10"), {
        from: owner,
      });
      assert.eventEqual(transaction, "Approval", {
        owner: owner,
        spender: account1,
        value: toUnit("10"),
      });

      // Assert that transferFrom works.
      transaction = await shadows.transferFrom(owner, account2, toUnit("10"), {
        from: account1,
      });
      assert.eventEqual(transaction, "Transfer", {
        from: owner,
        to: account2,
        value: toUnit("10"),
      });

      // Assert that account2 has 10 DOWS and owner has 10 less DOWS
      assert.bnEqual(await shadows.balanceOf(account2), toUnit("10"));
      assert.bnEqual(
        await shadows.balanceOf(owner),
        previousOwnerBalance.sub(toUnit("10"))
      );

      // Assert that we can't transfer more even though there's a balance for owner.
      await assert.revert(
        shadows.transferFrom(owner, account2, "1", {
          from: account1,
        })
      );
    });

    it("should revert when exceeding locked shadows and calling the ERC20 transferFrom function", async () => {
      // Ensure our environment is set up correctly for our assumptions
      // e.g. owner owns all DOWS.
      assert.bnEqual(
        await shadows.totalSupply(),
        await shadows.balanceOf(owner)
      );

      // Send a price update to guarantee we're not depending on values from outside this test.

      await oracle.updateRates(
        [xAUD, xEUR, DOWS],
        ["0.5", "1.25", "0.1"].map(toUnit),
        timestamp,
        { from: oracleAccount }
      );

      // Approve account1 to act on our behalf for 10 DOWS.
      const transaction = await shadows.approve(account1, toUnit("10"), {
        from: owner,
      });
      assert.eventEqual(transaction, "Approval", {
        owner: owner,
        spender: account1,
        value: toUnit("10"),
      });

      // Issue max synths
      await shadows.issueMaxSynths(owner);

      // Assert that transferFrom fails even for the smallest amount of DOWS.
      await assert.revert(
        shadows.transferFrom(owner, account2, "1", {
          from: account1,
        })
      );
    });

    it("should not allow transfer if the exchange rate for shadows is stale", async () => {
      // Give some DOWS to account1 & account2
      const value = toUnit("300");
      await shadows.transfer(account1, toUnit("10000"), {
        from: owner,
      });
      await shadows.transfer(account2, toUnit("10000"), {
        from: owner,
      });

      // Ensure that we can do a successful transfer before rates go stale
      await shadows.transfer(account2, value, { from: account1 });

      await shadows.approve(account3, value, { from: account2 });
      await shadows.transferFrom(account2, account1, value, {
        from: account3,
      });

      // Now jump forward in time so the rates are stale
      await fastForward((await oracle.rateStalePeriod()) + 1);

      // Send a price update to guarantee we're not depending on values from outside this test.

      await oracle.updateRates(
        [xAUD, xEUR],
        ["0.5", "1.25"].map(toUnit),
        timestamp,
        {
          from: oracleAccount,
        }
      );

      // Subsequent transfers fail
      await assert.revert(
        shadows.transfer(account2, value, { from: account1 })
      );

      await shadows.approve(account3, value, { from: account2 });
      await assert.revert(
        shadows.transferFrom(account2, account1, value, {
          from: account3,
        })
      );
    });

    it("should not be possible to transfer locked shadows", async () => {
      const issuedShadows = web3.utils.toBN("200000");
      await shadows.transfer(account1, toUnit(issuedShadows), {
        from: owner,
      });

      // Issue
      const amountIssued = toUnit("2000");
      await shadows.issueSynths(amountIssued, { from: account1 });

      await assert.revert(
        shadows.transfer(account2, toUnit(issuedShadows), {
          from: account1,
        })
      );
    });

    it("should lock newly received shadows if the user's collaterisation is too high", async () => {
      // Set xEUR for purposes of this test
      const timestamp1 = await currentTime();
      await oracle.updateRates([xEUR], [toUnit("0.75")], timestamp1, {
        from: oracleAccount,
      });

      const issuedShadows = web3.utils.toBN("200000");
      await shadows.transfer(account1, toUnit(issuedShadows), {
        from: owner,
      });
      await shadows.transfer(account2, toUnit(issuedShadows), {
        from: owner,
      });

      const maxIssuableSynths = await shadows.maxIssuableSynths(account1);

      // Issue
      await shadows.issueSynths(maxIssuableSynths, { from: account1 });

      // Exchange into xEUR
      await shadows.exchange(xUSD, maxIssuableSynths, xEUR, { from: account1 });

      // Ensure that we can transfer in and out of the account successfully
      await shadows.transfer(account1, toUnit("10000"), {
        from: account2,
      });
      await shadows.transfer(account2, toUnit("10000"), {
        from: account1,
      });

      // Increase the value of xEUR relative to shadows
      const timestamp2 = await currentTime();
      await oracle.updateRates([xEUR], [toUnit("2.10")], timestamp2, {
        from: oracleAccount,
      });

      // Ensure that the new shadows account1 receives cannot be transferred out.
      await shadows.transfer(account1, toUnit("10000"), {
        from: account2,
      });
      await assert.revert(
        shadows.transfer(account2, toUnit("10000"), { from: account1 })
      );
    });

    it("should unlock shadows when collaterisation ratio changes", async () => {
      // Set xAUD for purposes of this test
      const timestamp1 = await currentTime();
      const aud2usdrate = toUnit("2");

      await oracle.updateRates([xAUD], [aud2usdrate], timestamp1, {
        from: oracleAccount,
      });

      const issuedShadows = web3.utils.toBN("200000");
      await shadows.transfer(account1, toUnit(issuedShadows), {
        from: owner,
      });

      // Issue
      const issuedSynths = await shadows.maxIssuableSynths(account1);
      await shadows.issueSynths(issuedSynths, { from: account1 });
      const remainingIssuable = await getRemainingIssuableSynths(account1);
      assert.bnClose(remainingIssuable, "0");

      const transferable1 = await shadows.transferableShadows(account1);
      assert.bnEqual(transferable1, "0");

      // Exchange into xAUD
      await shadows.exchange(xUSD, issuedSynths, xAUD, { from: account1 });

      // Increase the value of xAUD relative to shadows
      const timestamp2 = await currentTime();
      const newAUDExchangeRate = toUnit("1");
      await oracle.updateRates([xAUD], [newAUDExchangeRate], timestamp2, {
        from: oracleAccount,
      });

      const transferable2 = await shadows.transferableShadows(account1);
      assert.equal(transferable2.gt(toUnit("1000")), true);
    });
  });

  describe("debtBalance()", () => {
    it("should not change debt balance % if exchange rates change", async () => {
      let newAUDRate = toUnit("0.5");
      let timestamp = await currentTime();
      await oracle.updateRates([xAUD], [newAUDRate], timestamp, {
        from: oracleAccount,
      });

      await shadows.transfer(account1, toUnit("20000"), {
        from: owner,
      });
      await shadows.transfer(account2, toUnit("20000"), {
        from: owner,
      });

      const amountIssuedAcc1 = toUnit("30");
      const amountIssuedAcc2 = toUnit("50");
      await shadows.issueSynths(amountIssuedAcc1, { from: account1 });
      await shadows.issueSynths(amountIssuedAcc2, { from: account2 });
      await shadows.exchange(xUSD, amountIssuedAcc2, xAUD, { from: account2 });

      const PRECISE_UNIT = web3.utils.toWei(web3.utils.toBN("1"), "gether");
      let totalIssuedSynthxUSD = await shadows.totalIssuedSynths(xUSD);
      const account1DebtRatio = divideDecimal(
        amountIssuedAcc1,
        totalIssuedSynthxUSD,
        PRECISE_UNIT
      );
      const account2DebtRatio = divideDecimal(
        amountIssuedAcc2,
        totalIssuedSynthxUSD,
        PRECISE_UNIT
      );

      timestamp = await currentTime();
      newAUDRate = toUnit("1.85");
      await oracle.updateRates([xAUD], [newAUDRate], timestamp, {
        from: oracleAccount,
      });

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

      assert.bnClose(
        await shadows.debtBalanceOf(account1, xUSD),
        expectedDebtAccount1
      );
      assert.bnClose(
        await shadows.debtBalanceOf(account2, xUSD),
        expectedDebtAccount2
      );
    });

    it("should correctly calculate a user's debt balance without prior issuance", async () => {
      await shadows.transfer(account1, toUnit("200000"), {
        from: owner,
      });
      await shadows.transfer(account2, toUnit("10000"), {
        from: owner,
      });

      const debt1 = await shadows.debtBalanceOf(account1, toBytes32("xUSD"));
      const debt2 = await shadows.debtBalanceOf(account2, toBytes32("xUSD"));
      assert.bnEqual(debt1, 0);
      assert.bnEqual(debt2, 0);
    });

    it("should correctly calculate a user's debt balance with prior issuance", async () => {
      // Give some DOWS to account1
      await shadows.transfer(account1, toUnit("200000"), {
        from: owner,
      });

      // Issue
      const issuedSynths = toUnit("1001");
      await shadows.issueSynths(issuedSynths, { from: account1 });

      const debt = await shadows.debtBalanceOf(account1, toBytes32("xUSD"));
      assert.bnEqual(debt, issuedSynths);
    });
  });

  describe('maxIssuableSynths()', () => {
		it("should correctly calculate a user's maximum issuable synths without prior issuance", async () => {
			const rate = await oracle.rateForCurrency(toBytes32('DOWS'));
			const issuedShadows = web3.utils.toBN('200000');
			await shadows.transfer(account1, toUnit(issuedShadows), {
				from: owner,
			});
			const issuanceRatio = await shadows.issuanceRatio();

			const expectedIssuableSynths = multiplyDecimal(
				toUnit(issuedShadows),
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
			const dows2usdRate = await oracle.rateForCurrency(DOWS);

			const issuedShadows = web3.utils.toBN('320001');
			await shadows.transfer(account1, toUnit(issuedShadows), {
				from: owner,
			});

			const issuanceRatio = await shadows.issuanceRatio();
			const amountIssued = web3.utils.toBN('1234');
			await shadows.issueSynths(toUnit(amountIssued), { from: account1 });

			const expectedIssuableSynths = multiplyDecimal(
				toUnit(issuedShadows),
				multiplyDecimal(dows2usdRate, issuanceRatio)
			);

			const maxIssuableSynths = await shadows.maxIssuableSynths(account1);
			assert.bnEqual(expectedIssuableSynths, maxIssuableSynths);
		});

		it('should error when calculating maximum issuance when the DOWS rate is stale', async () => {
			// Add stale period to the time to ensure we go stale.
			await fastForward((await oracle.rateStalePeriod()) + 1);

			await oracle.updateRates([xAUD, xEUR], ['0.5', '1.25'].map(toUnit), timestamp, {
				from: oracleAccount,
			});

			await assert.revert(shadows.maxIssuableSynths(account1));
		});

		it('should error when calculating maximum issuance when the currency rate is stale', async () => {
			// Add stale period to the time to ensure we go stale.
			await fastForward((await oracle.rateStalePeriod()) + 1);

			await oracle.updateRates([xEUR, DOWS], ['1.25', '0.12'].map(toUnit), timestamp, {
				from: oracleAccount,
			});

			await assert.revert(shadows.maxIssuableSynths(account1));
		});
	});

  describe('remainingIssuableSynths()', () => {
		it("should correctly calculate a user's remaining issuable synths with prior issuance", async () => {
			const dows2usdRate = await oracle.rateForCurrency(DOWS);
			const issuanceRatio = await shadows.issuanceRatio();

			const issuedShadows = web3.utils.toBN('200012');
			await shadows.transfer(account1, toUnit(issuedShadows), {
				from: owner,
			});

			// Issue
			const amountIssued = toUnit('2011');
			await shadows.issueSynths(amountIssued, { from: account1 });

			const expectedIssuableSynths = multiplyDecimal(
				toUnit(issuedShadows),
				multiplyDecimal(dows2usdRate, issuanceRatio)
			).sub(amountIssued);

			const remainingIssuable = await getRemainingIssuableSynths(account1);
			assert.bnEqual(remainingIssuable, expectedIssuableSynths);
		});

		it("should correctly calculate a user's remaining issuable synths without prior issuance", async () => {
			const dows2usdRate = await oracle.rateForCurrency(DOWS);
			const issuanceRatio = await shadows.issuanceRatio();

			const issuedShadows = web3.utils.toBN('20');
			await shadows.transfer(account1, toUnit(issuedShadows), {
				from: owner,
			});

			const expectedIssuableSynths = multiplyDecimal(
				toUnit(issuedShadows),
				multiplyDecimal(dows2usdRate, issuanceRatio)
			);

			const remainingIssuable = await getRemainingIssuableSynths(account1);
			assert.bnEqual(remainingIssuable, expectedIssuableSynths);
		});
	});

});
