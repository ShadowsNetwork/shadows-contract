// SPDX-License-Identifier: MIT
pragma solidity 0.6.11;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "./library/AddressResolverUpgradeable.sol";
import "./library/SafeDecimalMath.sol";
import "./interfaces/ISynth.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/IExchanger.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IRewardEscrow.sol";

contract Shadows is
    Initializable,
    OwnableUpgradeable,
    ERC20Upgradeable,
    AddressResolverUpgradeable
{
    using SafeDecimalMath for uint256;

    uint256 constant maxTotalSupply = 1e8 ether;
    bytes32 constant xUSD = "xUSD";
    uint256 public issuanceRatio = SafeDecimalMath.unit() / 5;

    ISynth[] public availableSynths;
    mapping(bytes32 => ISynth) public synths;
    mapping(address => bytes32) public synthsByAddress;

    struct IssuanceData {
        // Percentage of the total debt owned at the time
        uint256 initialDebtOwnership;
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

    function debtLedgerLength() public view returns (uint256) {
        return debtLedger.length;
    }

    function lastDebtLedgerEntry() public view returns (uint256) {
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

    function availableCurrencyKeys() public view returns (bytes32[] memory) {
        bytes32[] memory currencyKeys = new bytes32[](availableSynths.length);

        for (uint256 i = 0; i < availableSynths.length; i++) {
            currencyKeys[i] = synthsByAddress[address(availableSynths[i])];
        }

        return currencyKeys;
    }

    function availableSynthCount() public view returns (uint256) {
        return availableSynths.length;
    }

    function addSynth(ISynth synth) external onlyOwner {
        bytes32 currencyKey = synth.currencyKey();

        require(synths[currencyKey] == ISynth(0), "Synth already exists");
        require(
            synthsByAddress[address(synth)] == bytes32(0),
            "Synth address already exists"
        );

        availableSynths.push(synth);
        synths[currencyKey] = synth;
        synthsByAddress[address(synth)] = currencyKey;
    }

    function removeSynth(bytes32 currencyKey) external onlyOwner {
        require(
            address(synths[currencyKey]) != address(0),
            "Synth does not exist"
        );
        require(synths[currencyKey].totalSupply() == 0, "Synth supply exists");
        require(currencyKey != xUSD, "Cannot remove xUSD");

        address synthToRemove = address(synths[currencyKey]);

        for (uint256 i = 0; i < availableSynths.length; i++) {
            if (address(availableSynths[i]) == synthToRemove) {
                delete availableSynths[i];

                // Copy the last synth into the place of the one we just deleted
                // If there's only one synth, this is synths[0] = synths[0].
                // If we're deleting the last one, it's also a NOOP in the same way.
                availableSynths[i] = availableSynths[
                    availableSynths.length - 1
                ];

                // Decrease the size of the array by one.
                availableSynths.pop();

                break;
            }
        }

        delete synthsByAddress[address(synths[currencyKey])];
        delete synths[currencyKey];
    }

    function issueSynthsFrom(address from, uint256 amount) public {
        (uint256 maxIssuable, uint256 existingDebt) =
            remainingIssuableSynths(from);
        require(amount <= maxIssuable, "Amount too large");

        _addToDebtRegister(from, amount, existingDebt);

        synths[xUSD].issue(from, amount);

        _appendAccountIssuanceRecord(from);
    }

    function issueSynths(uint256 amount) external {
        return issueSynthsFrom(_msgSender(), amount);
    }

    function issueMaxSynths() external {
        (uint256 maxIssuable, ) = remainingIssuableSynths(_msgSender());

        return issueSynthsFrom(_msgSender(), maxIssuable);
    }

    function burnSynths(uint256 amount) external {
        address from = _msgSender();
        uint256 existingDebt = debtBalanceOf(from, xUSD);

        require(existingDebt > 0, "No debt to forgive");

        uint256 amountToRemove = existingDebt < amount ? existingDebt : amount;

        _removeFromDebtRegister(from, amountToRemove, existingDebt);

        uint256 amountToBurn = amountToRemove;

        synths[xUSD].burn(from, amountToBurn);

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
        IssuanceData memory data = issuanceData[_issuer];
        uint256 initialDebtOwnership = data.initialDebtOwnership;
        uint256 debtEntryIndex = data.debtEntryIndex;

        if (initialDebtOwnership == 0) return 0;

        // Figure out the global debt percentage delta from when they entered the system.
        // This is a high precision integer of 27 (1e27) decimals.
        uint256 currentDebtOwnership =
            lastDebtLedgerEntry()
                .divideDecimalRoundPrecise(debtLedger[debtEntryIndex])
                .multiplyDecimalRoundPrecise(initialDebtOwnership);

        uint256 totalSystemValue = totalIssuedSynths(currencyKey);

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
            oracle().effectiveValue("DOWS", collateral(_issuer), xUSD);

        // They're allowed to issue up to issuanceRatio of that value
        return destinationValue.multiplyDecimal(issuanceRatio);
    }

    function collateralisationRatio(address _issuer)
        public
        view
        returns (uint256)
    {
        uint256 totalOwnedShadows = collateral(_issuer);
        if (totalOwnedShadows == 0) return 0;

        uint256 debtBalance = debtBalanceOf(_issuer, "DOWS");
        return debtBalance.divideDecimalRound(totalOwnedShadows);
    }

    function collateral(address account) public view returns (uint256) {
        uint balance = balanceOf(account);

        if (address(rewardEscrow()) != address(0)) {
            balance = balance.add(rewardEscrow().balanceOf(account));
        }

        return balance;
    }

    function exchange(
        bytes32 sourceCurrencyKey,
        uint256 sourceAmount,
        bytes32 destinationCurrencyKey
    ) external returns (uint256 amountReceived) {
        return
            exchanger().exchange(
                _msgSender(),
                sourceCurrencyKey,
                sourceAmount,
                destinationCurrencyKey,
                _msgSender()
            );
    }

    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal override {
        require(
            amount <= transferableShadows(sender),
            "Cannot transfer staked DOWS"
        );
        return super._transfer(sender, recipient, amount);
    }

    function transferableShadows(address account)
        public
        view
        rateNotStale("DOWS")
        returns (uint256)
    {
        uint256 balance = balanceOf(account);

        uint256 lockedShadowsValue =
            debtBalanceOf(account, "DOWS").divideDecimalRound(issuanceRatio);

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
        uint256 totalDebtIssued = totalIssuedSynths(xUSD);

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
                lastDebtLedgerEntry().multiplyDecimalRoundPrecise(delta)
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

        uint256 totalDebtIssued = totalIssuedSynths(xUSD);

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
            lastDebtLedgerEntry().multiplyDecimalRoundPrecise(delta)
        );
    }

    function _appendAccountIssuanceRecord(address from) internal {
        IssuanceData memory data = issuanceData[from];

        feePool().appendAccountIssuanceRecord(
            from,
            data.initialDebtOwnership,
            data.debtEntryIndex
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
            _issuanceRatio <= SafeDecimalMath.unit(),
            "New issuance ratio cannot exceed MAX_ISSUANCE_RATIO"
        );
        issuanceRatio = _issuanceRatio;
        emit IssuanceRatioUpdated(_issuanceRatio);
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
                    "Oracle",
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

    function rewardEscrow() internal view returns (IRewardEscrow) {
        return
            IRewardEscrow(
                resolver.requireAndGetAddress(
                    "RewardEscrow",
                    "Missing RewardEscrow address"
                )
            );
    }

    modifier rateNotStale(bytes32 currencyKey) {
        require(
            !oracle().rateIsStale(currencyKey),
            "Rate stale or not a synth"
        );
        _;
    }

    event IssuanceRatioUpdated(uint256 newRatio);
}
