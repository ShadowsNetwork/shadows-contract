// SPDX-License-Identifier: MI
pragma solidity >=0.6.0 <0.8.0;

abstract contract IShadows {
    uint256 public totalSupply;

    uint256 public issuanceRatio;

    function balanceOf(address account) external view virtual returns (uint256);

    function transfer(address to, uint256 value)
        external
        virtual
        returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external virtual returns (bool);
}