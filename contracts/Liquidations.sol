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

    mapping(address => uint256) internal liquidationDeadlineStorage;
    mapping(address => uint256) internal liquidationCallerStorage;

    uint256 public liquidationPenalty;
    uint256 public liquidationRatio;
    uint256 public liquidationDelay;

    function initialize(address _resolver) external initializer {
        __Ownable_init();
        __AddressResolver_init(_resolver);
        liquidationPenalty = 1e18 / 10; // 10%
        liquidationDelay = 2 hours;
        liquidationRatio = 1e18 / 2;
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
            synthesizer().collateralisationRatio(account);

        // Liquidation closed if collateral ratio less than or equal target issuance Ratio
        // Account with no dows collateral will also not be open for liquidation (ratio is 0)
        if (accountCollateralisationRatio <= synthesizer().issuanceRatio()) {
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
        return deadline > 0 && block.timestamp > deadline;
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
        uint256 ratio = synthesizer().issuanceRatio();
        uint256 unit = SafeDecimalMath.unit();

        uint256 dividend = debtBalance.sub(collateral.multiplyDecimal(ratio));
        uint256 divisor =
            unit.sub(unit.add(liquidationPenalty).multiplyDecimal(ratio));

        return dividend.divideDecimal(divisor);
    }

    function flagAccountForLiquidation(address account)
        external
        rateNotStale("DOWS")
    {
        LiquidationEntry memory liquidation =
            _getLiquidationEntryForAccount(account);
        require(
            liquidation.deadline == 0,
            "Account already flagged for liquidation"
        );

        uint256 accountsCollateralisationRatio =
            synthesizer().collateralisationRatio(account);

        // if accounts issuance ratio is greater than or equal to liquidation ratio set liquidation entry
        require(
            accountsCollateralisationRatio >= liquidationRatio,
            "Account issuance ratio is less than liquidation ratio"
        );

        uint256 deadline = block.timestamp.add(liquidationDelay);

        _storeLiquidationEntry(account, deadline, msg.sender);

        emit AccountFlaggedForLiquidation(account, deadline);
    }

    // Internal function to remove account from liquidations
    // Does not check collateral ratio is fixed
    function removeAccountInLiquidation(address account)
        external
        onlySynthesizer
    {
        LiquidationEntry memory liquidation =
            _getLiquidationEntryForAccount(account);
        if (liquidation.deadline > 0) {
            _removeLiquidationEntry(account);
        }
    }

    // Public function to allow an account to remove from liquidations
    // Checks collateral ratio is fixed - below target issuance ratio
    // Check DOWS rate is not stale
    function checkAndRemoveAccountInLiquidation(address account)
        external
        rateNotStale("DOWS")
    {
        LiquidationEntry memory liquidation =
            _getLiquidationEntryForAccount(account);

        require(liquidation.deadline > 0, "Account has no liquidation set");

        uint256 accountsCollateralisationRatio =
            synthesizer().collateralisationRatio(account);

        // Remove from liquidations if accountsCollateralisationRatio is fixed (less than equal target issuance ratio)
        if (accountsCollateralisationRatio <= synthesizer().issuanceRatio()) {
            _removeLiquidationEntry(account);
        }
    }

    function _storeLiquidationEntry(
        address _account,
        uint256 _deadline,
        address _caller
    ) internal {
        // record liquidation deadline
        liquidationDeadlineStorage[_account] = _deadline;
    }

    function _removeLiquidationEntry(address _account) internal {
        // delete liquidation deadline
        delete liquidationDeadlineStorage[_account];
        emit AccountRemovedFromLiquidation(_account, block.timestamp);
    }

    // get liquidationEntry for account
    // returns deadline = 0 when not set
    function _getLiquidationEntryForAccount(address account)
        internal
        view
        returns (LiquidationEntry memory _liquidation)
    {
        _liquidation.deadline = liquidationDeadlineStorage[account];
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

    /* ========== SETTERS ========== */
    function setLiquidationDelay(uint256 time) external onlyOwner {
        liquidationDelay = time;
    }

    // Accounts Collateral/Issuance ratio is higher when there is less collateral backing their debt
    // Upper bound liquidationRatio is 1 + penalty (100% + 10% = 110%) to allow collateral to cover debt and penalty
    function setLiquidationRatio(uint256 _liquidationRatio) external onlyOwner {
        liquidationRatio = _liquidationRatio;
    }

    function setLiquidationPenalty(uint256 penalty) external onlyOwner {
        liquidationPenalty = penalty;
    }

    /* ========== MODIFIERS ========== */

    modifier rateNotStale(bytes32 currencyKey) {
        require(
            !oracle().rateIsStale(currencyKey),
            "Rate stale or not a synth"
        );
        _;
    }

    modifier onlySynthesizer {
        require(
            msg.sender == address(synthesizer()),
            "FeePool: Only Issuer Authorised"
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
