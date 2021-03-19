// SPDX-License-Identifier: MIT
pragma solidity 0.6.11;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "./library/SafeDecimalMath.sol";
import "./library/AddressResolverUpgradeable.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/IShadows.sol";
import "./interfaces/IFeePool.sol";

contract Exchanger is
    Initializable,
    AddressResolverUpgradeable
{
    using SafeMath for uint256;
    using SafeDecimalMath for uint256;

    bool public exchangeEnabled;

    bytes32 private constant xUSD = "xUSD";

    function initialize(address _resolver) external initializer {
        __Ownable_init();
        __AddressResolver_init(_resolver);
        exchangeEnabled = true;
    }

    function exchange(
        address from,
        bytes32 sourceCurrencyKey,
        uint256 sourceAmount,
        bytes32 destinationCurrencyKey,
        address destinationAddress
    ) external onlyShadowsorSynth returns (uint256 amountReceived) {
        require(
            sourceCurrencyKey != destinationCurrencyKey,
            "Can't be same synth"
        );
        require(sourceAmount > 0, "Zero amount");
        require(exchangeEnabled, "Exchanging is disabled");

        IShadows _shadows = shadows();
        IOracle _oracle = oracle();

        _shadows.synths(sourceCurrencyKey).burn(from, sourceAmount);

        uint256 destinationAmount =
            _oracle.effectiveValue(
                sourceCurrencyKey,
                sourceAmount,
                destinationCurrencyKey
            );

        uint256 fee;

        (amountReceived, fee) = calculateExchangeAmountMinusFees(
            sourceCurrencyKey,
            destinationCurrencyKey,
            destinationAmount
        );

        // // Issue their new synths
        _shadows.synths(destinationCurrencyKey).issue(
            destinationAddress,
            amountReceived
        );

        // Remit the fee if required
        if (fee > 0) {
            remitFee(_oracle, _shadows, fee, destinationCurrencyKey);
        }

        // Nothing changes as far as issuance data goes because the total value in the system hasn't changed.

        // Let the DApps know there was a Synth exchange
        _shadows.emitSynthExchange(
            from,
            sourceCurrencyKey,
            sourceAmount,
            destinationCurrencyKey,
            amountReceived,
            destinationAddress
        );
    }

    function remitFee(
        IOracle _oracle,
        IShadows _shadows,
        uint256 fee,
        bytes32 currencyKey
    ) internal {
        // Remit the fee in xUSDs
        uint256 usdFeeAmount = _oracle.effectiveValue(currencyKey, fee, xUSD);
        _shadows.synths(xUSD).issue(feePool().getFeeAddress(), usdFeeAmount);
        // Tell the fee pool about this.
        feePool().recordFeePaid(usdFeeAmount);
    }

    function calculateExchangeAmountMinusFees(
        bytes32 sourceCurrencyKey,
        bytes32 destinationCurrencyKey,
        uint256 destinationAmount
    ) internal view returns (uint256 amountReceived, uint256 fee) {
        // What's the fee on that currency that we should deduct?
        amountReceived = destinationAmount;

        // Get the exchange fee rate
        uint256 exchangeFeeRate = feePool().getExchangeFeeRate();

        amountReceived = destinationAmount.multiplyDecimal(
            SafeDecimalMath.unit().sub(exchangeFeeRate)
        );

        fee = destinationAmount.sub(amountReceived);
    }

    function setExchangeEnabled(bool _exchangeEnabled) external onlyOwner {
        exchangeEnabled = _exchangeEnabled;
    }

    function oracle() internal view returns (IOracle) {
        return
            IOracle(
                resolver.requireAndGetAddress(
                    "IOracle",
                    "Missing Oracle address"
                )
            );
    }

    function shadows() internal view returns (IShadows) {
        return
            IShadows(
                resolver.requireAndGetAddress(
                    "Shadows",
                    "Missing Shadows address"
                )
            );
    }

    function feePool() internal view returns (IFeePool) {
        return
            IFeePool(
                resolver.requireAndGetAddress(
                    "FeePool",
                    "Missing FeePool address"
                )
            );
    }

    modifier onlyShadowsorSynth() {
        IShadows _shadows = shadows();
        require(
            msg.sender == address(_shadows) ||
                _shadows.synthsByAddress(msg.sender) != bytes32(0),
            "Exchanger: Only shadows or a synth contract can perform this action"
        );
        _;
    }
}
