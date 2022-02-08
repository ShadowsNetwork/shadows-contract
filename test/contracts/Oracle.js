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
const MockAggregator = artifacts.require("MockAggregator");

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

const convertToAggregatorPrice = val => web3.utils.toBN(Math.round(val * 1e8));

const sleep = (time) => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, time || 5000);
  })
};

contract("Oracle", async (accounts) => {
  let shadows,
    oracle,
    aggregatorBTC,
    aggregatorETH,
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
    "ShaUSD",
    "DOWS",
    "xBTC",
    "xETH",
  ].map(toBytes32);

  const getRemainingIssuableSynths = async (account) =>
    (await synthesizer.remainingIssuableSynths(account))[0];

  before(async () => {
  aggregatorBTC = await MockAggregator.new({ from: owner });;
	aggregatorETH = await MockAggregator.new({ from: owner });;
    safeDecimalMath = await SafeDecimalMath.new();
    await Oracle.link(safeDecimalMath);
  });

  beforeEach(async () => {
    //oracle
    oracle = await Oracle.new({ from: owner });
    await oracle.initialize(
      oracleAccount,
      [DOWS],
      [toUnit(1)],
      {
        from: owner,
      }
    );
    let currentTS = await currentTime();
    await oracle.addAggregator(xBTC,aggregatorBTC.address,{ from: owner });
    await oracle.addAggregator(xETH,aggregatorETH.address,{ from: owner });
    await oracle.setRateStalePeriod(1000,{ from: owner });
    await oracle.setRateStalePeriods([xBTC,xETH],[10000,5000],{ from: owner });
    await aggregatorBTC.setLatestAnswer(convertToAggregatorPrice(10),currentTS-6000);
    await aggregatorETH.setLatestAnswer(convertToAggregatorPrice(20),currentTS-6000);
  });


  describe('Oracle', async () => {
    it('constructor', async () => {
      let response = await oracle.ratesAndStaleForCurrencies([DOWS, xBTC,xETH]);
      assert.equal(response[1], true);
      assert.bnEqual(response[0][0], toUnit('1'));
			assert.bnEqual(response[0][1], toUnit('10'));
			assert.bnEqual(response[0][2], toUnit('20'));
    });

    it('rateIsStale', async () => {
      assert.equal(await oracle.rateIsStale(xUSD), false);
      assert.equal(await oracle.rateIsStale(DOWS), false);
      assert.equal(await oracle.rateIsStale(xETH), true);
      assert.equal(await oracle.rateIsStale(xBTC), false);
    });

    it('anyRateIsStale', async () => {
      assert.equal(await oracle.anyRateIsStale([xUSD,xBTC,xETH,DOWS]), true);
    });

    it('no RateIsStale', async () => {
      await aggregatorETH.setLatestAnswer(convertToAggregatorPrice(20),await currentTime()-4000);
      assert.equal(await oracle.anyRateIsStale([xUSD,xBTC,xETH,DOWS]), false);
    });
  });
});