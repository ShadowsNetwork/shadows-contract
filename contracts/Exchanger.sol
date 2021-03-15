// SPDX-License-Identifier: MIT
pragma solidity 0.6.11;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol"
import "./library/SafeDecimalMath.sol";
import "./library/AddressResolverUpgradeable.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/IShadows.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IIssuer.sol";


contract Exchanger is Initializable, OwnableUpgradeable,AddressResolverUpgradeable{
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    bool public exchangeEnabled;

    bytes32 private constant xUSD = "xUSD";

    function initialize(
        address _resolver
    ) external initializer {
        __Ownable_init();
        __AddressResolver_init(_resolver);
        exchangeEnabled = true;
    }

    function oracle() internal view returns (IOracle) {
        return IOracle(resolver.requireAndGetAddress("IOracle", "Missing Oracle address"));
    }

    function shadows() internal view returns (IShadows) {
        return IShadows(resolver.requireAndGetAddress("Shadows", "Missing Shadows address"));
    }

    function feePool() internal view returns (IFeePool) {
        return IFeePool(resolver.requireAndGetAddress("FeePool", "Missing FeePool address"));
    }

    function setExchangeEnabled(bool _exchangeEnabled) external onlyOwner {
        exchangeEnabled = _exchangeEnabled;
    }

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
        IOracle _oracle = oracle();

        _shadows.synths(sourceCurrencyKey).burn(from, sourceAmount);

        uint destinationAmount = _oracle.effectiveValue(
            sourceCurrencyKey,
            sourceAmount,
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
            remitFee(_oracle, _shadows, fee, destinationCurrencyKey);
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
    }


    function remitFee(IOracle _oracle, IShadows _shadows, uint fee, bytes32 currencyKey) internal {
        // Remit the fee in xUSDs
        uint usdFeeAmount = _oracle.effectiveValue(currencyKey, fee, xUSD);
        _shadows.synths(xUSD).issue(feePool().FEE_ADDRESS(), usdFeeAmount);
        // Tell the fee pool about this.
        feePool().recordFeePaid(usdFeeAmount);
    }


    function calculateExchangeAmountMinusFees(
        bytes32 sourceCurrencyKey,
        bytes32 destinationCurrencyKey,
        uint destinationAmount
    ) internal view returns (uint amountReceived, uint fee) {
        // What's the fee on that currency that we should deduct?
        amountReceived = destinationAmount;

        // Get the exchange fee rate
        uint exchangeFeeRate = feePool().exchangeFeeRate();

        amountReceived = destinationAmount.multiplyDecimal(SafeDecimalMath.unit().sub(exchangeFeeRate));

        fee = destinationAmount.sub(amountReceived);
    }


    modifier onlyShadowsorSynth() {
        IShadows _shadows = shadows();
        require(
            msg.sender == address(_shadows) || _shadows.synthsByAddress(msg.sender) != bytes32(0),
            "Exchanger: Only shadows or a synth contract can perform this action"
        );
        _;
    }
}
