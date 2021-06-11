// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

/**
 * @title RewardEscrow interface
 */
interface IRewardEscrow {
    function balanceOf(address account) external view returns (uint);
    function vestBalanceOf(address account) external view returns (uint);
    function appendVestingEntry(address account, uint quantity) external;
}
