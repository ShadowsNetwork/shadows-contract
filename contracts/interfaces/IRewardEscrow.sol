// SPDX-License-Identifier: MIT
pragma solidity 0.6.11;

/**
 * @title RewardEscrow interface
 */
interface IRewardEscrow {
    function balanceOf(address account) external view returns (uint);

    function appendVestingEntry(address account, uint quantity) external;
}
