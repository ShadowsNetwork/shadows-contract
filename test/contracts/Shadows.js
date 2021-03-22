require(".");
const Oracle = artifacts.require("Oracle");
const Shadows = artifacts.require("Shadows");
const FeePool = artifacts.require("FeePool");
const Exchanger = artifacts.require("Exchanger");
const SafeDecimalMath = artifacts.require("SafeDecimalMath");
const AddressResolver = artifacts.require("AddressResolver");
const Synth = artifacts.require("Synth");
const { toBytes32, toUnit, ZERO_ADDRESS } = require("../testUtils");

contract("Shadows", async (accounts) => {
  let shadows, oracle, feePool, exchanger, addressResolver, safeDecimalMath;

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

  before(async () => {
    safeDecimalMath = await SafeDecimalMath.new();
    await Shadows.link(safeDecimalMath);
    await Oracle.link(safeDecimalMath);
    await FeePool.link(safeDecimalMath);
    await Exchanger.link(safeDecimalMath);
  });

  beforeEach(async () => {
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
  });
});
