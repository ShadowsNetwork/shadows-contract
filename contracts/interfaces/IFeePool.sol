// SPDX-License-Identifier: MI
pragma solidity 0.6.11;


/**
 * @title FeePool Interface
 */
abstract contract IFeePool {

    address public FEE_ADDRESS;
    uint public exchangeFeeRate;

    function amountReceivedFromExchange(uint value) virtual external view returns (uint);

    function amountReceivedFromTransfer(uint value) virtual external view returns (uint);

    function recordFeePaid(uint xUSDAmount) virtual external;

    function appendAccountIssuanceRecord(address account, uint lockedAmount, uint debtEntryIndex) virtual external;

    function setRewardsToDistribute(uint amount) virtual external;
}
