// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "./library/AddressResolverUpgradeable.sol";
import "./library/SafeDecimalMath.sol";
import "./interfaces/ISynthesizer.sol";
import "./interfaces/IRewardEscrow.sol";

contract FeePool is
    Initializable,
    OwnableUpgradeable,
    AddressResolverUpgradeable
{
    using SafeMath for uint256;
    using SafeDecimalMath for uint256;

    address public feePool;

    // The IssuanceData activity that's happened in a fee period.
    struct IssuanceData {
        uint256 debtPercentage;
        uint256 debtEntryIndex;
    }

    uint8 public constant FEE_PERIOD_LENGTH = 3;

    uint256 public BONUS_REWARDS;

    mapping(address => uint256) lastFeeWithdrawalStorage;

    // The IssuanceData activity that's happened in a fee period.
    mapping(address => IssuanceData[FEE_PERIOD_LENGTH])
        public accountIssuanceLedger;

    uint256 public exchangeFeeRate;

    address public constant FEE_ADDRESS =
        0x43707C6Bb6202a5E1007356539a925C052EA9767;

    bytes32 private constant xUSD = "ShaUSD";

    // This struct represents the issuance activity that's happened in a fee period.
    struct FeePeriod {
        uint64 feePeriodId;
        uint64 startingDebtIndex;
        uint64 startTime;
        uint256 feesToDistribute;
        uint256 feesClaimed;
        uint256 rewardsToDistribute;
        uint256 rewardsClaimed;
    }

    FeePeriod[FEE_PERIOD_LENGTH] private _recentFeePeriods;
    uint256 private _currentFeePeriod;

    uint256 public feePeriodDuration;

    // Users are unable to claim fees if their collateralisation ratio drifts out of target treshold
    uint256 public targetThreshold;

    function initialize(uint256 _exchangeFeeRate, address _resolver)
        external
        initializer
    {
        __Ownable_init();
        __AddressResolver_init(_resolver);
        feePeriodDuration = 1 weeks;
        exchangeFeeRate = _exchangeFeeRate;
        BONUS_REWARDS = 1;
    }

    function setRewardsMultiplier(uint256 multiplierNumber) public onlyOwner {
        BONUS_REWARDS = multiplierNumber;
    }

    function setExchangeFeeRate(uint256 _exchangeFeeRate) external onlyOwner {
        require(
            _exchangeFeeRate < SafeDecimalMath.unit() / 10,
            "rate < MAX_EXCHANGE_FEE_RATE"
        );
        exchangeFeeRate = _exchangeFeeRate;
    }

    function setFeePeriodDuration(uint256 _feePeriodDuration) public onlyOwner {
        feePeriodDuration = _feePeriodDuration;
        emit FeePeriodDurationUpdated(_feePeriodDuration);
    }

    function setTargetThreshold(uint256 _percent) public onlyOwner {
        require(_percent >= 0, "Threshold should be positive");
        require(_percent <= 50, "Threshold too high");
        targetThreshold = _percent.mul(SafeDecimalMath.unit()).div(100);
    }

    function initFeePaid() public onlyOwner {
        for (uint256 i = 0; i < FEE_PERIOD_LENGTH; i++) {
            delete _recentFeePeriods[i];
        }
    }

    function recordFeePaid(uint256 amount) external onlyExchangerOrSynth {
        // Keep track off fees in xUSD in the open fee pool period.
        _recentFeePeriodsStorage(0).feesToDistribute = _recentFeePeriodsStorage(
            0
        )
            .feesToDistribute
            .add(amount);
    }

    function recordRewardPaid(uint256 amount) external onlyExchangerOrSynth {
        // Keep track off fees in xUSD in the open fee pool period.
        _recentFeePeriodsStorage(0).rewardsToDistribute = _recentFeePeriodsStorage(
            0
        )
            .rewardsToDistribute
            .add(amount.mul(BONUS_REWARDS));
    }

    function recentFeePeriods(uint256 index)
        external
        view
        returns (
            uint64 feePeriodId,
            uint64 startingDebtIndex,
            uint64 startTime,
            uint256 feesToDistribute,
            uint256 feesClaimed,
            uint256 rewardsToDistribute,
            uint256 rewardsClaimed
        )
    {
        FeePeriod memory feePeriod = _recentFeePeriodsStorage(index);
        return (
            feePeriod.feePeriodId,
            feePeriod.startingDebtIndex,
            feePeriod.startTime,
            feePeriod.feesToDistribute,
            feePeriod.feesClaimed,
            feePeriod.rewardsToDistribute,
            feePeriod.rewardsClaimed
        );
    }

    /**
     * @notice Close the current fee period and start a new one.
     */
    function closeCurrentFeePeriod() external {
        require(
            _recentFeePeriodsStorage(0).startTime <= (block.timestamp - feePeriodDuration),
            "Too early to close fee period"
        );

        FeePeriod storage secondLastFeePeriod =
            _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 2);
        FeePeriod storage lastFeePeriod =
            _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 1);

        // Any unclaimed fees from the last period in the array roll back one period.
        // Because of the subtraction here, they're effectively proportionally redistributed to those who
        // have already claimed from the old period, available in the new period.
        // The subtraction is important so we don't create a ticking time bomb of an ever growing
        // number of fees that can never decrease and will eventually overflow at the end of the fee pool.
        _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 2)
            .feesToDistribute = lastFeePeriod
            .feesToDistribute
            .sub(lastFeePeriod.feesClaimed)
            .add(secondLastFeePeriod.feesToDistribute);
        _recentFeePeriodsStorage(FEE_PERIOD_LENGTH - 2)
            .rewardsToDistribute = lastFeePeriod
            .rewardsToDistribute
            .sub(lastFeePeriod.rewardsClaimed)
            .add(secondLastFeePeriod.rewardsToDistribute);

        // Shift the previous fee periods across to make room for the new one.
        _currentFeePeriod = _currentFeePeriod.add(FEE_PERIOD_LENGTH).sub(1).mod(
            FEE_PERIOD_LENGTH
        );

        // Clear the first element of the array to make sure we don't have any stale values.
        delete _recentFeePeriods[_currentFeePeriod];

        // Open up the new fee period.
        // Increment periodId from the recent closed period feePeriodId
        _recentFeePeriodsStorage(0).feePeriodId = uint64(
            uint256(_recentFeePeriodsStorage(1).feePeriodId).add(1)
        );
        _recentFeePeriodsStorage(0).startingDebtIndex = uint64(
            synthesizer().debtLedgerLength()
        );
        _recentFeePeriodsStorage(0).startTime = uint64(block.timestamp);

        emit FeePeriodClosed(_recentFeePeriodsStorage(1).feePeriodId);
    }

    function claimFees() external returns (bool) {
        return _claimFees(_msgSender());
    }

    function _claimFees(address claimingAddress) internal returns (bool) {
        uint256 rewardsPaid = 0;
        uint256 feesPaid = 0;
        uint256 availableFees;
        uint256 availableRewards;

        // Address won't be able to claim fees if it is too far below the target c-ratio.
        // It will need to burn synths then try claiming again.
        require(
            isFeesClaimable(claimingAddress),
            "C-Ratio below penalty threshold"
        );

        (availableFees, availableRewards) = feesAvailable(claimingAddress);

        require(
            availableFees > 0 || availableRewards > 0,
            "No fees or rewards available for period, or fees already claimed"
        );

        _setLastFeeWithdrawal(
            claimingAddress,
            _recentFeePeriodsStorage(1).feePeriodId
        );

        if (availableFees > 0) {
            feesPaid = _recordFeePayment(availableFees);

            _payFees(claimingAddress, feesPaid);
        }

        if (availableRewards > 0) {
            rewardsPaid = _recordRewardPayment(availableRewards);

            _payRewards(claimingAddress, rewardsPaid);
        }

        emit FeesClaimed(claimingAddress, feesPaid, rewardsPaid);

        return true;
    }

    function isFeesClaimable(address account) public view returns (bool) {
        // Threshold is calculated from ratio % above the target ratio (issuanceRatio).
        //  0  <  10%:   Claimable
        // 10% > above:  Unable to claim
        uint256 ratio = synthesizer().collateralisationRatio(account);
        uint256 targetRatio = synthesizer().issuanceRatio();

        if (ratio < targetRatio) {
            return true;
        }

        // Calculate the threshold for collateral ratio before fees can't be claimed.
        uint256 ratio_threshold =
            targetRatio.multiplyDecimal(
                SafeDecimalMath.unit().add(targetThreshold)
            );

        // Not claimable if collateral ratio above threshold
        if (ratio > ratio_threshold) {
            return false;
        }

        return true;
    }

    function feesAvailable(address account)
        public
        view
        returns (uint256, uint256)
    {
        // Add up the fees
        uint256[2][FEE_PERIOD_LENGTH] memory userFees = feesByPeriod(account);

        uint256 totalFees = 0;
        uint256 totalRewards = 0;

        // Fees & Rewards in fee period [0] are not yet available for withdrawal
        for (uint256 i = 1; i < FEE_PERIOD_LENGTH; i++) {
            totalFees = totalFees.add(userFees[i][0]);
            totalRewards = totalRewards.add(userFees[i][1]);
        }

        // And convert totalFees to xUSD
        // Return totalRewards as is in DOWS amount
        return (totalFees, totalRewards);
    }

    function feesByPeriod(address account)
        public
        view
        returns (uint256[2][FEE_PERIOD_LENGTH] memory results)
    {
        // What's the user's debt entry index and the debt they owe to the system at current feePeriod
        uint256 userOwnershipPercentage;
        uint256 debtEntryIndex;

        (userOwnershipPercentage, debtEntryIndex) = _getAccountsDebtEntry(
            account,
            0
        );

        // If they don't have any debt ownership and they never minted, they don't have any fees.
        // User ownership can reduce to 0 if user burns all synths,
        // however they could have fees applicable for periods they had minted in before so we check debtEntryIndex.
        if (debtEntryIndex == 0 && userOwnershipPercentage == 0) return results;

        // The [0] fee period is not yet ready to claim, but it is a fee period that they can have
        // fees owing for, so we need to report on it anyway.
        uint256 feesFromPeriod;
        uint256 rewardsFromPeriod;
        (feesFromPeriod, rewardsFromPeriod) = _feesAndRewardsFromPeriod(
            0,
            userOwnershipPercentage,
            debtEntryIndex
        );

        results[0][0] = feesFromPeriod;
        results[0][1] = rewardsFromPeriod;

        // Retrieve user's last fee claim by periodId
        uint256 lastFeeWithdrawal = getLastFeeWithdrawal(account);

        // Go through our fee periods from the oldest feePeriod[FEE_PERIOD_LENGTH - 1] and figure out what we owe them.
        // Condition checks for periods > 0
        for (uint256 i = FEE_PERIOD_LENGTH - 1; i > 0; i--) {
            uint256 next = i - 1;
            uint256 nextPeriodStartingDebtIndex =
                _recentFeePeriodsStorage(next).startingDebtIndex;

            // We can skip the period, as no debt minted during period (next period's startingDebtIndex is still 0)
            if (
                nextPeriodStartingDebtIndex > 0 &&
                lastFeeWithdrawal < _recentFeePeriodsStorage(i).feePeriodId
            ) {
                // We calculate a feePeriod's closingDebtIndex by looking at the next feePeriod's startingDebtIndex
                // we can use the most recent issuanceData[0] for the current feePeriod
                // else find the applicableIssuanceData for the feePeriod based on the StartingDebtIndex of the period
                uint256 closingDebtIndex =
                    uint256(nextPeriodStartingDebtIndex).sub(1);

                // Gas optimisation - to reuse debtEntryIndex if found new applicable one
                // if applicable is 0,0 (none found) we keep most recent one from issuanceData[0]
                // return if userOwnershipPercentage = 0)
                (
                    userOwnershipPercentage,
                    debtEntryIndex
                ) = _applicableIssuanceData(account, closingDebtIndex);

                (feesFromPeriod, rewardsFromPeriod) = _feesAndRewardsFromPeriod(
                    i,
                    userOwnershipPercentage,
                    debtEntryIndex
                );

                results[i][0] = feesFromPeriod;
                results[i][1] = rewardsFromPeriod;
            }
        }
        return results;
    }

    function getLastFeeWithdrawal(address _claimingAddress)
        public
        view
        returns (uint256)
    {
        return lastFeeWithdrawalStorage[_claimingAddress];
    }

    function _setLastFeeWithdrawal(
        address _claimingAddress,
        uint256 _feePeriodID
    ) internal {
        lastFeeWithdrawalStorage[_claimingAddress] = _feePeriodID;
    }

    function _getAccountsDebtEntry(address account, uint256 index)
        internal
        view
        returns (uint256 debtPercentage, uint256 debtEntryIndex)
    {
        require(
            index < FEE_PERIOD_LENGTH,
            "index exceeds the FEE_PERIOD_LENGTH"
        );

        debtPercentage = accountIssuanceLedger[account][index].debtPercentage;
        debtEntryIndex = accountIssuanceLedger[account][index].debtEntryIndex;
    }

    function _applicableIssuanceData(address account, uint256 closingDebtIndex)
        internal
        view
        returns (uint256, uint256)
    {
        IssuanceData[FEE_PERIOD_LENGTH] memory issuanceData =
            accountIssuanceLedger[account];

        // We want to use the user's debtEntryIndex at when the period closed
        // Find the oldest debtEntryIndex for the corresponding closingDebtIndex
        for (uint256 i = 0; i < FEE_PERIOD_LENGTH; i++) {
            if (closingDebtIndex >= issuanceData[i].debtEntryIndex) {
                return (
                    issuanceData[i].debtPercentage,
                    issuanceData[i].debtEntryIndex
                );
            }
        }
    }

    function _feesAndRewardsFromPeriod(
        uint256 period,
        uint256 ownershipPercentage,
        uint256 debtEntryIndex
    ) internal view returns (uint256, uint256) {
        // If it's zero, they haven't issued, and they have no fees OR rewards.
        if (ownershipPercentage == 0) return (0, 0);

        uint256 debtOwnershipForPeriod = ownershipPercentage;

        // If period has closed we want to calculate debtPercentage for the period
        if (period > 0) {
            uint256 closingDebtIndex =
                uint256(_recentFeePeriodsStorage(period - 1).startingDebtIndex)
                    .sub(1);
            debtOwnershipForPeriod = _effectiveDebtRatioForPeriod(
                closingDebtIndex,
                ownershipPercentage,
                debtEntryIndex
            );
        }

        // Calculate their percentage of the fees / rewards in this period
        // This is a high precision integer.
        uint256 feesFromPeriod =
            _recentFeePeriodsStorage(period).feesToDistribute.multiplyDecimal(
                debtOwnershipForPeriod
            );

        uint256 rewardsFromPeriod =
            _recentFeePeriodsStorage(period)
                .rewardsToDistribute
                .multiplyDecimal(debtOwnershipForPeriod);

        return (
            feesFromPeriod.preciseDecimalToDecimal(),
            rewardsFromPeriod.preciseDecimalToDecimal()
        );
    }

    function _recentFeePeriodsStorage(uint256 index)
        internal
        view
        returns (FeePeriod storage)
    {
        return
            _recentFeePeriods[(_currentFeePeriod + index) % FEE_PERIOD_LENGTH];
    }

    function _effectiveDebtRatioForPeriod(
        uint256 closingDebtIndex,
        uint256 ownershipPercentage,
        uint256 debtEntryIndex
    ) internal view returns (uint256) {
        // Figure out their global debt percentage delta at end of fee Period.
        // This is a high precision integer.
        uint256 feePeriodDebtOwnership =
            synthesizer()
                .debtLedger(closingDebtIndex)
                .divideDecimalRoundPrecise(synthesizer().debtLedger(debtEntryIndex))
                .multiplyDecimalRoundPrecise(ownershipPercentage);

        return feePeriodDebtOwnership;
    }

    function _recordFeePayment(uint256 xUSDAmount) internal returns (uint256) {
        // Don't assign to the parameter
        uint256 remainingToAllocate = xUSDAmount;

        uint256 feesPaid;
        // Start at the oldest period and record the amount, moving to newer periods
        // until we've exhausted the amount.
        // The condition checks for overflow because we're going to 0 with an unsigned int.
        for (uint256 i = FEE_PERIOD_LENGTH - 1; i < FEE_PERIOD_LENGTH; i--) {
            uint256 feesAlreadyClaimed =
                _recentFeePeriodsStorage(i).feesClaimed;
            uint256 delta =
                _recentFeePeriodsStorage(i).feesToDistribute.sub(
                    feesAlreadyClaimed
                );

            if (delta > 0) {
                // Take the smaller of the amount left to claim in the period and the amount we need to allocate
                uint256 amountInPeriod =
                    delta < remainingToAllocate ? delta : remainingToAllocate;

                _recentFeePeriodsStorage(i).feesClaimed = feesAlreadyClaimed
                    .add(amountInPeriod);
                remainingToAllocate = remainingToAllocate.sub(amountInPeriod);
                feesPaid = feesPaid.add(amountInPeriod);

                // No need to continue iterating if we've recorded the whole amount;
                if (remainingToAllocate == 0) return feesPaid;

                // We've exhausted feePeriods to distribute and no fees remain in last period
                // User last to claim would in this scenario have their remainder slashed
                if (i == 0 && remainingToAllocate > 0) {
                    remainingToAllocate = 0;
                }
            }
        }

        return feesPaid;
    }

    function _payFees(address account, uint256 xUSDAmount)
        internal
        notFeeAddress(account)
    {
        // Checks not really possible but rather gaurds for the internal code.
        require(
            account != address(0) ||
                account != address(this) ||
                account != address(synthesizer()),
            "Can't send fees to this address"
        );

        // Grab the xUSD Synth
        Synth xUSDSynth = synthesizer().synths(xUSD);

        // NOTE: we do not control the FEE_ADDRESS so it is not possible to do an
        // ERC20.approve() transaction to allow this feePool to call ERC20.transferFrom
        // to the accounts address

        // Burn the source amount
        xUSDSynth.burn(FEE_ADDRESS, xUSDAmount);

        // Mint their new synths
        xUSDSynth.issue(account, xUSDAmount);
    }

    function _recordRewardPayment(uint256 dowsAmount)
        internal
        returns (uint256)
    {
        // Don't assign to the parameter
        uint256 remainingToAllocate = dowsAmount;

        uint256 rewardPaid;

        // Start at the oldest period and record the amount, moving to newer periods
        // until we've exhausted the amount.
        // The condition checks for overflow because we're going to 0 with an unsigned int.
        for (uint256 i = FEE_PERIOD_LENGTH - 1; i < FEE_PERIOD_LENGTH; i--) {
            uint256 toDistribute =
                _recentFeePeriodsStorage(i).rewardsToDistribute.sub(
                    _recentFeePeriodsStorage(i).rewardsClaimed
                );

            if (toDistribute > 0) {
                // Take the smaller of the amount left to claim in the period and the amount we need to allocate
                uint256 amountInPeriod =
                    toDistribute < remainingToAllocate
                        ? toDistribute
                        : remainingToAllocate;

                _recentFeePeriodsStorage(i)
                    .rewardsClaimed = _recentFeePeriodsStorage(i)
                    .rewardsClaimed
                    .add(amountInPeriod);
                remainingToAllocate = remainingToAllocate.sub(amountInPeriod);
                rewardPaid = rewardPaid.add(amountInPeriod);

                // No need to continue iterating if we've recorded the whole amount;
                if (remainingToAllocate == 0) return rewardPaid;

                // We've exhausted feePeriods to distribute and no rewards remain in last period
                // User last to claim would in this scenario have their remainder slashed
                // due to rounding up of PreciseDecimal
                if (i == 0 && remainingToAllocate > 0) {
                    remainingToAllocate = 0;
                }
            }
        }
        return rewardPaid;
    }

    function _payRewards(address account, uint256 dowsAmount)
        internal
        notFeeAddress(account)
    {
        require(account != address(0), "Account can't be 0");
        require(account != address(this), "Can't send rewards to fee pool");
        require(account != address(synthesizer()), "Can't send rewards to shadows");

        // Record vesting entry for claiming address and amount
        // DOWS already minted to rewardEscrow balance
        rewardEscrow().appendVestingEntry(account, dowsAmount);
    }

    /**
     * @dev onlyIssuer to call me on shadows.issue() & shadows.burn() calls to store the locked DOWS
     * per fee period so we know to allocate the correct proportions of fees and rewards per period
     */
    function appendAccountIssuanceRecord(
        address account,
        uint256 debtRatio,
        uint256 debtEntryIndex
    ) external onlySynthesizer {
        _appendAccountIssuanceRecord(
            account,
            debtRatio,
            debtEntryIndex,
            _recentFeePeriodsStorage(0).startingDebtIndex
        );

        emit IssuanceDebtRatioEntry(
            account,
            debtRatio,
            debtEntryIndex,
            _recentFeePeriodsStorage(0).startingDebtIndex
        );
    }

    function _appendAccountIssuanceRecord(
        address account,
        uint256 debtRatio,
        uint256 debtEntryIndex,
        uint256 currentPeriodStartDebtIndex
    ) private {
        // Is the current debtEntryIndex within this fee period
        if (
            accountIssuanceLedger[account][0].debtEntryIndex <
            currentPeriodStartDebtIndex
        ) {
            // If its older then shift the previous IssuanceData entries periods down to make room for the new one.
            issuanceDataIndexOrder(account);
        }

        // Always store the latest IssuanceData entry at [0]
        accountIssuanceLedger[account][0].debtPercentage = debtRatio;
        accountIssuanceLedger[account][0].debtEntryIndex = debtEntryIndex;
    }

    function issuanceDataIndexOrder(address account) private {
        for (uint256 i = FEE_PERIOD_LENGTH - 2; i < FEE_PERIOD_LENGTH; i--) {
            uint256 next = i + 1;
            accountIssuanceLedger[account][next]
                .debtPercentage = accountIssuanceLedger[account][i]
                .debtPercentage;
            accountIssuanceLedger[account][next]
                .debtEntryIndex = accountIssuanceLedger[account][i]
                .debtEntryIndex;
        }
    }

    modifier onlyExchangerOrSynth {
        bool isExchanger = msg.sender == address(exchanger());
        bool isSynth = synthesizer().synthsByAddress(msg.sender) != bytes32(0);

        require(isExchanger || isSynth, "Only Exchanger, Synths Authorised");
        _;
    }

    function synthesizer() internal view returns (ISynthesizer) {
        return
            ISynthesizer(
                resolver.requireAndGetAddress(
                    "Synthesizer",
                    "Missing Synthesizer address"
                )
            );
    }

    function exchanger() internal view returns (IExchanger) {
        return
            IExchanger(
                resolver.requireAndGetAddress(
                    "Exchanger",
                    "Missing Exchanger address"
                )
            );
    }

    function rewardEscrow() internal view returns (IRewardEscrow) {
        return
            IRewardEscrow(
                resolver.requireAndGetAddress(
                    "RewardEscrow",
                    "Missing RewardEscrow address"
                )
            );
    }

    modifier onlySynthesizer {
        require(
            msg.sender == address(synthesizer()),
            "FeePool: Only Issuer Authorised"
        );
        _;
    }

    modifier onlyExchanger {
        require(
            msg.sender == address(exchanger()),
            "FeePool: Only Exchanger Authorised"
        );
        _;
    }

    modifier notFeeAddress(address account) {
        require(account != FEE_ADDRESS, "Fee address not allowed");
        _;
    }

    event FeePeriodDurationUpdated(uint256 newFeePeriodDuration);

    event IssuanceDebtRatioEntry(
        address account,
        uint256 debtRatio,
        uint256 debtEntryIndex,
        uint256 feePeriodStartingDebtIndex
    );

    event FeePeriodClosed(uint256 feePeriodId);

    event FeesClaimed(address account, uint256 xUSDAmount, uint256 dowsRewards);
}
