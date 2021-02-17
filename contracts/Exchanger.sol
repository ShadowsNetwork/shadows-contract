pragma solidity 0.4.25;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./SafeDecimalMath.sol";
import "./MixinResolver.sol";
import "./interfaces/IExchangeState.sol";
import "./interfaces/IExchangeRates.sol";
import "./interfaces/IShadows.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IIssuer.sol";


contract Exchanger is MixinResolver {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    bool public exchangeEnabled;

    bytes32 private constant xUSD = "xUSD";

    uint public waitingPeriodSecs;

    constructor(address _owner, address _resolver) public MixinResolver(_owner, _resolver) {
        exchangeEnabled = true;
        waitingPeriodSecs = 3 minutes;
    }

    /* ========== VIEWS ========== */

    function exchangeState() internal view returns (IExchangeState) {
        return IExchangeState(resolver.requireAndGetAddress("ExchangeState", "Missing ExchangeState address"));
    }

    function exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(resolver.requireAndGetAddress("ExchangeRates", "Missing ExchangeRates address"));
    }

    function shadows() internal view returns (IShadows) {
        return IShadows(resolver.requireAndGetAddress("Shadows", "Missing Shadows address"));
    }

    function feePool() internal view returns (IFeePool) {
        return IFeePool(resolver.requireAndGetAddress("FeePool", "Missing FeePool address"));
    }

    function maxSecsLeftInWaitingPeriod(address account, bytes32 currencyKey) public view returns (uint) {
        return secsLeftInWaitingPeriodForExchange(exchangeState().getMaxTimestamp(account, currencyKey));
    }

    // Determine the effective fee rate for the exchange, taking into considering swing trading
    function feeRateForExchange(bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey) public view returns (uint) {
        // Get the base exchange fee rate
        uint exchangeFeeRate = feePool().exchangeFeeRate();

        uint multiplier = 1;

        // Is this a swing trade? I.e. long to short or vice versa, excluding when going into or out of xUSD.
        // Note: this assumes shorts begin with 'i' and longs with 'x'.
        if (
            (sourceCurrencyKey[0] == 0x78 && sourceCurrencyKey != xUSD && destinationCurrencyKey[0] == 0x69) ||
            (sourceCurrencyKey[0] == 0x69 && destinationCurrencyKey != xUSD && destinationCurrencyKey[0] == 0x78)
        ) {
            // If so then double the exchange fee multipler
            multiplier = 2;
        }

        return exchangeFeeRate.mul(multiplier);
    }

    function settlementOwing(address account, bytes32 currencyKey)
        public
        view
        returns (uint reclaimAmount, uint rebateAmount)
    {
        // Need to sum up all reclaim and rebate amounts for the user and the currency key
        uint numEntries = exchangeState().getLengthOfEntries(account, currencyKey);

        // For each unsettled exchange
        for (uint i = 0; i < numEntries; i++) {
            // fetch the entry from storage
            (bytes32 src, uint amount, bytes32 dest, uint amountReceived, , , , ) = exchangeState().getEntryAt(
                account,
                currencyKey,
                i
            );

            // determine the last round ids for src and dest pairs when period ended or latest if not over
            (uint srcRoundIdAtPeriodEnd, uint destRoundIdAtPeriodEnd) = getRoundIdsAtPeriodEnd(account, currencyKey, i);

            // given these round ids, determine what effective value they should have received
            uint destinationAmount = exchangeRates().effectiveValueAtRound(
                src,
                amount,
                dest,
                srcRoundIdAtPeriodEnd,
                destRoundIdAtPeriodEnd
            );

            // and deduct the fee from this amount
            (uint amountShouldHaveReceived, ) = calculateExchangeAmountMinusFees(src, dest, destinationAmount);

            if (amountReceived > amountShouldHaveReceived) {
                // if they received more than they should have, add to the reclaim tally
                reclaimAmount = reclaimAmount.add(amountReceived.sub(amountShouldHaveReceived));
            } else if (amountShouldHaveReceived > amountReceived) {
                // if less, add to the rebate tally
                rebateAmount = rebateAmount.add(amountShouldHaveReceived.sub(amountReceived));
            }
        }

        return (reclaimAmount, rebateAmount);
    }

    /* ========== SETTERS ========== */

    function setWaitingPeriodSecs(uint _waitingPeriodSecs) external onlyOwner {
        waitingPeriodSecs = _waitingPeriodSecs;
    }

    function setExchangeEnabled(bool _exchangeEnabled) external onlyOwner {
        exchangeEnabled = _exchangeEnabled;
    }

    function calculateAmountAfterSettlement(address from, bytes32 currencyKey, uint amount, uint refunded)
        public
        view
        returns (uint amountAfterSettlement)
    {
        amountAfterSettlement = amount;

        // balance of a synth will show an amount after settlement
        uint balanceOfSourceAfterSettlement = shadows().synths(currencyKey).balanceOf(from);

        // when there isn't enough supply (either due to reclamation settlement or because the number is too high)
        if (amountAfterSettlement > balanceOfSourceAfterSettlement) {
            // then the amount to exchange is reduced to their remaining supply
            amountAfterSettlement = balanceOfSourceAfterSettlement;
        }

        if (refunded > 0) {
            amountAfterSettlement = amountAfterSettlement.add(refunded);
        }
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function exchange(
        address from,
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        address destinationAddress
    )
        external
        // Note: We don't need to insist on non-stale rates because effectiveValue will do it for us.
        onlyShadowsorSynth
        returns (uint amountReceived)
    {
        require(sourceCurrencyKey != destinationCurrencyKey, "Can't be same synth");
        require(sourceAmount > 0, "Zero amount");
        require(exchangeEnabled, "Exchanging is disabled");

        (, uint refunded) = _internalSettle(from, sourceCurrencyKey);

        IShadows _shadows = shadows();
        IExchangeRates _exRates = exchangeRates();

        uint sourceAmountAfterSettlement = calculateAmountAfterSettlement(from, sourceCurrencyKey, sourceAmount, refunded);

        // Note: We don't need to check their balance as the burn() below will do a safe subtraction which requires
        // the subtraction to not overflow, which would happen if their balance is not sufficient.

        // Burn the source amount
        _shadows.synths(sourceCurrencyKey).burn(from, sourceAmountAfterSettlement);

        uint destinationAmount = _exRates.effectiveValue(
            sourceCurrencyKey,
            sourceAmountAfterSettlement,
            destinationCurrencyKey
        );

        uint fee;

        (amountReceived, fee) = calculateExchangeAmountMinusFees(
            sourceCurrencyKey,
            destinationCurrencyKey,
            destinationAmount
        );

        // // Issue their new synths
        _shadows.synths(destinationCurrencyKey).issue(destinationAddress, amountReceived);

        // Remit the fee if required
        if (fee > 0) {
            remitFee(_exRates, _shadows, fee, destinationCurrencyKey);
        }

        // Nothing changes as far as issuance data goes because the total value in the system hasn't changed.

        // Let the DApps know there was a Synth exchange
        _shadows.emitSynthExchange(
            from,
            sourceCurrencyKey,
            sourceAmountAfterSettlement,
            destinationCurrencyKey,
            amountReceived,
            destinationAddress
        );

        // persist the exchange information for the dest key
        appendExchange(
            destinationAddress,
            sourceCurrencyKey,
            sourceAmountAfterSettlement,
            destinationCurrencyKey,
            amountReceived
        );
    }

    function settle(address from, bytes32 currencyKey) external returns (uint reclaimed, uint refunded) {
        // Note: this function can be called by anyone on behalf of anyone else

        return _internalSettle(from, currencyKey);
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    function remitFee(IExchangeRates _exRates, IShadows _shadows, uint fee, bytes32 currencyKey) internal {
        // Remit the fee in xUSDs
        uint usdFeeAmount = _exRates.effectiveValue(currencyKey, fee, xUSD);
        _shadows.synths(xUSD).issue(feePool().FEE_ADDRESS(), usdFeeAmount);
        // Tell the fee pool about this.
        feePool().recordFeePaid(usdFeeAmount);
    }

    function _internalSettle(address from, bytes32 currencyKey) internal returns (uint reclaimed, uint refunded) {
        require(maxSecsLeftInWaitingPeriod(from, currencyKey) == 0, "Cannot settle during waiting period");

        (uint reclaimAmount, uint rebateAmount) = settlementOwing(from, currencyKey);

        if (reclaimAmount > rebateAmount) {
            reclaimed = reclaimAmount.sub(rebateAmount);
            reclaim(from, currencyKey, reclaimed);
        } else if (rebateAmount > reclaimAmount) {
            refunded = rebateAmount.sub(reclaimAmount);
            refund(from, currencyKey, refunded);
        }

        // Now remove all entries, even if no reclaim and no rebate
        exchangeState().removeEntries(from, currencyKey);
    }

    function reclaim(address from, bytes32 currencyKey, uint amount) internal {
        // burn amount from user
        shadows().synths(currencyKey).burn(from, amount);
        shadows().emitExchangeReclaim(from, currencyKey, amount);
    }

    function refund(address from, bytes32 currencyKey, uint amount) internal {
        // issue amount to user
        shadows().synths(currencyKey).issue(from, amount);
        shadows().emitExchangeRebate(from, currencyKey, amount);
    }

    function secsLeftInWaitingPeriodForExchange(uint timestamp) internal view returns (uint) {
        if (timestamp == 0 || now >= timestamp.add(waitingPeriodSecs)) {
            return 0;
        }

        return timestamp.add(waitingPeriodSecs).sub(now);
    }

    function calculateExchangeAmountMinusFees(
        bytes32 sourceCurrencyKey,
        bytes32 destinationCurrencyKey,
        uint destinationAmount
    ) internal view returns (uint amountReceived, uint fee) {
        // What's the fee on that currency that we should deduct?
        amountReceived = destinationAmount;

        // Get the exchange fee rate
        uint exchangeFeeRate = feeRateForExchange(sourceCurrencyKey, destinationCurrencyKey);

        amountReceived = destinationAmount.multiplyDecimal(SafeDecimalMath.unit().sub(exchangeFeeRate));

        fee = destinationAmount.sub(amountReceived);
    }

    function appendExchange(address account, bytes32 src, uint amount, bytes32 dest, uint amountReceived) internal {
        IExchangeRates exRates = exchangeRates();
        uint roundIdForSrc = exRates.getCurrentRoundId(src);
        uint roundIdForDest = exRates.getCurrentRoundId(dest);
        uint exchangeFeeRate = feePool().exchangeFeeRate();
        exchangeState().appendExchangeEntry(
            account,
            src,
            amount,
            dest,
            amountReceived,
            exchangeFeeRate,
            now,
            roundIdForSrc,
            roundIdForDest
        );
    }

    function getRoundIdsAtPeriodEnd(address account, bytes32 currencyKey, uint index)
        internal
        view
        returns (uint srcRoundIdAtPeriodEnd, uint destRoundIdAtPeriodEnd)
    {
        (bytes32 src, , bytes32 dest, , , uint timestamp, uint roundIdForSrc, uint roundIdForDest) = exchangeState()
            .getEntryAt(account, currencyKey, index);

        IExchangeRates exRates = exchangeRates();
        srcRoundIdAtPeriodEnd = exRates.getLastRoundIdBeforeElapsedSecs(src, roundIdForSrc, timestamp, waitingPeriodSecs);
        destRoundIdAtPeriodEnd = exRates.getLastRoundIdBeforeElapsedSecs(dest, roundIdForDest, timestamp, waitingPeriodSecs);
    }

    // ========== MODIFIERS ==========

    modifier onlyShadowsorSynth() {
        IShadows _shadows = shadows();
        require(
            msg.sender == address(_shadows) || _shadows.synthsByAddress(msg.sender) != bytes32(0),
            "Exchanger: Only shadows or a synth contract can perform this action"
        );
        _;
    }
}
