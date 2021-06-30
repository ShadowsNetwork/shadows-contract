
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

  const sleep = (time) => {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve();
      }, time || 5000);
    })
  };

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

    describe('should owner from setting liquidation ratio, penalty, delay', () => {
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
    })

    it('should disallow a non-owner from setting liquidation ratio, penalty, delay', async () => {
      await assert.revert(liquidations.setLiquidationRatio(newLiquidationRatio, { from: account1 }));
      await assert.revert(liquidations.setLiquidationPenalty(newLiquidationPenalty, { from: account2 }));
      await assert.revert(liquidations.setLiquidationDelay(newLiquidationDelay, { from: account3 }));
    });

  });

  describe('when DOWS is stale', async () => {
    beforeEach(async () => {
      await oracle.setRateStalePeriod(1, { from: oracleAccount });
    });

    it('when flagAccountForLiquidation() is invoked, it reverts for rate stale', async () => {
      await assert.revert(
        liquidations.flagAccountForLiquidation(account1, { from: owner }),
        'Rate stale or not a synth'
      )
    });

    it('when checkAndRemoveAccountInLiquidation() is invoked, it reverts for rate stale', async () => {
      await assert.revert(
        liquidations.checkAndRemoveAccountInLiquidation(account1, { from: owner }),
        'Rate stale or not a synth'
      )
    });
  });

  describe('calculateAmountToFixCollateral', () => {
    let liquidationPenalty;
    beforeEach(async () => {
      liquidationPenalty = await liquidations.liquidationPenalty();
      assert.bnEqual(liquidationPenalty, toUnit('0.1'));
    });

    it('calculates xUSD to fix ratio from 200%, with $100 DOWS collateral and $20 debt', async () => {
      const expectedAmount = toUnit('230.76923076923076923');
      const collateralBefore = toUnit('600');
      const debtBefore = toUnit('300');
      const susdToLiquidate = await liquidations.calculateAmountToFixCollateral(
        debtBefore,
        collateralBefore
      );
      assert.bnEqual(susdToLiquidate, expectedAmount);

      const debtAfter = debtBefore.sub(susdToLiquidate);
      const collateralAfterMinusPenalty = collateralBefore.sub(
        multiplyDecimal(susdToLiquidate, toUnit('1').add(liquidationPenalty))
      );

      // c-ratio = debt / collateral
      const collateralRatio = divideDecimal(debtAfter, collateralAfterMinusPenalty);

      assert.bnEqual(collateralRatio, toUnit(0.2));

    })

    it('calculates xUSD to fix ratio from 300%, with $600 DOWS collateral and $300 debt', async () => {
      const expectedAmount = toUnit('102.564102564102564102');
      const collateralBefore = toUnit('600');
      const debtBefore = toUnit('200');
      const susdToLiquidate = await liquidations.calculateAmountToFixCollateral(
        debtBefore,
        collateralBefore
      );
      assert.bnEqual(susdToLiquidate, expectedAmount);

      const debtAfter = debtBefore.sub(susdToLiquidate);
      const collateralAfterMinusPenalty = collateralBefore.sub(
        multiplyDecimal(susdToLiquidate, toUnit('1').add(liquidationPenalty))
      );

      // c-ratio = debt / collateral
      const collateralRatio = divideDecimal(debtAfter, collateralAfterMinusPenalty);

      assert.bnEqual(collateralRatio, toUnit(0.2));
    })
  });

  it('when checkAndRemoveAccountInLiquidation() is invoked, it reverts with Account has no liquidation set', async () => {
    await assert.revert(
      liquidations.checkAndRemoveAccountInLiquidation(account1),
      'Account has no liquidation set'
    )
  });

  it('should not synthesizer address removeAccountInLiquidation', async () => {
    await assert.revert(
      liquidations.removeAccountInLiquidation(account1, { from: owner }),
      'FeePool: Only Issuer Authorised'
    );
  });

  describe('should calls liquidateDelinquentAccount on anyone undercollateralized', async () => {
    beforeEach(async () => {
      const dowsAmount = [1000, 50000, 300000].map(item => toUnit(item));
      for (const index in testAccounts) {
        // tranfer account some DOWS
        await shadows.transfer(testAccounts[index], dowsAmount[index], {
          from: owner,
        });
      }

      // issue max xUSD
      for (const account of testAccounts) {
        const maxUSD = await synthesizer.maxIssuableSynths(account);
        await synthesizer.issueSynths(maxUSD, { from: account });
      }

      // account3 buy xETH for xUSD
      const maxUSD = await synthesizer.maxIssuableSynths(account3);
      await synthesizer.exchange(xUSD, maxUSD, xETH, {
        from: account3,
      });

      await oracle.updateRates(
        [xETH, DOWS, xBTC],
        ["2000", "0.01", "30000"].map(toUnit),
        await currentTime(),
        { from: oracleAccount }
      );
    });

    describe('should has not been flagged for liquidation', () => {
      it('should calls checkAndRemoveAccountInLiquidation then it reverts', async () => {
        await assert.revert(
          liquidations.checkAndRemoveAccountInLiquidation(account1),
          'Account has no liquidation set'
        );
      });
      it('then isLiquidationDeadlinePassed returns false as no liquidation set', async () => {
        assert.isFalse(await liquidations.isLiquidationDeadlinePassed(account1));
      });

      it('then isOpenForLiquidation returns false as no liquidation set', async () => {
        assert.isFalse(await liquidations.isOpenForLiquidation(account1));
      });
    });

    describe('should flags for liquidation', async () => {
      let timeOfTransaction;
      let transaction;

      beforeEach(async () => {
        timeOfTransaction = await currentTime();
        transaction = await liquidations.flagAccountForLiquidation(account1);
      });

      it('should sets a deadline liquidation delay of 2 hours', async () => {
        const liquidationDeadline = await liquidations.getLiquidationDeadlineForAccount(account1);
        assert.isTrue(liquidationDeadline.gt(0));
        assert.isTrue(liquidationDeadline.gt(timeOfTransaction));
        assert.isTrue(liquidationDeadline.gt(timeOfTransaction + 1 * 60 * 60 * 2));
      });

      it('should sets a deadline liquidation equal AccountFlaggedForLiquidation event', async () => {
        const liquidationDeadline = await liquidations.getLiquidationDeadlineForAccount(account1);
        assert.eventEqual(transaction, 'AccountFlaggedForLiquidation', { account: account1, deadline: liquidationDeadline });
      });

      it('should account flag and is openForLiquidation false', async () => {
        const accountIsOpen = await liquidations.isOpenForLiquidation(account1);
        assert.isFalse(accountIsOpen)
      });

      it('should account liquidation Deadline is passed false', async () => {
        const liquidationDeadlinePassed = await liquidations.isLiquidationDeadlinePassed(account1);
        assert.isFalse(liquidationDeadlinePassed)
      });

      it('should Account already flagged for liquidation', async () => {
        await assert.revert(
          liquidations.flagAccountForLiquidation(account1),
          'Account already flagged for liquidation'
        );
      });

      describe('when the price of DOWS increases and deadline has passed', async () => {
        beforeEach(async () => {
          const delay = await liquidations.liquidationDelay();

          // fast forward to after deadline
          await fastForward(delay + 100);

          await oracle.updateRates(
            [xETH, DOWS, xBTC],
            ["2000", "0.1", "30000"].map(toUnit),
            await currentTime(),
            { from: oracleAccount }
          );

          const liquidationRatio = await liquidations.liquidationRatio();

          const ratio = await synthesizer.collateralisationRatio(account1);
          const targetIssuanceRatio = await synthesizer.issuanceRatio();

          // check account1 ratio is below liquidation ratio
          assert.isTrue(ratio.lt(liquidationRatio));

          // check account1 ratio is below or equal to target issuance ratio
          assert.isTrue(ratio.lte(targetIssuanceRatio));

        });

        it('then account1 isLiquidationDeadlinePassed returns true', async () => {
          const deadlinePass = await liquidations.isLiquidationDeadlinePassed(account1);
          assert.isTrue(deadlinePass)
        });

        it('then account1 is not open for liquidation', async () => {
          const isOpenForLiquidation = await liquidations.isOpenForLiquidation(account1);
          assert.bnEqual(isOpenForLiquidation, false);
        });

      });

      describe('should issuance ratio is higher than the liquidation ratio', () => {
        let liquidationRatio;
        beforeEach(async () => {
          liquidationRatio = await liquidations.liquidationRatio();

          const ratio = await synthesizer.collateralisationRatio(account1);
          const targetIssuanceRatio = await synthesizer.issuanceRatio();
          // check account1 ratio is above or equal liquidation ratio
          assert.isTrue(ratio.gte(liquidationRatio));

          // check account1 ratio is above target issuance ratio
          assert.isTrue(ratio.gt(targetIssuanceRatio));
        });
        describe('when the liquidation deadline has not passed', () => {
          it('then isOpenForLiquidation returns false as deadline not passed', async () => {
            assert.isFalse(await liquidations.isOpenForLiquidation(account1));
          });
          it('then isLiquidationDeadlinePassed returns false', async () => {
            assert.isFalse(await liquidations.isLiquidationDeadlinePassed(account1));
          });
        });
        describe('fast forward 2 hours, when the liquidation deadline has passed', () => {
          beforeEach(async () => {
            const delay = await liquidations.liquidationDelay();

            await fastForward(delay + 100);

            await oracle.updateRates(
              [xETH, DOWS, xBTC],
              ["2000", "0.01", "30000"].map(toUnit),
              await currentTime(),
              { from: oracleAccount }
            );
          });
          it('then isLiquidationDeadlinePassed returns true', async () => {
            assert.isTrue(await liquidations.isLiquidationDeadlinePassed(account1));
          });
          it('then isOpenForLiquidation returns true', async () => {
            assert.isTrue(await liquidations.isOpenForLiquidation(account1));
          });
        });
      });

      describe('when the price of DOWS increases', () => {
        beforeEach(async () => {
          await oracle.updateRates(
            [xETH, DOWS, xBTC],
            ["2000", "0.1", "30000"].map(toUnit),
            await currentTime(),
            { from: oracleAccount }
          );
        });
        describe('should calls checkAndRemoveAccountInLiquidation', () => {
          beforeEach(async () => {
            await liquidations.checkAndRemoveAccountInLiquidation(
              account1,
            );
          });
          it('should liquidation entry is removed', async () => {
            const deadline = await liquidations.getLiquidationDeadlineForAccount(account1);
            assert.bnEqual(deadline, 0);
          });
          it('should account is not open for liquidation', async () => {
            const isOpenForLiquidation = await liquidations.isOpenForLiquidation(account1);
            assert.bnEqual(isOpenForLiquidation, false);
          });
        });
      });

      describe('given the liquidation deadline has passed ', () => {

        beforeEach(async () => {
          await fastForward(1 * 60 * 60 * 2 + 10);
          await oracle.updateRates(
            [xETH, DOWS, xBTC],
            ["2000", "0.01", "30000"].map(toUnit),
            await currentTime(),
            { from: oracleAccount }
          );
        });

        it('should c-ratio is above the liquidation Ratio', async () => {
          await oracle.updateRates(
            [xETH, DOWS, xBTC],
            ["2000", "0.1", "30000"].map(toUnit),
            await currentTime(),
            { from: oracleAccount }
          );

          await assert.revert(
            shadows.liquidateDelinquentAccount(account1, toUnit(20), {
              from: owner,
            }),
            'Account not open for liquidation'
          );
        });

      });

    });

  });

  describe('Given account1 has DOWS and never issued any debt', () => {
    beforeEach(async () => {
      await shadows.transfer(account1, toUnit('100'), { from: owner });
    });

    it('then she should not be able to be flagged for liquidation', async () => {
      await assert.revert(
        liquidations.flagAccountForLiquidation(account1),
        'Account issuance ratio is less than liquidation ratio'
      );
    });

    it('then liquidateDelinquentAccount fails', async () => {
      await assert.revert(
        shadows.liquidateDelinquentAccount(account1, toUnit('100')),
        'Account not open for liquidation'
      );
    });
  });

  describe('when collateral value is less than debt issued + penalty', async () => {
    beforeEach(async () => {
      const dowsAmount = [1000, 50000, 300000].map(item => toUnit(item));
      for (const index in testAccounts) {
        // tranfer account some DOWS
        await shadows.transfer(testAccounts[index], dowsAmount[index], {
          from: owner,
        });
      }

      // issue max xUSD
      for (const account of testAccounts) {
        const maxUSD = await synthesizer.maxIssuableSynths(account);
        await synthesizer.issueSynths(maxUSD, { from: account });
      }

      // account3 buy xETH for xUSD
      const maxUSD = await synthesizer.maxIssuableSynths(account3);
      await synthesizer.exchange(xUSD, maxUSD, xETH, {
        from: account3,
      });

      await oracle.updateRates(
        [xETH, DOWS, xBTC],
        ["2000", "0.01", "30000"].map(toUnit),
        await currentTime(),
        { from: oracleAccount }
      );

    });

    it('should collateral ratio should be greater than 1 (more debt than collateral)', async () => {
      const collateraRatio = await synthesizer.collateralisationRatio(account1);
      assert.isTrue(collateraRatio.gt(toUnit(1)));

      const debtBefore = await synthesizer.debtBalanceOf(account1, xUSD);
      const collateralBefore = await synthesizer.collateral(account1);

      const collateralInUSD = await oracle.effectiveValue(
        DOWS,
        collateralBefore,
        xUSD
      );
      assert.isTrue(debtBefore.gt(collateralInUSD));
    });

    describe('should account1 flag liquidate', async () => {
      beforeEach(async () => {
        await liquidations.flagAccountForLiquidation(account1);

        const liquidationDeadline = await liquidations.getLiquidationDeadlineForAccount(account1);

        await fastForward(liquidationDeadline + 1);

        await oracle.updateRates(
          [xETH, DOWS, xBTC],
          ["2000", "0.01", "30000"].map(toUnit),
          await currentTime(),
          { from: oracleAccount }
        );

        // transfer new DOWS and enough xUSD
        await shadows.transfer(account2, toUnit('100000'), {
          from: owner,
        });
        await synthesizer.issueMaxSynths({ from: account2 });

      });

      it('then account1 is openForLiquidation true', async () => {
        assert.isTrue(await liquidations.isOpenForLiquidation(account1));
      });

      describe('when DOWS is stale', async () => {
        beforeEach(async () => {
          await fastForward((await oracle.rateStalePeriod()).add(web3.utils.toBN('300')))
        });

        it('then liquidate reverts', async () => {
          await assert.revert(
            shadows.liquidateDelinquentAccount(account1, toUnit('20'), { from: owner }),
            'Rate stale or not a synth'
          );
        });
      });

      // describe('when liquidates all of collateral', async () => {
      //   beforeEach(async () => {
      //     await shadows.liquidateDelinquentAccount(account1, toUnit('20'), { from: owner });
      //   });

      //   it('should have 0 collateral', async () => {
      //     assert.bnEqual(await synthesizer.collateral(account1), toUnit('0'));
      //   });
      //   it('should have a collateral ratio of 0', async () => {
      //     const davidCRatioAfter = await synthesizer.collateralisationRatio(account1);
      //     assert.bnEqual(davidCRatioAfter, 0);
      //   });
      //   it('should still have debt owing', async () => {
      //     const davidDebt = await synthetix.debtBalanceOf(account1, xUSD);
      //     assert.isTrue(davidDebt.gt(0));
      //   });
      //   it('wont be open for liquidation', async () => {
      //     assert.isFalse(await liquidations.isOpenForLiquidation(account1));
      //   });
      // });

    });

  });

});