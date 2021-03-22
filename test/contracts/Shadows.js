require('.'); 
const Oracle = artifacts.require("Oracle");
const Shadows = artifacts.require("Shadows");
const FeePool = artifacts.require("FeePool");
const SafeDecimalMath = artifacts.require("SafeDecimalMath");
const AddressResolver = artifacts.require("AddressResolver");
const Synth = artifacts.require("Synth");
const { toBytes32, toUnit } = require("../testUtils");

contract("Shadows", async (accounts) => {
  let shadows, oracle, feePool, addressResolver, safeDecimalMath;

  const [deployerAccount, owner, oracleAccount, account2, account3] = accounts;

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

    await addressResolver.importAddresses(
      [toBytes32("Shadows"), toBytes32("Oracle"), toBytes32("FeePool")],
      [shadows.address, oracle.address, feePool.address]
    );
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
  });
});
