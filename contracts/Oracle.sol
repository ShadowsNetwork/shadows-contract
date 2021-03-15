// SPDX-License-Identifier: MIT
pragma solidity 0.6.11

import "./SafeDecimalMath.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";;
import "chainlink/contracts/interfaces/AggregatorInterface.sol";

contract Oracle is Initializable, OwnableUpgradeable {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    struct RateAndUpdatedTime {
        uint216 rate;
        uint40 time;
    }

    // Exchange rates and update times stored by currency code, e.g. 'DOWS', or 'xUSD'
    mapping(bytes32 => mapping(uint => RateAndUpdatedTime)) private _rates;

    // The address of the oracle which pushes rate updates to this contract
    address public oracle;

    // Decentralized oracle networks that feed into pricing aggregators
    mapping(bytes32 => AggregatorInterface) public aggregators;

    // List of aggregator keys for convenient iteration
    bytes32[] public aggregatorKeys;

    // Do not allow the oracle to submit times any further forward into the future than this constant.
    uint private constant ORACLE_FUTURE_LIMIT = 10 minutes;

    // How long will the contract assume the rate of any asset is correct
    uint public rateStalePeriod = 3 hours;

    mapping(bytes32 => uint) currentRoundForRate;

    function initialize(
        address _owner,
        address _oracle,
        bytes32[] _currencyKeys,
        uint[] _newRates 
    ) external initializer {
        __Ownable_init();
        require(_currencyKeys.length == _newRates.length, "Currency key length and rate length must match.");

        oracle = _oracle;

        // The xUSD rate is always 1 and is never stale.
        _setRate("xUSD", SafeDecimalMath.unit(), now);

        internalUpdateRates(_currencyKeys, _newRates, now);
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
        emit OracleUpdated(oracle);
    }

    function setRateStalePeriod(uint _time) external onlyOwner {
        rateStalePeriod = _time;
        emit RateStalePeriodUpdated(rateStalePeriod);
    }

    
    function updateRates(bytes32[] currencyKeys, uint[] newRates, uint timeSent) external onlyOracle returns (bool) {
        return internalUpdateRates(currencyKeys, newRates, timeSent);
    }

    function deleteRate(bytes32 currencyKey) external onlyOracle {
        require(getRate(currencyKey) > 0, "Rate is zero");

        delete _rates[currencyKey][currentRoundForRate[currencyKey]];

        currentRoundForRate[currencyKey]--;

        emit RateDeleted(currencyKey);
    }


    /**
     * @notice Add a pricing aggregator for the given key. Note: existing aggregators may be overridden.
     */
    function addAggregator(bytes32 currencyKey, address aggregatorAddress) external onlyOwner {
        AggregatorInterface aggregator = AggregatorInterface(aggregatorAddress);
        require(aggregator.latestTimestamp() >= 0, "Given Aggregator is invalid");
        if (aggregators[currencyKey] == address(0)) {
            aggregatorKeys.push(currencyKey);
        }
        aggregators[currencyKey] = aggregator;
        emit AggregatorAdded(currencyKey, aggregator);
    }

    function removeAggregator(bytes32 currencyKey) external onlyOwner {
        address aggregator = aggregators[currencyKey];
        require(aggregator != address(0), "No aggregator exists for key");
        delete aggregators[currencyKey];

        bool wasRemoved = removeFromArray(currencyKey, aggregatorKeys);

        if (wasRemoved) {
            emit AggregatorRemoved(currencyKey, aggregator);
        }
    }

    function getLastRoundIdBeforeElapsedSecs(
        bytes32 currencyKey,
        uint startingRoundId,
        uint startingTimestamp,
        uint timediff
    ) external view returns (uint) {
        uint roundId = startingRoundId;
        uint nextTimestamp = 0;
        while (true) {
            (, nextTimestamp) = getRateAndTimestampAtRound(currencyKey, roundId + 1);
            // if there's no new round, then the previous roundId was the latest
            if (nextTimestamp == 0 || nextTimestamp > startingTimestamp + timediff) {
                return roundId;
            }
            roundId++;
        }
        return roundId;
    }

    function getCurrentRoundId(bytes32 currencyKey) external view returns (uint) {
        if (aggregators[currencyKey] != address(0)) {
            AggregatorInterface aggregator = aggregators[currencyKey];
            return aggregator.latestRound();
        } else {
            return currentRoundForRate[currencyKey];
        }
    }

    function effectiveValueAtRound(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        uint roundIdForSrc,
        uint roundIdForDest
    ) external view rateNotStale(sourceCurrencyKey) rateNotStale(destinationCurrencyKey) returns (uint) {
        // If there's no change in the currency, then just return the amount they gave us
        if (sourceCurrencyKey == destinationCurrencyKey) return sourceAmount;

        (uint srcRate, ) = getRateAndTimestampAtRound(sourceCurrencyKey, roundIdForSrc);
        (uint destRate, ) = getRateAndTimestampAtRound(destinationCurrencyKey, roundIdForDest);
        // Calculate the effective value by going from source -> USD -> destination
        return sourceAmount.multiplyDecimalRound(srcRate).divideDecimalRound(destRate);
    }

    function rateAndTimestampAtRound(bytes32 currencyKey, uint roundId) external view returns (uint rate, uint time) {
        return getRateAndTimestampAtRound(currencyKey, roundId);
    }

    function lastRateUpdateTimes(bytes32 currencyKey) public view returns (uint256) {
        return getRateAndUpdatedTime(currencyKey).time;
    }

    function lastRateUpdateTimesForCurrencies(bytes32[] currencyKeys) public view returns (uint[]) {
        uint[] memory lastUpdateTimes = new uint[](currencyKeys.length);

        for (uint i = 0; i < currencyKeys.length; i++) {
            lastUpdateTimes[i] = lastRateUpdateTimes(currencyKeys[i]);
        }

        return lastUpdateTimes;
    }

    function effectiveValue(bytes32 sourceCurrencyKey, uint sourceAmount, bytes32 destinationCurrencyKey)
        public
        view
        rateNotStale(sourceCurrencyKey)
        rateNotStale(destinationCurrencyKey)
        returns (uint)
    {
        // If there's no change in the currency, then just return the amount they gave us
        if (sourceCurrencyKey == destinationCurrencyKey) return sourceAmount;

        // Calculate the effective value by going from source -> USD -> destination
        return
            sourceAmount.multiplyDecimalRound(getRate(sourceCurrencyKey)).divideDecimalRound(
                getRate(destinationCurrencyKey)
            );
    }

    function rateForCurrency(bytes32 currencyKey) external view returns (uint) {
        return getRateAndUpdatedTime(currencyKey).rate;
    }

    function ratesForCurrencies(bytes32[] currencyKeys) external view returns (uint[]) {
        uint[] memory _localRates = new uint[](currencyKeys.length);

        for (uint i = 0; i < currencyKeys.length; i++) {
            _localRates[i] = getRate(currencyKeys[i]);
        }

        return _localRates;
    }

    function ratesAndStaleForCurrencies(bytes32[] currencyKeys) external view returns (uint[], bool) {
        uint[] memory _localRates = new uint[](currencyKeys.length);

        bool anyRateStale = false;
        uint period = rateStalePeriod;
        for (uint i = 0; i < currencyKeys.length; i++) {
            RateAndUpdatedTime memory rateAndUpdateTime = getRateAndUpdatedTime(currencyKeys[i]);
            _localRates[i] = uint256(rateAndUpdateTime.rate);
            if (!anyRateStale) {
                anyRateStale = (currencyKeys[i] != "xUSD" && uint256(rateAndUpdateTime.time).add(period) < now);
            }
        }

        return (_localRates, anyRateStale);
    }

    /**
     * @notice Check if a specific currency's rate hasn't been updated for longer than the stale period.
     */
    function rateIsStale(bytes32 currencyKey) public view returns (bool) {
        // xUSD is a special case and is never stale.
        if (currencyKey == "xUSD") return false;

        return lastRateUpdateTimes(currencyKey).add(rateStalePeriod) < now;
    }

    /**
     * @notice Check if any of the currency rates passed in haven't been updated for longer than the stale period.
     */
    function anyRateIsStale(bytes32[] currencyKeys) external view returns (bool) {
        // Loop through each key and check whether the data point is stale.
        uint256 i = 0;

        while (i < currencyKeys.length) {
            // xUSD is a special case and is never false
            if (currencyKeys[i] != "xUSD" && lastRateUpdateTimes(currencyKeys[i]).add(rateStalePeriod) < now) {
                return true;
            }
            i += 1;
        }

        return false;
    }

    function _setRate(bytes32 currencyKey, uint256 rate, uint256 time) internal {
        // Note: this will effectively start the rounds at 1, which matches Chainlink's Agggregators
        currentRoundForRate[currencyKey]++;

        _rates[currencyKey][currentRoundForRate[currencyKey]] = RateAndUpdatedTime({
            rate: uint216(rate),
            time: uint40(time)
        });
    }

    function internalUpdateRates(bytes32[] currencyKeys, uint[] newRates, uint timeSent) internal returns (bool) {
        require(currencyKeys.length == newRates.length, "Currency key array length must match rates array length.");
        require(timeSent < (now + ORACLE_FUTURE_LIMIT), "Time is too far into the future");

        // Loop through each key and perform update.
        for (uint i = 0; i < currencyKeys.length; i++) {
            bytes32 currencyKey = currencyKeys[i];

            // Should not set any rate to zero ever, as no asset will ever be
            // truely worthless and still valid. In this scenario, we should
            // delete the rate and remove it from the system.
            require(newRates[i] != 0, "Zero is not a valid rate, please call deleteRate instead.");
            require(currencyKey != "xUSD", "Rate of xUSD cannot be updated, it's always UNIT.");

            // We should only update the rate if it's at least the same age as the last rate we've got.
            if (timeSent < lastRateUpdateTimes(currencyKey)) {
                continue;
            }

            // Ok, go ahead with the update.
            _setRate(currencyKey, newRates[i], timeSent);
        }

        emit RatesUpdated(currencyKeys, newRates);

        return true;
    }


    function getRateAndUpdatedTime(bytes32 currencyKey) internal view returns (RateAndUpdatedTime) {
        if (aggregators[currencyKey] != address(0)) {
            return
                RateAndUpdatedTime({
                    rate: uint216(aggregators[currencyKey].latestAnswer() * 1e10),
                    time: uint40(aggregators[currencyKey].latestTimestamp())
                });
        } else {
            return _rates[currencyKey][currentRoundForRate[currencyKey]];
        }
    }

    /**
     * @notice Remove a single value from an array by iterating through until it is found.
     * @param entry The entry to find
     * @param array The array to mutate
     * @return bool Whether or not the entry was found and removed
     */
    function removeFromArray(bytes32 entry, bytes32[] storage array) internal returns (bool) {
        for (uint i = 0; i < array.length; i++) {
            if (array[i] == entry) {
                delete array[i];

                // Copy the last key into the place of the one we just deleted
                // If there's only one key, this is array[0] = array[0].
                // If we're deleting the last one, it's also a NOOP in the same way.
                array[i] = array[array.length - 1];

                // Decrease the size of the array by one.
                array.length--;

                return true;
            }
        }
        return false;
    }

    function getRateAndTimestampAtRound(bytes32 currencyKey, uint roundId) internal view returns (uint rate, uint time) {
        if (aggregators[currencyKey] != address(0)) {
            AggregatorInterface aggregator = aggregators[currencyKey];
            return (uint(aggregator.getAnswer(roundId) * 1e10), aggregator.getTimestamp(roundId));
        } else {
            RateAndUpdatedTime storage update = _rates[currencyKey][roundId];
            return (update.rate, update.time);
        }
    }

    function getRate(bytes32 currencyKey) internal view returns (uint256) {
        return getRateAndUpdatedTime(currencyKey).rate;
    }


    modifier rateNotStale(bytes32 currencyKey) {
        require(!rateIsStale(currencyKey), "Rate stale or nonexistant currency");
        _;
    }

    modifier onlyOracle {
        require(msg.sender == oracle, "Only the oracle can perform this action");
        _;
    }

    event OracleUpdated(address newOracle);
    event RateStalePeriodUpdated(uint rateStalePeriod);
    event RatesUpdated(bytes32[] currencyKeys, uint[] newRates);
    event RateDeleted(bytes32 currencyKey);
    event AggregatorAdded(bytes32 currencyKey, address aggregator);
    event AggregatorRemoved(bytes32 currencyKey, address aggregator);
}
