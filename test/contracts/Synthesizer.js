require(".");
const Oracle = artifacts.require("Oracle");
const Shadows = artifacts.require("Shadows");
const Synthesizer = artifacts.require("Synthesizer");
const FeePool = artifacts.require("FeePool");
const Exchanger = artifacts.require("Exchanger");
const SafeDecimalMath = artifacts.require("SafeDecimalMath");
const AddressResolver = artifacts.require("AddressResolver");
const RewardEscrow = artifacts.require("RewardEscrow");
const Synth = artifacts.require("Synth");
const {
  toBytes32,
  toUnit,
  ZERO_ADDRESS,
  fastForward,
  currentTime,
  divideDecimal,
  multiplyDecimal,
  onlyGivenAddressCanInvoke,
} = require("../../utils");

contract("Synthesizer", async (accounts) => {
  let shadows,
    oracle,
    feePool,
    exchanger,
    addressResolver,
    rewardEscrow,
    safeDecimalMath,
    xUSDContract,
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
    (await synthesizer.remainingIssuableSynths(account))[0];
  
  before(async () => {
    safeDecimalMath = await SafeDecimalMath.new();
    await Synthesizer.link(safeDecimalMath);
    await Oracle.link(safeDecimalMath);
    await FeePool.link(safeDecimalMath);
    await Exchanger.link(safeDecimalMath);
  });

  beforeEach(async () => {
    timestamp = await currentTime();
    addressResolver = await AddressResolver.new();

    synthesizer = await Synthesizer.new();
    await synthesizer.initialize(addressResolver.address, { from: owner });
    await synthesizer.setIssuanceRatio('200000000000000000', { from: owner });

    shadows = await Shadows.new();
    await shadows.initialize({ from: owner });
    await shadows.setSynthesizer(synthesizer.address, { from: owner });

    //oracle
    oracle = await Oracle.new();
    await oracle.initialize(
      oracleAccount,
      [xAUD, xEUR, DOWS, xBTC],
      ["0.5", "1.25", "0.1", "5000"].map(toUnit),
      {
        from: oracleAccount,
      }
    );

    feePool = await FeePool.new();
    await feePool.initialize(toUnit("0.0030"), addressResolver.address, {
      from: owner,
    });

    exchanger = await Exchanger.new();
    await exchanger.initialize(addressResolver.address, { from: owner });

    rewardEscrow = await RewardEscrow.new();
    await rewardEscrow.initialize(addressResolver.address, { from: owner });

    await addressResolver.importAddresses(
      [
        toBytes32("Shadows"),
        toBytes32("Oracle"),
        toBytes32("FeePool"),
        toBytes32("Exchanger"),
        toBytes32("RewardEscrow"),
        toBytes32("Synthesizer"),
      ],
      [
        shadows.address,
        oracle.address,
        feePool.address,
        exchanger.address,
        rewardEscrow.address,
        synthesizer.address,
      ]
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
    await synthesizer.addSynth(xAUDSynth.address, { from: owner });

    //add xUSD
    const xUSDSynth = await Synth.new();
    await xUSDSynth.initialize(
      "Synth xUSD",
      "xUSD",
      xUSD,
      addressResolver.address,
      { from: owner }
    );
    await synthesizer.addSynth(xUSDSynth.address, { from: owner });
    xUSDContract = await Synth.at(await synthesizer.synths(xUSD));

    //add xEUR
    const xEURSynth = await Synth.new();
    await xEURSynth.initialize(
      "Synth xEUR",
      "xEUR",
      xEUR,
      addressResolver.address,
      { from: owner }
    );
    await synthesizer.addSynth(xEURSynth.address, { from: owner });
  });

  describe("constructor", () => {
    it("should set params on initialize", async () => {
      assert.equal(await synthesizer.owner(), owner);
      assert.equal(await synthesizer.resolver(), addressResolver.address);
    });
  });

  describe("adding and removing synths", () => {
    it("should allow adding a Synth contract", async () => {
      const previousSynthCount = await synthesizer.availableSynthCount();
      const synth = await Synth.new();
      await synth.initialize(
        "Synth TEST1",
        "xTEST",
        toBytes32("xTEST"),
        addressResolver.address,
        { from: owner }
      );

      assert.bnEqual(await synth.owner(), owner);

      await synthesizer.addSynth(synth.address, { from: owner });

      // Assert that we've successfully added a Synth
      assert.bnEqual(
        await synthesizer.availableSynthCount(),
        previousSynthCount.add(web3.utils.toBN(1))
      );
      // Assert that it's at the end of the array
      assert.equal(
        await synthesizer.availableSynths(previousSynthCount),
        synth.address
      );
      // Assert that it's retrievable by its currencyKey
      assert.equal(await synthesizer.synths(toBytes32("xTEST")), synth.address);
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

      await assert.revert(
        synthesizer.addSynth(synth.address, { from: account1 })
      );
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

      await synthesizer.addSynth(synth.address, { from: owner });
      await assert.revert(synthesizer.addSynth(synth.address, { from: owner }));
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

      await synthesizer.addSynth(synth.address, { from: owner });
      await assert.revert(
        synthesizer.addSynth(synth2.address, { from: owner })
      );
    });

    it("should allow removing a Synth contract when it has no issued balance", async () => {
      // without balances and we just remove one.
      const currencyKey = xAUD;
      const synthCount = await synthesizer.availableSynthCount();

      assert.notEqual(await synthesizer.synths(currencyKey), ZERO_ADDRESS);

      await synthesizer.removeSynth(currencyKey, { from: owner });

      // Assert that we have one less synth, and that the specific currency key is gone.
      assert.bnEqual(
        await synthesizer.availableSynthCount(),
        synthCount.sub(web3.utils.toBN(1))
      );
      assert.equal(await synthesizer.synths(currencyKey), ZERO_ADDRESS);
    });

    it("should disallow removing a Synth contract when it has an issued balance", async () => {
      // without balances
      const xAUDContractAddress = await synthesizer.synths(xAUD);

      // Assert that we can remove the synth and add it back in before we do anything.
      await synthesizer.removeSynth(xAUD, { from: owner });
      await synthesizer.addSynth(xAUDContractAddress, { from: owner });

      // Issue one sUSd
      await synthesizer.issueSynths(toUnit("1"), { from: owner });

      // exchange to xAUD
      await synthesizer.exchange(xUSD, toUnit("1"), xAUD, { from: owner });

      // Assert that we can't remove the synth now
      await assert.revert(synthesizer.removeSynth(xAUD, { from: owner }));
    });

    it("should disallow removing a Synth contract when requested by a non-owner", async () => {
      await assert.revert(synthesizer.removeSynth(xEUR, { from: account1 }));
    });

    it("should revert when requesting to remove a non-existent synth", async () => {
      const currencyKey = toBytes32("NOPE");
      await assert.revert(
        synthesizer.removeSynth(currencyKey, { from: owner })
      );
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
      await synthesizer.issueSynths(toUnit("10"), { from: account1 });
      await synthesizer.issueSynths(toUnit("10"), { from: account2 });

      // Assert that there's 20 xUSD of value in the system
      assert.bnEqual(await synthesizer.totalIssuedSynths(xUSD), toUnit("20"));
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
      await synthesizer.issueSynths(toUnit("10"), { from: account1 });
      await synthesizer.issueSynths(toUnit("20"), { from: account2 });

      await synthesizer.exchange(xUSD, toUnit("20"), xAUD, { from: account2 });

      // Assert that there's 30 xUSD of value in the system
      assert.bnEqual(await synthesizer.totalIssuedSynths(xUSD), toUnit("30"));

      // And that there's 60 xAUD (minus fees) of value in the system
      assert.bnEqual(await synthesizer.totalIssuedSynths(xAUD), toUnit("60"));
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
      await synthesizer.issueSynths(issueAmountUSD, { from: account1 });
      await synthesizer.issueSynths(issueAmountUSD, { from: account2 });

      // Exchange
      await synthesizer.exchange(xUSD, exchangeAmountToEUR, xEUR, {
        from: account1,
      });
      await synthesizer.exchange(xUSD, exchangeAmountToEUR, xEUR, {
        from: account2,
      });

      await synthesizer.exchange(xUSD, exchangeAmountToAUD, xAUD, {
        from: account1,
      });
      await synthesizer.exchange(xUSD, exchangeAmountToAUD, xAUD, {
        from: account2,
      });

      const totalIssuedAUD = await synthesizer.totalIssuedSynths(xAUD);

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
      await assert.revert(synthesizer.totalIssuedSynths(xAUD));
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
      await assert.revert(synthesizer.totalIssuedSynths(xAUD));
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
      await synthesizer.issueMaxSynths({ from: owner });

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
      await synthesizer.issueMaxSynths({ from: owner });

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
      await synthesizer.issueSynths(amountIssued, { from: account1 });

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

      const maxIssuableSynths = await synthesizer.maxIssuableSynths(account1);

      // Issue
      await synthesizer.issueSynths(maxIssuableSynths, { from: account1 });

      // Exchange into xEUR
      await synthesizer.exchange(xUSD, maxIssuableSynths, xEUR, {
        from: account1,
      });

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
      const issuedSynths = await synthesizer.maxIssuableSynths(account1);
      await synthesizer.issueSynths(issuedSynths, { from: account1 });
      const remainingIssuable = await getRemainingIssuableSynths(account1);
      assert.bnClose(remainingIssuable, "0");

      const transferable1 = await synthesizer.transferableShadows(account1);
      assert.bnEqual(transferable1, "0");

      // Exchange into xAUD
      await synthesizer.exchange(xUSD, issuedSynths, xAUD, { from: account1 });

      // Increase the value of xAUD relative to synthesizer
      const timestamp2 = await currentTime();
      const newAUDExchangeRate = toUnit("1");
      await oracle.updateRates([xAUD], [newAUDExchangeRate], timestamp2, {
        from: oracleAccount,
      });

      const transferable2 = await synthesizer.transferableShadows(account1);
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
      await synthesizer.issueSynths(amountIssuedAcc1, { from: account1 });
      await synthesizer.issueSynths(amountIssuedAcc2, { from: account2 });
      await synthesizer.exchange(xUSD, amountIssuedAcc2, xAUD, {
        from: account2,
      });

      const PRECISE_UNIT = web3.utils.toWei(web3.utils.toBN("1"), "gether");
      let totalIssuedSynthxUSD = await synthesizer.totalIssuedSynths(xUSD);
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

      totalIssuedSynthxUSD = await synthesizer.totalIssuedSynths(xUSD);
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
        await synthesizer.debtBalanceOf(account1, xUSD),
        expectedDebtAccount1
      );
      assert.bnClose(
        await synthesizer.debtBalanceOf(account2, xUSD),
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

      const debt1 = await synthesizer.debtBalanceOf(
        account1,
        toBytes32("xUSD")
      );
      const debt2 = await synthesizer.debtBalanceOf(
        account2,
        toBytes32("xUSD")
      );
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
      await synthesizer.issueSynths(issuedSynths, { from: account1 });

      const debt = await synthesizer.debtBalanceOf(account1, toBytes32("xUSD"));
      assert.bnEqual(debt, issuedSynths);
    });
  });

  describe("maxIssuableSynths()", () => {
    it("should correctly calculate a user's maximum issuable synths without prior issuance", async () => {
      const rate = await oracle.rateForCurrency(toBytes32("DOWS"));
      const issuedShadows = web3.utils.toBN("200000");
      await shadows.transfer(account1, toUnit(issuedShadows), {
        from: owner,
      });
      const issuanceRatio = await synthesizer.issuanceRatio();

      const expectedIssuableSynths = multiplyDecimal(
        toUnit(issuedShadows),
        multiplyDecimal(rate, issuanceRatio)
      );
      const maxIssuableSynths = await synthesizer.maxIssuableSynths(account1);

      assert.bnEqual(expectedIssuableSynths, maxIssuableSynths);
    });

    it("should correctly calculate a user's maximum issuable synths without any DOWS", async () => {
      const maxIssuableSynths = await synthesizer.maxIssuableSynths(account1);
      assert.bnEqual(0, maxIssuableSynths);
    });

    it("should correctly calculate a user's maximum issuable synths with prior issuance", async () => {
      const dows2usdRate = await oracle.rateForCurrency(DOWS);

      const issuedShadows = web3.utils.toBN("320001");
      await shadows.transfer(account1, toUnit(issuedShadows), {
        from: owner,
      });

      const issuanceRatio = await synthesizer.issuanceRatio();
      const amountIssued = web3.utils.toBN("1234");
      await synthesizer.issueSynths(toUnit(amountIssued), { from: account1 });

      const expectedIssuableSynths = multiplyDecimal(
        toUnit(issuedShadows),
        multiplyDecimal(dows2usdRate, issuanceRatio)
      );

      const maxIssuableSynths = await synthesizer.maxIssuableSynths(account1);
      assert.bnEqual(expectedIssuableSynths, maxIssuableSynths);
    });

    it("should error when calculating maximum issuance when the DOWS rate is stale", async () => {
      // Add stale period to the time to ensure we go stale.
      await fastForward((await oracle.rateStalePeriod()) + 1);

      await oracle.updateRates(
        [xAUD, xEUR],
        ["0.5", "1.25"].map(toUnit),
        timestamp,
        {
          from: oracleAccount,
        }
      );

      await assert.revert(synthesizer.maxIssuableSynths(account1));
    });

    it("should error when calculating maximum issuance when the currency rate is stale", async () => {
      // Add stale period to the time to ensure we go stale.
      await fastForward((await oracle.rateStalePeriod()) + 1);

      await oracle.updateRates(
        [xEUR, DOWS],
        ["1.25", "0.12"].map(toUnit),
        timestamp,
        {
          from: oracleAccount,
        }
      );

      await assert.revert(synthesizer.maxIssuableSynths(account1));
    });
  });

  describe("remainingIssuableSynths()", () => {
    it("should correctly calculate a user's remaining issuable synths with prior issuance", async () => {
      const dows2usdRate = await oracle.rateForCurrency(DOWS);
      const issuanceRatio = await synthesizer.issuanceRatio();

      const issuedShadows = web3.utils.toBN("200012");
      await shadows.transfer(account1, toUnit(issuedShadows), {
        from: owner,
      });

      // Issue
      const amountIssued = toUnit("2011");
      await synthesizer.issueSynths(amountIssued, { from: account1 });

      const expectedIssuableSynths = multiplyDecimal(
        toUnit(issuedShadows),
        multiplyDecimal(dows2usdRate, issuanceRatio)
      ).sub(amountIssued);

      const remainingIssuable = await getRemainingIssuableSynths(account1);
      assert.bnEqual(remainingIssuable, expectedIssuableSynths);
    });

    it("should correctly calculate a user's remaining issuable synths without prior issuance", async () => {
      const dows2usdRate = await oracle.rateForCurrency(DOWS);
      const issuanceRatio = await synthesizer.issuanceRatio();

      const issuedShadows = web3.utils.toBN("20");
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

  it("should allow the owner to set the issuance ratio", async () => {
    const ratio = toUnit("0.2");

    const transaction = await synthesizer.setIssuanceRatio(ratio, {
      from: owner,
    });

    assert.eventEqual(transaction, "IssuanceRatioUpdated", { newRatio: ratio });
  });

  it("should disallow a non-owner from setting the issuance ratio", async () => {
    const ratio = toUnit("0.2");

    await assert.revert(
      synthesizer.setIssuanceRatio(ratio, {
        from: account1,
      })
    );
  });

  it("should disallow setting the issuance ratio above the MAX ratio", async () => {
    const max = toUnit("1");

    // It should succeed when setting it to max
    const transaction = await synthesizer.setIssuanceRatio(max, {
      from: owner,
    });
    assert.eventEqual(transaction, "IssuanceRatioUpdated", { newRatio: max });

    // But max + 1 should fail
    await assert.revert(
      synthesizer.setIssuanceRatio(
        web3.utils.toBN(max).add(web3.utils.toBN("1")),
        {
          from: account1,
        }
      )
    );
  });

  it("should correctly report hasIssued for an address", async () => {
    assert.equal(await synthesizer.hasIssued(owner), false);

    await synthesizer.issueMaxSynths({ from: owner });
    const synthBalance = await xUSDContract.balanceOf(owner);

    assert.equal(await synthesizer.hasIssued(owner), true);

    await synthesizer.burnSynths(synthBalance, { from: owner });

    assert.equal(await synthesizer.hasIssued(owner), false);
  });

  it("should allow the issuance of a small amount of synths", async () => {
    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("1000"), { from: owner });

    // account1 should be able to issue
    // Note: If a too small amount of synths are issued here, the amount may be
    // rounded to 0 in the debt register. This will revert. As such, there is a minimum
    // number of synths that need to be issued each time issue is invoked. The exact
    // amount depends on the Synth exchange rate and the total supply.
    await synthesizer.issueSynths(web3.utils.toBN("5"), { from: account1 });
  });

  it("should be possible to issue the maximum amount of synths via issueSynths", async () => {
    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("1000"), { from: owner });

    const maxSynths = await synthesizer.maxIssuableSynths(account1);

    // account1 should be able to issue
    await synthesizer.issueSynths(maxSynths, { from: account1 });
  });

  it("should allow an issuer to issue synths in one flavour", async () => {
    await oracle.updateRates(
      [xAUD, xEUR, DOWS],
      ["0.5", "1.25", "0.1"].map(toUnit),
      timestamp,
      { from: oracleAccount }
    );

    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("1000"), { from: owner });

    // account1 should be able to issue
    await synthesizer.issueSynths(toUnit("10"), { from: account1 });

    // There should be 10 xUSD of value in the system
    assert.bnEqual(await synthesizer.totalIssuedSynths(xUSD), toUnit("10"));

    // And account1 should own 100% of the debt.
    assert.bnEqual(
      await synthesizer.debtBalanceOf(account1, xUSD),
      toUnit("10")
    );
  });

  it("should allow two issuers to issue synths in one flavour", async () => {
    await oracle.updateRates(
      [xAUD, xEUR, DOWS],
      ["0.5", "1.25", "0.1"].map(toUnit),
      timestamp,
      { from: oracleAccount }
    );

    // Give some DOWS to account1 and account2
    await shadows.transfer(account1, toUnit("10000"), {
      from: owner,
    });
    await shadows.transfer(account2, toUnit("10000"), {
      from: owner,
    });

    // Issue
    await synthesizer.issueSynths(toUnit("10"), { from: account1 });
    await synthesizer.issueSynths(toUnit("20"), { from: account2 });

    // There should be 30xUSD of value in the system
    assert.bnEqual(await synthesizer.totalIssuedSynths(xUSD), toUnit("30"));

    // And the debt should be split 50/50.
    // But there's a small rounding error.
    // This is ok, as when the last person exits the system, their debt percentage is always 100% so
    // these rounding errors don't cause the system to be out of balance.
    assert.bnClose(
      await synthesizer.debtBalanceOf(account1, xUSD),
      toUnit("10")
    );
    assert.bnClose(
      await synthesizer.debtBalanceOf(account2, xUSD),
      toUnit("20")
    );
  });

  it("should allow multi-issuance in one flavour", async () => {
    await oracle.updateRates(
      [xAUD, xEUR, DOWS],
      ["0.5", "1.25", "0.1"].map(toUnit),
      timestamp,
      { from: oracleAccount }
    );

    // Give some DOWS to account1 and account2
    await shadows.transfer(account1, toUnit("10000"), {
      from: owner,
    });
    await shadows.transfer(account2, toUnit("10000"), {
      from: owner,
    });

    // Issue
    await synthesizer.issueSynths(toUnit("10"), { from: account1 });
    await synthesizer.issueSynths(toUnit("20"), { from: account2 });
    await synthesizer.issueSynths(toUnit("10"), { from: account1 });

    // There should be 40 xUSD of value in the system
    assert.bnEqual(await synthesizer.totalIssuedSynths(xUSD), toUnit("40"));

    // And the debt should be split 50/50.
    // But there's a small rounding error.
    // This is ok, as when the last person exits the system, their debt percentage is always 100% so
    // these rounding errors don't cause the system to be out of balance.
    assert.bnClose(
      await synthesizer.debtBalanceOf(account1, xUSD),
      toUnit("20")
    );
    assert.bnClose(
      await synthesizer.debtBalanceOf(account2, xUSD),
      toUnit("20")
    );
  });

  it("should allow an issuer to issue max synths via the standard issue call", async () => {
    // Send a price update to guarantee we're not depending on values from outside this test.

    await oracle.updateRates(
      [xAUD, xEUR, DOWS],
      ["0.5", "1.25", "0.1"].map(toUnit),
      timestamp,
      { from: oracleAccount }
    );

    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("10000"), {
      from: owner,
    });

    // Determine maximum amount that can be issued.
    const maxIssuable = await synthesizer.maxIssuableSynths(account1);

    // Issue
    await synthesizer.issueSynths(maxIssuable, { from: account1 });

    // There should be 200 xUSD of value in the system
    assert.bnEqual(await synthesizer.totalIssuedSynths(xUSD), toUnit("200"));

    // And account1 should own all of it.
    assert.bnEqual(
      await synthesizer.debtBalanceOf(account1, xUSD),
      toUnit("200")
    );
  });

  it("should disallow an issuer from issuing synths beyond their remainingIssuableSynths", async () => {
    // Send a price update to guarantee we're not depending on values from outside this test.

    await oracle.updateRates(
      [xAUD, xEUR, DOWS],
      ["0.5", "1.25", "0.1"].map(toUnit),
      timestamp,
      { from: oracleAccount }
    );

    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("10000"), {
      from: owner,
    });

    // They should now be able to issue xUSD
    const issuableSynths = await getRemainingIssuableSynths(account1);
    assert.bnEqual(issuableSynths, toUnit("200"));

    // Issue that amount.
    await synthesizer.issueSynths(issuableSynths, { from: account1 });

    // They should now have 0 issuable synths.
    assert.bnEqual(await getRemainingIssuableSynths(account1), "0");

    // And trying to issue the smallest possible unit of one should fail.
    await assert.revert(synthesizer.issueSynths("1", { from: account1 }));
  });

  it("should allow an issuer with outstanding debt to burn synths and decrease debt", async () => {
    // Send a price update to guarantee we're not depending on values from outside this test.

    await oracle.updateRates(
      [xAUD, xEUR, DOWS],
      ["0.5", "1.25", "0.1"].map(toUnit),
      timestamp,
      { from: oracleAccount }
    );

    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("10000"), {
      from: owner,
    });

    // Issue
    await synthesizer.issueMaxSynths({ from: account1 });

    // account1 should now have 200 xUSD of debt.
    assert.bnEqual(
      await synthesizer.debtBalanceOf(account1, xUSD),
      toUnit("200")
    );

    // Burn 100 xUSD
    await synthesizer.burnSynths(toUnit("100"), { from: account1 });

    // account1 should now have 100 xUSD of debt.
    assert.bnEqual(
      await synthesizer.debtBalanceOf(account1, xUSD),
      toUnit("100")
    );
  });

  it("should disallow an issuer without outstanding debt from burning synths", async () => {
    // Send a price update to guarantee we're not depending on values from outside this test.
    await oracle.updateRates(
      [xAUD, xEUR, DOWS],
      ["0.5", "1.25", "0.1"].map(toUnit),
      timestamp,
      { from: oracleAccount }
    );

    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("10000"), {
      from: owner,
    });

    // Issue
    await synthesizer.issueMaxSynths({ from: account1 });

    // account2 should not have anything and can't burn.
    await assert.revert(
      synthesizer.burnSynths(toUnit("10"), { from: account2 })
    );

    // And even when we give account2 synths, it should not be able to burn.
    await xUSDContract.transfer(account2, toUnit("100"), {
      from: account1,
    });
    await assert.revert(
      synthesizer.burnSynths(toUnit("10"), { from: account2 })
    );
  });

  it("should burn 0 when trying to burn synths that do not exist", async () => {
    await oracle.updateRates(
      [xAUD, xEUR, DOWS],
      ["0.5", "1.25", "0.1"].map(toUnit),
      timestamp,
      { from: oracleAccount }
    );

    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("10000"), {
      from: owner,
    });

    // Issue
    await synthesizer.issueMaxSynths({ from: account1 });

    // Transfer all newly issued synths to account2
    await xUSDContract.transfer(account2, toUnit("200"), {
      from: account1,
    });

    const debtBefore = await synthesizer.debtBalanceOf(account1, xUSD);
    assert.ok(!debtBefore.isNeg());
    // Burning any amount of xUSD will reduce the amount down to the current supply, which is 0
    await assert.revert(synthesizer.burnSynths("1", { from: account1 }));
    const debtAfter = await synthesizer.debtBalanceOf(account1, xUSD);
    // So assert their debt balabce is unchanged from the burn of 0
    assert.bnEqual(debtBefore, debtAfter);
  });

  it("should only burn up to a user's actual debt level", async () => {
    await oracle.updateRates(
      [xAUD, xEUR, DOWS],
      ["0.5", "1.25", "0.1"].map(toUnit),
      timestamp,
      { from: oracleAccount }
    );

    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("10000"), {
      from: owner,
    });
    await shadows.transfer(account2, toUnit("10000"), {
      from: owner,
    });

    // Issue
    const fullAmount = toUnit("210");
    const account1Payment = toUnit("10");
    const account2Payment = fullAmount.sub(account1Payment);
    await synthesizer.issueSynths(account1Payment, { from: account1 });
    await synthesizer.issueSynths(account2Payment, { from: account2 });

    // Transfer all of account2's synths to account1
    await xUSDContract.transfer(account1, toUnit("200"), {
      from: account2,
    });

    // Calculate the amount that account1 should actually receive
    const amountReceived = toUnit("200");

    const balanceOfAccount1 = await xUSDContract.balanceOf(account1);

    // Then try to burn them all. Only 10 synths (and fees) should be gone.
    await synthesizer.burnSynths(balanceOfAccount1, { from: account1 });
    const balanceOfAccount1AfterBurn = await xUSDContract.balanceOf(account1);

    // Recording debts in the debt ledger reduces accuracy.
    //   Let's allow for a 1000 margin of error.
    assert.bnClose(balanceOfAccount1AfterBurn, amountReceived, "1000");
  });

  it("should correctly calculate debt in a multi-issuance scenario", async () => {
    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("200000"), {
      from: owner,
    });
    await shadows.transfer(account2, toUnit("200000"), {
      from: owner,
    });

    // Issue
    const issuedSynthsPt1 = toUnit("2000");
    const issuedSynthsPt2 = toUnit("2000");
    await synthesizer.issueSynths(issuedSynthsPt1, { from: account1 });
    await synthesizer.issueSynths(issuedSynthsPt2, { from: account1 });
    await synthesizer.issueSynths(toUnit("1000"), { from: account2 });

    const debt = await synthesizer.debtBalanceOf(account1, xUSD);
    assert.bnClose(debt, toUnit("4000"));
  });

  it("should correctly calculate debt in a multi-issuance multi-burn scenario", async () => {
    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("500000"), {
      from: owner,
    });
    await shadows.transfer(account2, toUnit("14000"), {
      from: owner,
    });

    // Issue
    const issuedSynthsPt1 = toUnit("2000");
    const burntSynthsPt1 = toUnit("1500");
    const issuedSynthsPt2 = toUnit("1600");
    const burntSynthsPt2 = toUnit("500");

    await synthesizer.issueSynths(issuedSynthsPt1, { from: account1 });
    await synthesizer.burnSynths(burntSynthsPt1, { from: account1 });
    await synthesizer.issueSynths(issuedSynthsPt2, { from: account1 });

    await synthesizer.issueSynths(toUnit("100"), { from: account2 });
    await synthesizer.issueSynths(toUnit("51"), { from: account2 });
    await synthesizer.burnSynths(burntSynthsPt2, { from: account1 });

    const debt = await synthesizer.debtBalanceOf(account1, toBytes32("xUSD"));
    const expectedDebt = issuedSynthsPt1
      .add(issuedSynthsPt2)
      .sub(burntSynthsPt1)
      .sub(burntSynthsPt2);

    assert.bnClose(debt, expectedDebt);
  });

  it("should allow me to burn all synths I've issued when there are other issuers", async () => {
    const totalSupply = await shadows.totalSupply();
    const account2Shadows = toUnit("120000");
    const account1Shadows = totalSupply.sub(account2Shadows);

    await shadows.transfer(account1, account1Shadows, {
      from: owner,
    }); // Issue the massive majority to account1
    await shadows.transfer(account2, account2Shadows, {
      from: owner,
    }); // Issue a small amount to account2

    // Issue from account1
    const account1AmountToIssue = await synthesizer.maxIssuableSynths(account1);
    await synthesizer.issueMaxSynths({ from: account1 });
    const debtBalance1 = await synthesizer.debtBalanceOf(account1, xUSD);
    assert.bnClose(debtBalance1, account1AmountToIssue);

    // Issue and burn from account 2 all debt
    await synthesizer.issueSynths(toUnit("43"), { from: account2 });
    let debt = await synthesizer.debtBalanceOf(account2, xUSD);
    await synthesizer.burnSynths(toUnit("43"), { from: account2 });
    debt = await synthesizer.debtBalanceOf(account2, xUSD);

    assert.bnEqual(debt, 0);

    // Should set user issuanceData to 0 debtOwnership and retain debtEntryIndex of last action
    assert.deepEqual(await synthesizer.issuanceData(account2), {
      initialDebtOwnership: 0,
      debtEntryIndex: 2,
    });
  });
  describe("multiple issue and burn scenarios", () => {
    it("should correctly calculate debt in a high issuance and burn scenario", async () => {
      const getRandomInt = (min, max) => {
        return min + Math.floor(Math.random() * Math.floor(max));
      };

      const totalSupply = await shadows.totalSupply();
      const account2Shadows = toUnit("120000");
      const account1Shadows = totalSupply.sub(account2Shadows);

      await shadows.transfer(account1, account1Shadows, {
        from: owner,
      }); // Issue the massive majority to account1
      await shadows.transfer(account2, account2Shadows, {
        from: owner,
      }); // Issue a small amount to account2

      const account1AmountToIssue = await synthesizer.maxIssuableSynths(
        account1
      );
      await synthesizer.issueMaxSynths({ from: account1 });
      const debtBalance1 = await synthesizer.debtBalanceOf(account1, xUSD);
      assert.bnClose(debtBalance1, account1AmountToIssue);

      let expectedDebtForAccount2 = web3.utils.toBN("0");
      const totalTimesToIssue = 40;
      for (let i = 0; i < totalTimesToIssue; i++) {
        // Seems that in this case, issuing 43 each time leads to increasing the variance regularly each time.
        const amount = toUnit("43");
        await synthesizer.issueSynths(amount, { from: account2 });
        expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);

        const desiredAmountToBurn = toUnit(
          web3.utils.toBN(getRandomInt(4, 14))
        );
        const amountToBurn = desiredAmountToBurn.lte(expectedDebtForAccount2)
          ? desiredAmountToBurn
          : expectedDebtForAccount2;
        await synthesizer.burnSynths(amountToBurn, { from: account2 });
        expectedDebtForAccount2 = expectedDebtForAccount2.sub(amountToBurn);
      }
      const debtBalance = await synthesizer.debtBalanceOf(account2, xUSD);

      // Here we make the variance a calculation of the number of times we issue/burn.
      // This is less than ideal, but is the result of calculating the debt based on
      // the results of the issue/burn each time.
      const variance = web3.utils
        .toBN(totalTimesToIssue)
        .mul(web3.utils.toBN("2"));
      assert.bnClose(debtBalance, expectedDebtForAccount2, variance);
    });

    it("should correctly calculate debt in a high (random) issuance and burn scenario", async () => {
      const getRandomInt = (min, max) => {
        return min + Math.floor(Math.random() * Math.floor(max));
      };

      const totalSupply = await shadows.totalSupply();
      const account2Shadows = toUnit("120000");
      const account1Shadows = totalSupply.sub(account2Shadows);

      await shadows.transfer(account1, account1Shadows, {
        from: owner,
      }); // Issue the massive majority to account1
      await shadows.transfer(account2, account2Shadows, {
        from: owner,
      }); // Issue a small amount to account2

      const account1AmountToIssue = await synthesizer.maxIssuableSynths(
        account1
      );
      await synthesizer.issueMaxSynths({ from: account1 });
      const debtBalance1 = await synthesizer.debtBalanceOf(account1, xUSD);
      assert.bnClose(debtBalance1, account1AmountToIssue);

      let expectedDebtForAccount2 = web3.utils.toBN("0");
      const totalTimesToIssue = 40;
      for (let i = 0; i < totalTimesToIssue; i++) {
        // Seems that in this case, issuing 43 each time leads to increasing the variance regularly each time.
        const amount = toUnit(web3.utils.toBN(getRandomInt(40, 49)));
        await synthesizer.issueSynths(amount, { from: account2 });
        expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);

        const desiredAmountToBurn = toUnit(
          web3.utils.toBN(getRandomInt(37, 46))
        );
        const amountToBurn = desiredAmountToBurn.lte(expectedDebtForAccount2)
          ? desiredAmountToBurn
          : expectedDebtForAccount2;
        await synthesizer.burnSynths(amountToBurn, { from: account2 });
        expectedDebtForAccount2 = expectedDebtForAccount2.sub(amountToBurn);

        // Useful debug logging
        // const db = await synthesizer.debtBalanceOf(account2, xUSD);
        // const variance = fromUnit(expectedDebtForAccount2.sub(db));
        // console.log(
        // 	`#### debtBalance: ${db}\t\t expectedDebtForAccount2: ${expectedDebtForAccount2}\t\tvariance: ${variance}`
        // );
      }
      const debtBalance = await synthesizer.debtBalanceOf(account2, xUSD);

      // Here we make the variance a calculation of the number of times we issue/burn.
      // This is less than ideal, but is the result of calculating the debt based on
      // the results of the issue/burn each time.
      const variance = web3.utils
        .toBN(totalTimesToIssue)
        .mul(web3.utils.toBN("2"));
      assert.bnClose(debtBalance, expectedDebtForAccount2, variance);
    });

    it("should correctly calculate debt in a high volume contrast issuance and burn scenario", async () => {
      const totalSupply = await shadows.totalSupply();

      // Give only 100 Shadows to account2
      const account2Shadows = toUnit("100");

      // Give the vast majority to account1 (ie. 99,999,900)
      const account1Shadows = totalSupply.sub(account2Shadows);

      await shadows.transfer(account1, account1Shadows, {
        from: owner,
      }); // Issue the massive majority to account1
      await shadows.transfer(account2, account2Shadows, {
        from: owner,
      }); // Issue a small amount to account2

      const account1AmountToIssue = await synthesizer.maxIssuableSynths(
        account1
      );
      await synthesizer.issueMaxSynths({ from: account1 });
      const debtBalance1 = await synthesizer.debtBalanceOf(account1, xUSD);
      assert.bnEqual(debtBalance1, account1AmountToIssue);

      let expectedDebtForAccount2 = web3.utils.toBN("0");
      const totalTimesToIssue = 40;
      for (let i = 0; i < totalTimesToIssue; i++) {
        const amount = toUnit("0.000000000000000002");
        await synthesizer.issueSynths(amount, { from: account2 });
        expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);
      }
      const debtBalance2 = await synthesizer.debtBalanceOf(account2, xUSD);

      // Here we make the variance a calculation of the number of times we issue/burn.
      // This is less than ideal, but is the result of calculating the debt based on
      // the results of the issue/burn each time.
      const variance = web3.utils
        .toBN(totalTimesToIssue)
        .mul(web3.utils.toBN("2"));
      assert.bnClose(debtBalance2, expectedDebtForAccount2, variance);
    });
  });
  it("should prevent more issuance if the user's collaterisation changes to be insufficient", async () => {
    // Set xEUR for purposes of this test
    const timestamp1 = await currentTime();
    await oracle.updateRates([xEUR], [toUnit("0.75")], timestamp1, {
      from: oracleAccount,
    });

    const issuedShadows = web3.utils.toBN("200000");
    await shadows.transfer(account1, toUnit(issuedShadows), {
      from: owner,
    });

    const maxIssuableSynths = await synthesizer.maxIssuableSynths(account1);

    // Issue
    const synthsToNotIssueYet = web3.utils.toBN("2000");
    const issuedSynths = maxIssuableSynths.sub(synthsToNotIssueYet);
    await synthesizer.issueSynths(issuedSynths, { from: account1 });

    // exchange into xEUR
    await synthesizer.exchange(xUSD, issuedSynths, xEUR, { from: account1 });

    // Increase the value of xEUR relative to synthesizer
    const timestamp2 = await currentTime();
    await oracle.updateRates([xEUR], [toUnit("1.10")], timestamp2, {
      from: oracleAccount,
    });

    await assert.revert(
      synthesizer.issueSynths(synthsToNotIssueYet, { from: account1 })
    );
  });
  it("should return 0 if user has no synthesizer when checking the collaterisation ratio", async () => {
    const ratio = await synthesizer.collateralisationRatio(account1);
    assert.bnEqual(ratio, new web3.utils.BN(0));
  });

  it("Any user can check the collaterisation ratio for a user", async () => {
    const issuedShadows = web3.utils.toBN("320000");
    await shadows.transfer(account1, toUnit(issuedShadows), {
      from: owner,
    });

    // Issue
    const issuedSynths = toUnit(web3.utils.toBN("6400"));
    await synthesizer.issueSynths(issuedSynths, { from: account1 });

    await synthesizer.collateralisationRatio(account1, { from: account2 });
  });

  it("should be able to read collaterisation ratio for a user with shadows but no debt", async () => {
    const issuedShadows = web3.utils.toBN("30000");
    await shadows.transfer(account1, toUnit(issuedShadows), {
      from: owner,
    });

    const ratio = await synthesizer.collateralisationRatio(account1);
    assert.bnEqual(ratio, new web3.utils.BN(0));
  });

  it("should be able to read collaterisation ratio for a user with synthesizer and debt", async () => {
    const issuedShadows = web3.utils.toBN("320000");
    await shadows.transfer(account1, toUnit(issuedShadows), {
      from: owner,
    });

    // Issue
    const issuedSynths = toUnit(web3.utils.toBN("6400"));
    await synthesizer.issueSynths(issuedSynths, { from: account1 });

    const ratio = await synthesizer.collateralisationRatio(account1, {
      from: account2,
    });
    assert.unitEqual(ratio, "0.2");
  });

  it("should permit anyone checking another user's collateral", async () => {
    const amount = toUnit("60000");
    await shadows.transfer(account1, amount, { from: owner });
    const collateral = await synthesizer.collateral(account1, {
      from: account2,
    });
    assert.bnEqual(collateral, amount);
  });

  it("should allow anyone to check if any rates are stale", async () => {
    const result = await oracle.anyRateIsStale([xEUR, xAUD], { from: owner });
    assert.equal(result, false);
  });

  it("should calculate a user's remaining issuable synths", async () => {
    const transferredShadows = toUnit("60000");
    await shadows.transfer(account1, transferredShadows, {
      from: owner,
    });

    // Issue
    const maxIssuable = await synthesizer.maxIssuableSynths(account1);
    const issued = maxIssuable.div(web3.utils.toBN(3));
    await synthesizer.issueSynths(issued, { from: account1 });
    const expectedRemaining = maxIssuable.sub(issued);
    const remaining = await getRemainingIssuableSynths(account1);
    assert.bnEqual(expectedRemaining, remaining);
  });

  it("should successfully burn all user's synths", async () => {
    // Send a price update to guarantee we're not depending on values from outside this test.

    await oracle.updateRates([DOWS], [toUnit("0.1")], timestamp, {
      from: oracleAccount,
    });

    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("10000"), {
      from: owner,
    });

    // Issue
    await synthesizer.issueSynths(toUnit("199"), { from: account1 });

    // Then try to burn them all. Only 10 synths (and fees) should be gone.
    await synthesizer.burnSynths(await xUSDContract.balanceOf(account1), {
      from: account1,
    });
    assert.bnEqual(await xUSDContract.balanceOf(account1), web3.utils.toBN(0));
  });

  it("should burn the correct amount of synths", async () => {
    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("400000"), {
      from: owner,
    });

    // Issue
    await synthesizer.issueSynths(toUnit("3987"), { from: account1 });

    // Then try to burn some of them. There should be 3000 left.
    await synthesizer.burnSynths(toUnit("987"), { from: account1 });
    assert.bnEqual(await xUSDContract.balanceOf(account1), toUnit("3000"));
  });

  it("should successfully burn all user's synths even with transfer", async () => {
    // Send a price update to guarantee we're not depending on values from outside this test.

    await oracle.updateRates([DOWS], [toUnit("0.1")], timestamp, {
      from: oracleAccount,
    });

    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("300000"), {
      from: owner,
    });

    // Issue
    const amountIssued = toUnit("2000");
    await synthesizer.issueSynths(amountIssued, { from: account1 });

    // Transfer account1's synths to account2 and back
    const amountToTransfer = toUnit("1800");
    await xUSDContract.transfer(account2, amountToTransfer, {
      from: account1,
    });
    const remainingAfterTransfer = await xUSDContract.balanceOf(account1);
    await xUSDContract.transfer(
      account1,
      await xUSDContract.balanceOf(account2),
      {
        from: account2,
      }
    );

    // Calculate the amount that account1 should actually receive
    const amountReceived = toUnit("1800");
    const amountReceived2 = amountReceived;
    const amountLostToFees = amountToTransfer.sub(amountReceived2);

    // Check that the transfer worked ok.
    const amountExpectedToBeLeftInWallet = amountIssued.sub(amountLostToFees);
    assert.bnEqual(
      amountReceived2.add(remainingAfterTransfer),
      amountExpectedToBeLeftInWallet
    );

    // Now burn 1000 and check we end up with the right amount
    await synthesizer.burnSynths(toUnit("1000"), { from: account1 });
    assert.bnEqual(
      await xUSDContract.balanceOf(account1),
      amountExpectedToBeLeftInWallet.sub(toUnit("1000"))
    );
  });

  it("should allow the last user in the system to burn all their synths to release their synthesizer", async () => {
    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("500000"), {
      from: owner,
    });
    await shadows.transfer(account2, toUnit("140000"), {
      from: owner,
    });
    await shadows.transfer(account3, toUnit("1400000"), {
      from: owner,
    });

    // Issue
    const issuedSynths1 = toUnit("2000");
    const issuedSynths2 = toUnit("2000");
    const issuedSynths3 = toUnit("2000");

    // Send more than their synth balance to burn all
    const burnAllSynths = toUnit("2050");

    await synthesizer.issueSynths(issuedSynths1, { from: account1 });
    await synthesizer.issueSynths(issuedSynths2, { from: account2 });
    await synthesizer.issueSynths(issuedSynths3, { from: account3 });

    await synthesizer.burnSynths(burnAllSynths, { from: account1 });
    await synthesizer.burnSynths(burnAllSynths, { from: account2 });
    await synthesizer.burnSynths(burnAllSynths, { from: account3 });

    const debtBalance1After = await synthesizer.debtBalanceOf(account1, xUSD);
    const debtBalance2After = await synthesizer.debtBalanceOf(account2, xUSD);
    const debtBalance3After = await synthesizer.debtBalanceOf(account3, xUSD);

    assert.bnEqual(debtBalance1After, "0");
    assert.bnEqual(debtBalance2After, "0");
    assert.bnEqual(debtBalance3After, "0");
  });

  it("should allow a user to burn up to their balance if they try too burn too much", async () => {
    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("500000"), {
      from: owner,
    });

    // Issue
    const issuedSynths1 = toUnit("10");

    await synthesizer.issueSynths(issuedSynths1, { from: account1 });
    await synthesizer.burnSynths(issuedSynths1.add(toUnit("9000")), {
      from: account1,
    });
    const debtBalanceAfter = await synthesizer.debtBalanceOf(account1, xUSD);

    assert.bnEqual(debtBalanceAfter, "0");
  });

  it("should allow users to burn their debt and adjust the debtBalanceOf correctly for remaining users", async () => {
    // Give some DOWS to account1
    await shadows.transfer(account1, toUnit("4000000"), {
      from: owner,
    });
    await shadows.transfer(account2, toUnit("4000000"), {
      from: owner,
    });

    // Issue
    const issuedSynths1 = toUnit("15000");
    const issuedSynths2 = toUnit("5000");

    await synthesizer.issueSynths(issuedSynths1, { from: account1 });
    await synthesizer.issueSynths(issuedSynths2, { from: account2 });

    let debtBalance1After = await synthesizer.debtBalanceOf(account1, xUSD);
    let debtBalance2After = await synthesizer.debtBalanceOf(account2, xUSD);

    // debtBalanceOf has rounding error but is within tolerance
    assert.bnClose(debtBalance1After, toUnit("15000"));
    assert.bnClose(debtBalance2After, toUnit("5000"));

    // Account 1 burns 100,000
    await synthesizer.burnSynths(toUnit("10000"), { from: account1 });

    debtBalance1After = await synthesizer.debtBalanceOf(account1, xUSD);
    debtBalance2After = await synthesizer.debtBalanceOf(account2, xUSD);

    assert.bnClose(debtBalance1After, toUnit("5000"));
    assert.bnClose(debtBalance2After, toUnit("5000"));
  });

  it("should revert if sender tries to issue synths with 0 amount", async () => {
    // Issue 0 amount of synth
    const issuedSynths1 = toUnit("0");

    await assert.revert(
      synthesizer.issueSynths(issuedSynths1, { from: account1 })
    );
  });

  it("should include escrowed reward shadows when calculating a user's collaterisation ratio", async () => {
    const dows2usdRate = await oracle.rateForCurrency(DOWS);
    const transferredShadows = toUnit("60000");
    await shadows.transfer(account1, transferredShadows, {
      from: owner,
    });

    await addressResolver.importAddresses([toBytes32("FeePool")], [account2]);

    const escrowedShadows = toUnit("30000");
    await shadows.transfer(rewardEscrow.address, escrowedShadows, {
      from: owner,
    });
    await rewardEscrow.appendVestingEntry(account1, escrowedShadows, {
      from: account2,
    });

    await addressResolver.importAddresses(
      [toBytes32("FeePool")],
      [feePool.address]
    );
    // Issue
    const maxIssuable = await synthesizer.maxIssuableSynths(account1);
    await synthesizer.issueSynths(maxIssuable, { from: account1 });

    // Compare
    const collaterisationRatio = await synthesizer.collateralisationRatio(
      account1
    );
    const expectedCollaterisationRatio = divideDecimal(
      maxIssuable,
      multiplyDecimal(escrowedShadows.add(transferredShadows), dows2usdRate)
    );
    assert.bnEqual(collaterisationRatio, expectedCollaterisationRatio);
  });

  it("should permit user to issue xUSD debt with only escrowed DOWS as collateral (no DOWS in wallet)", async () => {
    // Send a price update to guarantee we're not depending on values from outside this test.
    await oracle.updateRates(
      [xAUD, xEUR, DOWS],
      ["0.5", "1.25", "0.1"].map(toUnit),
      timestamp,
      { from: oracleAccount }
    );

    // ensure collateral of account1 is empty
    let collateral = await synthesizer.collateral(account1, { from: account1 });
    assert.bnEqual(collateral, 0);

    // ensure account1 has no DOWS balance
    const dowsBalance = await shadows.balanceOf(account1);
    assert.bnEqual(dowsBalance, 0);

    // Append escrow amount to account1
    const escrowedAmount = toUnit("15000");
    await shadows.transfer(rewardEscrow.address, escrowedAmount, {
      from: owner,
    });
    await addressResolver.importAddresses([toBytes32("FeePool")], [owner]);
    await rewardEscrow.appendVestingEntry(account1, escrowedAmount, {
      from: owner,
    });
    await addressResolver.importAddresses(
      [toBytes32("FeePool")],
      [feePool.address]
    );

    // collateral should include escrowed amount
    collateral = await synthesizer.collateral(account1, { from: account1 });
    assert.bnEqual(collateral, escrowedAmount);

    // Issue max synths. (300 xUSD)
    await synthesizer.issueMaxSynths({ from: account1 });

    // There should be 300 xUSD of value for account1
    assert.bnEqual(
      await synthesizer.debtBalanceOf(account1, xUSD),
      toUnit("300")
    );
  });

  it("should include escrowed synthesizer when checking a user's collateral", async () => {
    const escrowedAmount = toUnit("15000");
    await shadows.transfer(rewardEscrow.address, escrowedAmount, {
      from: owner,
    });
    await addressResolver.importAddresses([toBytes32("FeePool")], [owner]);
    await rewardEscrow.appendVestingEntry(account1, escrowedAmount, {
      from: owner,
    });

    const amount = toUnit("60000");
    await shadows.transfer(account1, amount, { from: owner });
    const collateral = await synthesizer.collateral(account1, {
      from: account2,
    });
    assert.bnEqual(collateral, amount.add(escrowedAmount));
  });
});
