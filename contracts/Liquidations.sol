// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "./library/SafeDecimalMath.sol";
import "./library/AddressResolverUpgradeable.sol";
import "./interfaces/ISynthesizer.sol";
import "./interfaces/IOracle.sol";

contract Liquidations is
    Initializable,
    OwnableUpgradeable,
    AddressResolverUpgradeable
{
    using SafeMath for uint256;
    using SafeDecimalMath for uint256;

    struct LiquidationEntry {
        uint256 deadline;
        address caller;
    }

    // Storage keys
    bytes32 public constant LIQUIDATION_DEADLINE = "LiquidationDeadline";
    bytes32 public constant LIQUIDATION_CALLER = "LiquidationCaller";

    function initialize(address _resolver) external initializer {
        __Ownable_init();
        __AddressResolver_init(_resolver);
    }

    function getLiquidationDeadlineForAccount(address account)
        external
        view
        returns (uint256)
    {
        LiquidationEntry memory liquidation =
            _getLiquidationEntryForAccount(account);
        return liquidation.deadline;
    }

    function isOpenForLiquidation(address account)
        external
        view
        returns (bool)
    {
        uint256 accountCollateralisationRatio =
            synthetix().collateralisationRatio(account);

        // Liquidation closed if collateral ratio less than or equal target issuance Ratio
        // Account with no snx collateral will also not be open for liquidation (ratio is 0)
        if (accountCollateralisationRatio <= getIssuanceRatio()) {
            return false;
        }

        LiquidationEntry memory liquidation =
            _getLiquidationEntryForAccount(account);

        // liquidation cap at issuanceRatio is checked above
        if (_deadlinePassed(liquidation.deadline)) {
            return true;
        }
        return false;
    }

    function isLiquidationDeadlinePassed(address account)
        external
        view
        returns (bool)
    {
        LiquidationEntry memory liquidation =
            _getLiquidationEntryForAccount(account);
        return _deadlinePassed(liquidation.deadline);
    }

    function _deadlinePassed(uint256 deadline) internal view returns (bool) {
        // check deadline is set > 0
        // check now > deadline
        return deadline > 0 && now > deadline;
    }

    /**
     * r = target issuance ratio
     * D = debt balance
     * V = Collateral
     * P = liquidation penalty
     * Calculates amount of synths = (D - V * r) / (1 - (1 + P) * r)
     */
    function calculateAmountToFixCollateral(
        uint256 debtBalance,
        uint256 collateral
    ) external view returns (uint256) {
        uint256 ratio = getIssuanceRatio();
        uint256 unit = SafeDecimalMath.unit();

        uint256 dividend = debtBalance.sub(collateral.multiplyDecimal(ratio));
        uint256 divisor =
            unit.sub(unit.add(getLiquidationPenalty()).multiplyDecimal(ratio));

        return dividend.divideDecimal(divisor);
    }

    // get liquidationEntry for account
    // returns deadline = 0 when not set
    function _getLiquidationEntryForAccount(address account)
        internal
        view
        returns (LiquidationEntry memory _liquidation)
    {
        _liquidation.deadline = eternalStorageLiquidations().getUIntValue(
            _getKey(LIQUIDATION_DEADLINE, account)
        );

        // liquidation caller not used
        _liquidation.caller = address(0);
    }

    function _getKey(bytes32 _scope, address _account)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(_scope, _account));
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

    function oracle() internal view returns (IOracle) {
        return
            IOracle(
                resolver.requireAndGetAddress(
                    "Oracle",
                    "Missing Oracle address"
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

    /* ========== MODIFIERS ========== */

    // modifier onlyIssuer() {
    //     require(
    //         msg.sender == address(issuer()),
    //         "Liquidations: Only the Issuer contract can perform this action"
    //     );
    //     _;
    // }

    modifier rateNotStale(bytes32 currencyKey) {
        require(
            !oracle().rateIsStale(currencyKey),
            "Rate stale or not a synth"
        );
        _;
    }
    /* ========== EVENTS ========== */

    event AccountFlaggedForLiquidation(
        address indexed account,
        uint256 deadline
    );
    event AccountRemovedFromLiquidation(address indexed account, uint256 time);
}
