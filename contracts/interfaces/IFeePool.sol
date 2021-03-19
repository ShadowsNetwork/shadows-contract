// SPDX-License-Identifier: MI
pragma solidity 0.6.11;


/**
 * @title FeePool Interface
 * @notice Abstract contract to hold public getters
 */
interface IFeePool {

    function getFeeAddress() external view returns (address);

    function getExchangeFeeRate() external view returns (uint);

    function amountReceivedFromExchange(uint value) external view returns (uint);

    function amountReceivedFromTransfer(uint value) external view returns (uint);

    function recordFeePaid(uint xUSDAmount) external;

    function appendAccountIssuanceRecord(address account, uint lockedAmount, uint debtEntryIndex) external;

    function setRewardsToDistribute(uint amount) external;
}
