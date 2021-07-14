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
  assertEventsEqual,
} = require("../../utils");

const log = (value) => {
  console.log(fromUnit(value).toString());
}

const sleep = (time) => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, time || 5000);
  })
};

contract("Shadows", async (accounts) => {
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
      [DOWS],
      ["0.1"].map(toUnit),
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



  describe('should shadow transfer', async () => {

    it('should transfer test', async () => {
      await shadows.transfer(account1, toUnit(1000), {
        from: owner,
      });

      assert.bnEqual(await shadows.balanceOf(account1), toUnit(1000));

      await shadows.transfer(account2, toUnit(2000), {
        from: owner,
      });

      assert.bnEqual(await shadows.balanceOf(account2), toUnit(2000));


      await shadows.transfer(account1, toUnit(1000), { from: account2 });

      assert.bnEqual(await shadows.balanceOf(account1), toUnit(2000));
      assert.bnEqual(await shadows.balanceOf(account2), toUnit(1000));

    });

    it('should transferFrom test', async () => {
      await shadows.transfer(account1, toUnit(1000), {
        from: owner,
      });

      await shadows.transfer(account2, toUnit(2000), {
        from: owner,
      });


      await shadows.approve(owner, toUnit(1000), { from: account1 });

      await shadows.transferFrom(account1, account2, toUnit(1000), { from: owner });

      assert.bnEqual(await shadows.balanceOf(account1), 0)

      assert.bnEqual(await shadows.balanceOf(account2), toUnit(3000))
    });

    describe('should issue synths', async () => {
      beforeEach(async () => {
        await shadows.transfer(account1, toUnit(1000), {
          from: owner,
        });

        // Issue $20 xUSD
        const maxUSD = await synthesizer.maxIssuableSynths(account1);
        await synthesizer.issueSynths(maxUSD, { from: account1 });

        await oracle.updateRates(
          [DOWS],
          ["0.04"].map(toUnit),
          await currentTime(),
          { from: oracleAccount }
        );
      });

      it('should not transfer and transferFrom', async () => {
        await assert.revert(
          shadows.transfer(account2, toUnit(1000), {
            from: account1,
          }),
          'Cannot transfer staked DOWS'
        );

        await shadows.approve(owner, toUnit(1000), { from: account1 });
        await assert.revert(
          shadows.transferFrom(account1, account2, toUnit(1000), {
            from: owner,
          }),
          'Cannot transfer staked DOWS'
        );

      });

    });
  });
});