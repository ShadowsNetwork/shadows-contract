
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
  fromUnit,
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
    xETHContract,
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

  const testAccounts = [account1, account2, account3];

  const [xUSD, DOWS, xBTC, xETH] = [
    "xUSD",
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
    xETHContract = await Synth.at(await synthesizer.synths(xETH));

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

  // describe("constructor", () => {
  //   it("should set params on initialize", async () => {
  //     assert.equal(await liquidations.owner(), owner);
  //     assert.equal(await liquidations.resolver(), addressResolver.address);
  //   });
  // });

  // describe('Default settings', () => {
  //   it('liquidation ratio', async () => {
  //     const liquidationRatio = await liquidations.liquidationRatio();
  //     assert.bnEqual(liquidationRatio, toUnit('0.5'));
  //   });
  //   it('liquidation penalty ', async () => {
  //     const liquidationPenalty = await liquidations.liquidationPenalty();
  //     assert.bnEqual(liquidationPenalty, toUnit('0.1'));
  //   });
  //   it('liquidation delay', async () => {
  //     const liquidationDelay = await liquidations.liquidationDelay();
  //     assert.bnEqual(liquidationDelay, 1 * 60 * 60 * 2); // 2 hours
  //   });
  // });

  // describe('Change default setting', async () => {
  //   const newLiquidationRatio = toUnit('0.4');
  //   const newLiquidationPenalty = toUnit('0.2');
  //   const newLiquidationDelay = 1 * 60 * 60;

  //   describe('should owner from setting liquidation ratio, penalty, delay', () => {
  //     beforeEach(async () => {
  //       await liquidations.setLiquidationRatio(newLiquidationRatio, { from: owner });
  //       await liquidations.setLiquidationPenalty(newLiquidationPenalty, { from: owner });
  //       await liquidations.setLiquidationDelay(newLiquidationDelay, { from: owner });
  //     });

  //     it('should liquidation ratio 0.4', async () => {
  //       const liquidationRatio = await liquidations.liquidationRatio();
  //       assert.bnEqual(liquidationRatio, newLiquidationRatio);
  //       assert.bnNotEqual(liquidationRatio, toUnit('0.5'));
  //     });

  //     it('should liquidation penalty 0.2', async () => {
  //       const liquidationPenalty = await liquidations.liquidationPenalty();
  //       assert.bnEqual(liquidationPenalty, newLiquidationPenalty);
  //       assert.bnNotEqual(liquidationPenalty, toUnit('0.1'));
  //     });

  //     it('should liquidation delay 1 hours', async () => {
  //       const liquidationDelay = await liquidations.liquidationDelay();
  //       assert.bnEqual(liquidationDelay, newLiquidationDelay);
  //       assert.bnNotEqual(liquidationDelay, 1 * 60 * 60 * 2);
  //     });
  //   })

  //   it('should disallow a non-owner from setting liquidation ratio, penalty, delay', async () => {
  //     await assert.revert(liquidations.setLiquidationRatio(newLiquidationRatio, { from: account1 }));
  //     await assert.revert(liquidations.setLiquidationPenalty(newLiquidationPenalty, { from: account2 }));
  //     await assert.revert(liquidations.setLiquidationDelay(newLiquidationDelay, { from: account3 }));
  //   });

  // });

  describe('with Current Collateral >= 500', async () => {
    beforeEach(async () => {
      const dowsAmount = [100, 500, 3000].map(item => toUnit(item));

      await oracle.updateRates(
        [xETH, DOWS, xBTC],
        ["2000", "0.1", "30000"].map(toUnit),
        timestamp,
        { from: oracleAccount }
      );

      for(const index in testAccounts){
        await shadows.transfer(testAccounts[index], dowsAmount[index], {
          from: owner,
        });
      }
      
      for (const account of testAccounts) {
        const maxUSD = await synthesizer.maxIssuableSynths(account);
        await synthesizer.issueSynths(maxUSD, { from: account });

        // const collateraRatio = await synthesizer.collateralisationRatio(account);
        // console.log(fromUnit(collateraRatio).toString())
        // const myRatio = divideDecimal(toUnit(1), collateraRatio);
        // console.log(fromUnit(myRatio).toString())
      }

      const maxUSD = await synthesizer.maxIssuableSynths(account1);
      await synthesizer.exchange(xUSD, maxUSD, xETH, {
        from: account1,
      });

    });

    it('should xeth rate is down', async () => {
      await oracle.updateRates(
        [xETH, DOWS, xBTC],
        ["1000", "0.1", "30000"].map(toUnit),
        await currentTime(),
        { from: oracleAccount }
      );

      console.log(fromUnit(await oracle.rateForCurrency(xETH)).toString())
      for (const account of testAccounts) {
        console.log(`------------${account}---------------`)
        const valueUSD = await xUSDContract.balanceOf(account);
        console.log(fromUnit(valueUSD).toString())

        const valueETH = await xETHContract.balanceOf(account);
        console.log(fromUnit(valueETH).toString())

        const collateraRatio = await synthesizer.collateralisationRatio(account);
        console.log(fromUnit(collateraRatio).toString())

        const myRatio = divideDecimal(toUnit(1), collateraRatio);
        console.log(fromUnit(myRatio).toString())
      }
    });

    // it('should system checks', async () => {
    //   for (const account of [account1, account2, account3]) {
    //     const deadline = await liquidations.getLiquidationDeadlineForAccount(account);
    //     assert.bnEqual(deadline, toUnit(0))

    //     const isOpen = await liquidations.isOpenForLiquidation(account);
    //     assert.isFalse(isOpen)

    //     // await liquidations.flagAccountForLiquidation(account)
    //   }

    //   // const value = await liquidations.getliquidationAddressStorage();
    //   // console.log(value)
    //   // console.log(value.toString())
    //   const result = await liquidations.getliquidationAddressStorage();
    //   console.log(result)
    //   // await oracle.updateRates(
    //   //   [DOWS],
    //   //   ["0.05"].map(toUnit),
    //   //   timestamp,
    //   //   { from: oracleAccount }
    //   // );

    //   // for (const account of [account1, account2, account3]) {
    //   //   const collateraRatio = await synthesizer.collateralisationRatio(account);
    //   //   const myRatio = divideDecimal(toUnit(1), collateraRatio);
    //   //   console.log(fromUnit(myRatio).toString())
    //   // }
    // });

  });

});