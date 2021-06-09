// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "./library/AddressResolverUpgradeable.sol";
import "./library/SafeDecimalMath.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IShadows.sol";

/*
DOWS rewards are escrowed for 1 year from the claim date and users
can call vest in 6 months time.
*/
contract RewardEscrow is
    Initializable,
    OwnableUpgradeable,
    AddressResolverUpgradeable
{
    using SafeMath for uint256;
    using SafeDecimalMath for uint256;

    /* Lists of (timestamp, quantity) pairs per account, sorted in ascending time order.
     * These are the times at which each given quantity of DOWS vests. */
    mapping(address => uint256[2][]) public vestingSchedules;

    /* An account's total escrowed shadows balance to save recomputing this for fee extraction purposes. */
    mapping(address => uint256) public totalEscrowedAccountBalance;

    /* An account's total vested reward shadows. */
    mapping(address => uint256) public totalVestedAccountBalance;

    /* The total remaining escrowed balance, for verifying the actual shadows balance of this contract against. */
    uint256 public totalEscrowedBalance;

    uint256 constant TIME_INDEX = 0;
    uint256 constant QUANTITY_INDEX = 1;

    /* Limit vesting entries to disallow unbounded iteration over vesting schedules.
     * There are 5 years of the supply schedule */
    uint256 public constant MAX_VESTING_ENTRIES = 52 * 5;

    function initialize(address _resolver) external initializer {
        __Ownable_init();
        __AddressResolver_init(_resolver);
    }

    function balanceOf(address account) public view returns (uint256) {
        return totalEscrowedAccountBalance[account];
    }

    function vestBalanceOf(address account) public view returns (uint256) {
        return totalVestedAccountBalance[account];
    }

    /**
     * @notice The number of vesting dates in an account's schedule.
     */
    function numVestingEntries(address account) public view returns (uint256) {
        return vestingSchedules[account].length;
    }

    /**
     * @notice Get a particular schedule entry for an account.
     * @return A pair of uints: (timestamp, shadows quantity).
     */
    function getVestingScheduleEntry(address account, uint256 index)
        public
        view
        returns (uint256[2] memory)
    {
        return vestingSchedules[account][index];
    }

    /**
     * @notice Get the time at which a given schedule entry will vest.
     */
    function getVestingTime(address account, uint256 index)
        public
        view
        returns (uint256)
    {
        return getVestingScheduleEntry(account, index)[TIME_INDEX];
    }

    /**
     * @notice Get the quantity of DOWS associated with a given schedule entry.
     */
    function getVestingQuantity(address account, uint256 index)
        public
        view
        returns (uint256)
    {
        return getVestingScheduleEntry(account, index)[QUANTITY_INDEX];
    }

    /**
     * @notice Obtain the index of the next schedule entry that will vest for a given user.
     */
    function getNextVestingIndex(address account)
        public
        view
        returns (uint256)
    {
        uint256 len = numVestingEntries(account);
        for (uint256 i = 0; i < len; i++) {
            if (getVestingTime(account, i) != 0) {
                return i;
            }
        }
        return len;
    }

    /**
     * @notice Obtain the next schedule entry that will vest for a given user.
     * @return A pair of uints: (timestamp, shadows quantity). */
    function getNextVestingEntry(address account)
        public
        view
        returns (uint256[2] memory)
    {
        uint256 index = getNextVestingIndex(account);
        if (index == numVestingEntries(account)) {
            return [uint256(0), 0];
        }
        return getVestingScheduleEntry(account, index);
    }

    /**
     * @notice Obtain the time at which the next schedule entry will vest for a given user.
     */
    function getNextVestingTime(address account)
        external
        view
        returns (uint256)
    {
        return getNextVestingEntry(account)[TIME_INDEX];
    }

    /**
     * @notice Obtain the quantity which the next schedule entry will vest for a given user.
     */
    function getNextVestingQuantity(address account)
        external
        view
        returns (uint256)
    {
        return getNextVestingEntry(account)[QUANTITY_INDEX];
    }

    /**
     * @notice return the full vesting schedule entries vest for a given user.
     * @dev For DApps to display the vesting schedule for the
     * inflationary supply over 5 years. Solidity cant return variable length arrays
     * so this is returning pairs of data. Vesting Time at [0] and quantity at [1] and so on
     */
    function checkAccountSchedule(address account)
        public
        view
        returns (uint256[520] memory)
    {
        uint256[520] memory _result;
        uint256 schedules = numVestingEntries(account);
        for (uint256 i = 0; i < schedules; i++) {
            uint256[2] memory pair = getVestingScheduleEntry(account, i);
            _result[i * 2] = pair[0];
            _result[i * 2 + 1] = pair[1];
        }
        return _result;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    /**
     * @notice Add a new vesting entry at a given time and quantity to an account's schedule.
     * @dev A call to this should accompany a previous successful call to shadows.transfer(rewardEscrow, amount),
     * to ensure that when the funds are withdrawn, there is enough balance.
     * Note; although this function could technically be used to produce unbounded
     * arrays, it's only withinn the 4 year period of the weekly inflation schedule.
     * @param account The account to append a new vesting entry to.
     * @param quantity The quantity of DOWS that will be escrowed.
     */
    function appendVestingEntry(address account, uint256 quantity)
        public
        onlyFeePool
    {
        /* No empty or already-passed vesting entries allowed. */
        require(quantity != 0, "Quantity cannot be zero");

        /* There must be enough balance in the contract to provide for the vesting entry. */
        totalEscrowedBalance = totalEscrowedBalance.add(quantity);
        require(
            totalEscrowedBalance <= shadows().balanceOf(address(this)),
            "Must be enough balance in the contract to provide for the vesting entry"
        );

        /* Disallow arbitrarily long vesting schedules in light of the gas limit. */
        uint256 scheduleLength = vestingSchedules[account].length;
        require(
            scheduleLength <= MAX_VESTING_ENTRIES,
            "Vesting schedule is too long"
        );

        /* Escrow the tokens for 1 year. */
        uint256 time = block.timestamp + 52 weeks;

        if (scheduleLength == 0) {
            totalEscrowedAccountBalance[account] = quantity;
        } else {
            /* Disallow adding new vested DOWS earlier than the last one.
             * Since entries are only appended, this means that no vesting date can be repeated. */
            require(
                getVestingTime(account, scheduleLength - 1) < time,
                "Cannot add new vested entries earlier than the last one"
            );
            totalEscrowedAccountBalance[account] = totalEscrowedAccountBalance[
                account
            ]
                .add(quantity);
        }

        vestingSchedules[account].push([time, quantity]);

        emit VestingEntryCreated(account, block.timestamp, quantity);
    }

    /**
     * @notice Allow a user to withdraw any DOWS in their schedule that have vested.
     */
    function vest() external {
        uint256 numEntries = numVestingEntries(msg.sender);
        uint256 total;
        for (uint256 i = 0; i < numEntries; i++) {
            uint256 time = getVestingTime(msg.sender, i);
            /* The list is sorted; when we reach the first future time, bail out. */
            if (time > block.timestamp) {
                break;
            }
            uint256 qty = getVestingQuantity(msg.sender, i);
            if (qty == 0) {
                continue;
            }

            vestingSchedules[msg.sender][i] = [0, 0];
            total = total.add(qty);
        }

        if (total != 0) {
            totalEscrowedBalance = totalEscrowedBalance.sub(total);
            totalEscrowedAccountBalance[
                msg.sender
            ] = totalEscrowedAccountBalance[msg.sender].sub(total);
            totalVestedAccountBalance[msg.sender] = totalVestedAccountBalance[
                msg.sender
            ]
                .add(total);
            shadows().transfer(msg.sender, total);
            emit Vested(msg.sender, block.timestamp, total);
        }
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

    /* ========== MODIFIERS ========== */

    modifier onlyFeePool() {
        bool isFeePool = msg.sender == address(feePool());

        require(
            isFeePool,
            "Only the FeePool contracts can perform this action"
        );
        _;
    }

    event Vested(address indexed beneficiary, uint256 time, uint256 value);

    event VestingEntryCreated(
        address indexed beneficiary,
        uint256 time,
        uint256 value
    );
}
