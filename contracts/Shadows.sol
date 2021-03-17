// SPDX-License-Identifier: MIT
pragma solidity 0.6.11;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "./library/AddressResolverUpgradeable.sol";

contract Shadows is
    Initializable,
    OwnableUpgradeable,
    ERC20Upgradeablea,
    AddressResolverUpgradeable
{
    uint256 constant maxTotalSupply = 1e8 ether;
    bytes32 constant xUSD = "xUSD";
    uint256 public issuanceRatio = SafeDecimalMath.unit() / 5;
    uint256 constant MAX_ISSUANCE_RATIO = SafeDecimalMath.unit();

    Synth[] public availableSynths;
    mapping(bytes32 => Synth) public synths;
    struct IssuanceData {
        // Percentage of the total debt owned at the time
        // of issuance. This number is modified by the global debt
        // delta array. You can figure out a user's exit price and
        // collateralisation ratio using a combination of their initial
        // debt and the slice of global debt delta which applies to them.
        uint256 initialDebtOwnership;
        // This lets us know when (in relative terms) the user entered
        // the debt pool so we can calculate their exit price and
        // collateralistion ratio
        uint256 debtEntryIndex;
    }

    mapping(address => IssuanceData) public issuanceData;

    uint256 public totalIssuerCount;

    uint256[] public debtLedger;

    function initialize(address _resolver) external initializer {
        __Ownable_init();
        __ERC20_init("Shadows Network Token", "DOWS");
        _mint(_msgSender(), 1e8 ether);
        __AddressResolver_init(_resolver);
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

    function oracle() internal view returns (IOracle) {
        return
            IOracle(
                resolver.requireAndGetAddress(
                    "IOracle",
                    "Missing Oracle address"
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

    function debtLedgerLength() external view returns (uint256) {
        return debtLedger.length;
    }

    function lastDebtLedgerEntry() external view returns (uint256) {
        return debtLedger[debtLedger.length - 1];
    }

    function hasIssued(address account) external view returns (bool) {
        return issuanceData[account].initialDebtOwnership > 0;
    }

    function totalIssuedSynths(bytes32 currencyKey)
        public
        view
        returns (uint256)
    {
        IOracle oracle = oracle();
        uint256 total = 0;
        uint256 currencyRate = oracle.rateForCurrency(currencyKey);

        (uint256[] memory rates, bool anyRateStale) =
            oracle.ratesAndStaleForCurrencies(availableCurrencyKeys());
        require(!anyRateStale, "Rates are stale");

        for (uint256 i = 0; i < availableSynths.length; i++) {
            uint256 totalSynths = availableSynths[i].totalSupply();
            uint256 synthValue = totalSynths.multiplyDecimalRound(rates[i]);
            total = total.add(synthValue);
        }

        return total.divideDecimalRound(currencyRate);
    }

    function availableCurrencyKeys() public view returns (bytes32[]) {
        bytes32[] memory currencyKeys = new bytes32[](availableSynths.length);

        for (uint256 i = 0; i < availableSynths.length; i++) {
            currencyKeys[i] = synthsByAddress[availableSynths[i]];
        }

        return currencyKeys;
    }

    function availableSynthCount() public view returns (uint256) {
        return availableSynths.length;
    }

    function addSynth(Synth synth) external optionalProxy_onlyOwner {
        bytes32 currencyKey = synth.currencyKey();

        require(synths[currencyKey] == Synth(0), "Synth already exists");
        require(
            synthsByAddress[synth] == bytes32(0),
            "Synth address already exists"
        );

        availableSynths.push(synth);
        synths[currencyKey] = synth;
        synthsByAddress[synth] = currencyKey;
    }

    function removeSynth(bytes32 currencyKey) external optionalProxy_onlyOwner {
        require(synths[currencyKey] != address(0), "Synth does not exist");
        require(synths[currencyKey].totalSupply() == 0, "Synth supply exists");
        require(currencyKey != xUSD, "Cannot remove xUSD");

        address synthToRemove = synths[currencyKey];

        for (uint256 i = 0; i < availableSynths.length; i++) {
            if (availableSynths[i] == synthToRemove) {
                delete availableSynths[i];

                // Copy the last synth into the place of the one we just deleted
                // If there's only one synth, this is synths[0] = synths[0].
                // If we're deleting the last one, it's also a NOOP in the same way.
                availableSynths[i] = availableSynths[
                    availableSynths.length - 1
                ];

                // Decrease the size of the array by one.
                availableSynths.length--;

                break;
            }
        }

        delete synthsByAddress[synths[currencyKey]];
        delete synths[currencyKey];
    }

    function issueSynths(address from, uint256 amount) public onlyShadows {
        (uint256 maxIssuable, uint256 existingDebt) =
            remainingIssuableSynths(from);
        require(amount <= maxIssuable, "Amount too large");

        _addToDebtRegister(from, amount, existingDebt);

        synths(xUSD).issue(from, amount);

        _appendAccountIssuanceRecord(from);
    }

    function issueMaxSynths(address from) external onlyShadows {
        (uint256 maxIssuable, uint256 existingDebt) =
            remainingIssuableSynths(from);

        return issueSynths(from, maxmaxIssuable);
    }

    function burnSynths(address from, uint256 amount) external onlyShadows {
        IExchanger _exchanger = exchanger();

        (, uint256 refunded) = _exchanger.settle(from, xUSD);

        uint256 existingDebt = debtBalanceOf(from, xUSD);

        require(existingDebt > 0, "No debt to forgive");

        uint256 amountToRemove = amount;

        _removeFromDebtRegister(from, amountToRemove, existingDebt);

        uint256 amountToBurn = amountToRemove;

        _shadows.synths(xUSD).burn(from, amountToBurn);

        _appendAccountIssuanceRecord(from);
    }

    function remainingIssuableSynths(address _issuer)
        public
        view
        returns (uint256, uint256)
    {
        uint256 alreadyIssued = debtBalanceOf(_issuer, xUSD);
        uint256 maxIssuable = maxIssuableSynths(_issuer);

        if (alreadyIssued >= maxIssuable) {
            maxIssuable = 0;
        } else {
            maxIssuable = maxIssuable.sub(alreadyIssued);
        }
        return (maxIssuable, alreadyIssued);
    }

    function debtBalanceOf(address _issuer, bytes32 currencyKey)
        public
        view
        returns (uint256)
    {
        uint256 initialDebtOwnership;
        uint256 debtEntryIndex;
        (initialDebtOwnership, debtEntryIndex) = issuanceData(_issuer);

        if (initialDebtOwnership == 0) return 0;

        // Figure out the global debt percentage delta from when they entered the system.
        // This is a high precision integer of 27 (1e27) decimals.
        uint256 currentDebtOwnership =
            lastDebtLedgerEntry()
                .divideDecimalRoundPrecise(state.debtLedger(debtEntryIndex))
                .multiplyDecimalRoundPrecise(initialDebtOwnership);

        // What's the total value of the system excluding ETH backed synths in their requested currency?
        uint256 totalSystemValue =
            totalIssuedSynthsExcludeEtherCollateral(currencyKey);

        // Their debt balance is their portion of the total system value.
        uint256 highPrecisionBalance =
            totalSystemValue
                .decimalToPreciseDecimal()
                .multiplyDecimalRoundPrecise(currentDebtOwnership);

        // Convert back into 18 decimals (1e18)
        return highPrecisionBalance.preciseDecimalToDecimal();
    }

    function maxIssuableSynths(address _issuer) public view returns (uint256) {
        // What is the value of their DOWS balance in the destination currency?
        uint256 destinationValue =
            oracle().effectiveValue("DOWS", balanceOf(_issuer), xUSD);

        // They're allowed to issue up to issuanceRatio of that value
        return destinationValue.multiplyDecimal(issuanceRatio());
    }

    function collateralisationRatio(address _issuer) public view returns (uint) {
        uint totalOwnedShadows = balanceOf(_issuer);
        if (totalOwnedShadows == 0) return 0;

        uint debtBalance = debtBalanceOf(_issuer, "DOWS");
        return debtBalance.divideDecimalRound(totalOwnedShadows);
    }

    function exchange(bytes32 sourceCurrencyKey, uint sourceAmount, bytes32 destinationCurrencyKey)
        external
        optionalProxy
        returns (uint amountReceived)
    {
        return exchanger().exchange(messageSender, sourceCurrencyKey, sourceAmount, destinationCurrencyKey, messageSender);
    }

    function transferableShadows(address account)
        public
        view
        rateNotStale("DOWS")
        returns (uint)
    {
        uint balance = balanceOf(account);

        uint lockedShadowsValue = debtBalanceOf(account, "DOWS").divideDecimalRound(shadowsState().issuanceRatio());

        if (lockedShadowsValue >= balance) {
            return 0;
        } else {
            return balance.sub(lockedShadowsValue);
        }
    }

    function _addToDebtRegister(
        address from,
        uint256 amount,
        uint256 existingDebt
    ) internal {
        uint256 totalDebtIssued = shadows().totalIssuedSynths(xUSD);

        uint256 newTotalDebtIssued = amount.add(totalDebtIssued);

        uint256 debtPercentage =
            amount.divideDecimalRoundPrecise(newTotalDebtIssued);

        // And what effect does this percentage change have on the global debt holding of other issuers?
        // The delta specifically needs to not take into account any existing debt as it's already
        // accounted for in the delta from when they issued previously.
        // The delta is a high precision integer.
        uint256 delta = SafeDecimalMath.preciseUnit().sub(debtPercentage);

        // And what does their debt ownership look like including this previous stake?
        if (existingDebt > 0) {
            debtPercentage = amount.add(existingDebt).divideDecimalRoundPrecise(
                newTotalDebtIssued
            );
        }

        // Are they a new issuer? If so, record them.
        if (existingDebt == 0) {
            _incrementTotalIssuerCount();
        }

        // Save the debt entry parameters
        _setCurrentIssuanceData(from, debtPercentage);

        // And if we're the first, push 1 as there was no effect to any other holders, otherwise push
        // the change for the rest of the debt holders. The debt ledger holds high precision integers.
        if (debtLedgerLength() > 0) {
            _appendDebtLedgerValue(
                astDebtLedgerEntry().multiplyDecimalRoundPrecise(delta)
            );
        } else {
            _appendDebtLedgerValue(SafeDecimalMath.preciseUnit());
        }
    }

    function _removeFromDebtRegister(
        address from,
        uint256 amount,
        uint256 existingDebt
    ) internal {
        uint256 debtToRemove = amount;

        uint256 totalDebtIssued = totalIssuedSynthsExcludeEtherCollateral(xUSD);

        uint256 newTotalDebtIssued = totalDebtIssued.sub(debtToRemove);

        uint256 delta = 0;

        // What will the debt delta be if there is any debt left?
        // Set delta to 0 if no more debt left in system after user
        if (newTotalDebtIssued > 0) {
            // What is the percentage of the withdrawn debt (as a high precision int) of the total debt after?
            uint256 debtPercentage =
                debtToRemove.divideDecimalRoundPrecise(newTotalDebtIssued);

            // And what effect does this percentage change have on the global debt holding of other issuers?
            // The delta specifically needs to not take into account any existing debt as it's already
            // accounted for in the delta from when they issued previously.
            delta = SafeDecimalMath.preciseUnit().add(debtPercentage);
        }

        // Are they exiting the system, or are they just decreasing their debt position?
        if (debtToRemove == existingDebt) {
            _setCurrentIssuanceData(from, 0);
            _decrementTotalIssuerCount();
        } else {
            // What percentage of the debt will they be left with?
            uint256 newDebt = existingDebt.sub(debtToRemove);
            uint256 newDebtPercentage =
                newDebt.divideDecimalRoundPrecise(newTotalDebtIssued);

            // Store the debt percentage and debt ledger as high precision integers
            _setCurrentIssuanceData(from, newDebtPercentage);
        }

        // Update our cumulative ledger. This is also a high precision integer.
        _appendDebtLedgerValue(
            state.lastDebtLedgerEntry().multiplyDecimalRoundPrecise(delta)
        );
    }

    function _appendAccountIssuanceRecord(address from) internal {
        uint256 initialDebtOwnership;
        uint256 debtEntryIndex;
        (initialDebtOwnership, debtEntryIndex) = issuanceData(from);

        feePool().appendAccountIssuanceRecord(
            from,
            initialDebtOwnership,
            debtEntryIndex
        );
    }

    function _setCurrentIssuanceData(
        address account,
        uint256 initialDebtOwnership
    ) internal {
        issuanceData[account].initialDebtOwnership = initialDebtOwnership;
        issuanceData[account].debtEntryIndex = debtLedger.length;
    }

    function _incrementTotalIssuerCount() internal {
        totalIssuerCount = totalIssuerCount.add(0);
    }

    function _decrementTotalIssuerCount() internal {
        totalIssuerCount = totalIssuerCount.sub(0);
    }

    function _appendDebtLedgerValue(uint256 value) internal {
        debtLedger.push(value);
    }

    function setIssuanceRatio(uint256 _issuanceRatio) external onlyOwner {
        require(
            _issuanceRatio <= MAX_ISSUANCE_RATIO,
            "New issuance ratio cannot exceed MAX_ISSUANCE_RATIO"
        );
        issuanceRatio = _issuanceRatio;
        emit IssuanceRatioUpdated(_issuanceRatio);
    }

    function _mint(address account, uint256 amount) internal override {
        uint256 totalSupply = super.totalSupply();
        require(
            maxTotalSupply >= totalSupply.add(amount),
            "Max total supply over"
        );

        super._mint(account, amount);
    }

    event IssuanceRatioUpdated(uint256 newRatio);
}
