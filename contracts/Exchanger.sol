// SPDX-License-Identifier: MIT
pragma solidity 0.6.11;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "./library/SafeDecimalMath.sol";
import "./library/AddressResolverUpgradeable.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/ISynthesizer.sol";
import "./interfaces/IFeePool.sol";

contract Exchanger is Initializable, AddressResolverUpgradeable {
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
    ) external onlySynthesizerOrSynth returns (uint256 amountReceived) {
        require(
            sourceCurrencyKey != destinationCurrencyKey,
            "Can't be same synth"
        );
        require(sourceAmount > 0, "Zero amount");
        require(exchangeEnabled, "Exchanging is disabled");

        ISynthesizer _synthesizer = synthesizer();
        IOracle _oracle = oracle();

        _synthesizer.synths(sourceCurrencyKey).burn(from, sourceAmount);

        uint256 destinationAmount =
            _oracle.effectiveValue(
                sourceCurrencyKey,
                sourceAmount,
                destinationCurrencyKey
            );

        uint256 fee;

        (amountReceived, fee) = calculateExchangeAmountMinusFees(
            destinationAmount
        );

        // // Issue their new synths
        _synthesizer.synths(destinationCurrencyKey).issue(
            destinationAddress,
            amountReceived
        );

        // Remit the fee if required
        if (fee > 0) {
            remitFee(_oracle, _synthesizer, fee, destinationCurrencyKey);
        }

        emit SynthExchanged(
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
        ISynthesizer _synthesizer,
        uint256 fee,
        bytes32 currencyKey
    ) internal {
        // Remit the fee in xUSDs
        uint256 usdFeeAmount = _oracle.effectiveValue(currencyKey, fee, xUSD);
        _synthesizer.synths(xUSD).issue(feePool().FEE_ADDRESS(), usdFeeAmount);
        // Tell the fee pool about this.
        feePool().recordFeePaid(usdFeeAmount);
    }

    function calculateExchangeAmountMinusFees(uint256 destinationAmount)
        internal
        view
        returns (uint256 amountReceived, uint256 fee)
    {
        // What's the fee on that currency that we should deduct?
        amountReceived = destinationAmount;

        // Get the exchange fee rate
        uint256 exchangeFeeRate = feePool().exchangeFeeRate();

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
                    "Oracle",
                    "Missing Oracle address"
                )
            );
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

    function feePool() internal view returns (IFeePool) {
        return
            IFeePool(
                resolver.requireAndGetAddress(
                    "FeePool",
                    "Missing FeePool address"
                )
            );
    }

    modifier onlySynthesizerOrSynth() {
        ISynthesizer _synthesizer = synthesizer();
        require(
            msg.sender == address(_synthesizer) ||
                _synthesizer.synthsByAddress(msg.sender) != bytes32(0),
            "Exchanger: Only Synthesizer or a synth contract can perform this action"
        );
        _;
    }

    event SynthExchanged(
        address indexed account,
        bytes32 fromCurrencyKey,
        uint256 fromAmount,
        bytes32 toCurrencyKey,
        uint256 toAmount,
        address toAddress
    );
}
