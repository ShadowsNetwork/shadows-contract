// SPDX-License-Identifier: MI
pragma solidity 0.6.11


/**
 * @title RewardEscrow interface
 */
interface IRewardEscrow {
    function balanceOf(address account) public view returns (uint);

    function appendVestingEntry(address account, uint quantity) public;
}
