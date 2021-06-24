
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
const Liquidations = artifacts.require("Liquidations");

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

contract("Liquidations", async (accounts) => {

  let shadows,
    oracle,
    feePool,
    exchanger,
    addressResolver,
    rewardEscrow,
    safeDecimalMath,
    xUSDContract,
    liquidations,
    timestamp;

  const [
    deployerAccount,
    owner,
    oracleAccount,
    account1,
    account2,
    account3,
  ] = accounts;

  const [xUSD, DOWS, xBTC, xETH] = [
    "xUSD",
    "DOWS",
    "xBTC",
    "xETH",
  ].map(toBytes32);

  before(async () => {
    safeDecimalMath = await SafeDecimalMath.new();
    await Synthesizer.link(safeDecimalMath);
    await Oracle.link(safeDecimalMath);
    await FeePool.link(safeDecimalMath);
    await Exchanger.link(safeDecimalMath);
    await Liquidations.link(safeDecimalMath)
  });

  beforeEach(async () => {
    timestamp = await currentTime();
    addressResolver = await AddressResolver.new();

    synthesizer = await Synthesizer.new();
    await synthesizer.initialize(addressResolver.address, { from: owner });
    await synthesizer.setIssuanceRatio(toUnit("0.2"), { from: owner });

    shadows = await Shadows.new();
    await shadows.initialize({ from: owner });
    await shadows.setSynthesizer(synthesizer.address, { from: owner });

    //oracle
    oracle = await Oracle.new();
    await oracle.initialize(
      oracleAccount,
      [xETH, DOWS, xBTC],
      ["2000", "0.1", "30000"].map(toUnit),
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

    liquidations = await Liquidations.new();
    await liquidations.initialize(addressResolver.address, { from: owner })

    await addressResolver.importAddresses(
      [
        toBytes32("Shadows"),
        toBytes32("Oracle"),
        toBytes32("FeePool"),
        toBytes32("Exchanger"),
        toBytes32("RewardEscrow"),
        toBytes32("Synthesizer"),
        toBytes32("Liquidations"),
      ],
      [
        shadows.address,
        oracle.address,
        feePool.address,
        exchanger.address,
        rewardEscrow.address,
        synthesizer.address,
        liquidations.address
      ]
    );

    //add xBTC
    const xBTCSynth = await Synth.new();
    await xBTCSynth.initialize(
      "Synth xBTC",
      "xBTC",
      xBTC,
      addressResolver.address,
      { from: owner }
    );
    await synthesizer.addSynth(xBTCSynth.address, { from: owner });

    //add xETH
    const xETHSynth = await Synth.new();
    await xETHSynth.initialize(
      "Synth xETH",
      "xETH",
      xETH,
      addressResolver.address,
      { from: owner }
    );
    await synthesizer.addSynth(xETHSynth.address, { from: owner });

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
  });

  describe("constructor", () => {
    it("should set params on initialize", async () => {
      assert.equal(await liquidations.owner(), owner);
      assert.equal(await liquidations.resolver(), addressResolver.address);
    });
  });

  describe('Default settings', () => {
    it('liquidation ratio', async () => {
      const liquidationRatio = await liquidations.liquidationRatio();
      assert.bnEqual(liquidationRatio, toUnit('0.5'));
    });
    it('liquidation penalty ', async () => {
      const liquidationPenalty = await liquidations.liquidationPenalty();
      assert.bnEqual(liquidationPenalty, toUnit('0.1'));
    });
    it('liquidation delay', async () => {
      const liquidationDelay = await liquidations.liquidationDelay();
      assert.bnEqual(liquidationDelay, 1 * 60 * 60 * 2); // 2 hours
    });
  });

  describe('Change default setting', async () => {
    const newLiquidationRatio = toUnit('0.4');
    const newLiquidationPenalty = toUnit('0.2');
    const newLiquidationDelay = 1 * 60 * 60;

    beforeEach(async () => {
      await liquidations.setLiquidationRatio(newLiquidationRatio, { from: owner });
      await liquidations.setLiquidationPenalty(newLiquidationPenalty, { from: owner });
      await liquidations.setLiquidationDelay(newLiquidationDelay, { from: owner });
    });

    it('should liquidation ratio 0.4', async () => {
      const liquidationRatio = await liquidations.liquidationRatio();
      assert.bnEqual(liquidationRatio, newLiquidationRatio);
      assert.bnNotEqual(liquidationRatio, toUnit('0.5'));
    });

    it('should liquidation penalty 0.2', async () => {
      const liquidationPenalty = await liquidations.liquidationPenalty();
      assert.bnEqual(liquidationPenalty, newLiquidationPenalty);
      assert.bnNotEqual(liquidationPenalty, toUnit('0.1'));
    });

    it('should liquidation delay 1 hours', async () => {
      const liquidationDelay = await liquidations.liquidationDelay();
      assert.bnEqual(liquidationDelay, newLiquidationDelay);
      assert.bnNotEqual(liquidationDelay, 1 * 60 * 60 * 2);
    });

    
  });

  it('should disallow a non-owner from setting liquidation ratio, penalty, delay', async () => {
    await assert.revert(liquidations.setLiquidationRatio(newLiquidationRatio, { from: account1 }));
    await assert.revert(liquidations.setLiquidationPenalty(newLiquidationPenalty, { from: account2 }));
    await assert.revert(liquidations.setLiquidationDelay(newLiquidationDelay, { from: account3 }));
  });

  describe('', async () => {

    beforeEach(async () => {

      const dowsAmount = toUnit("30000");

      await oracle.updateRates(
        [xETH, DOWS, xBTC],
        ["2000", "0.1", "30000"].map(toUnit),
        timestamp1, {
        from: oracleAccount,
      });

      await shadows.transfer(account1, dowsAmount, {
        from: owner,
      });

      await shadows.transfer(account2, dowsAmount, {
        from: owner,
      });

    });



  });

});