// SPDX-License-Identifier: MI
pragma solidity 0.6.11;


/**
 * @title FeePool Interface
 * @notice Abstract contract to hold public getters
 */
contract IFeePool {
    address public FEE_ADDRESS;
    uint public exchangeFeeRate;

    function amountReceivedFromExchange(uint value) external view returns (uint);

    function amountReceivedFromTransfer(uint value) external view returns (uint);

    function recordFeePaid(uint xUSDAmount) external;

    function appendAccountIssuanceRecord(address account, uint lockedAmount, uint debtEntryIndex) external;

    function setRewardsToDistribute(uint amount) external;
}
