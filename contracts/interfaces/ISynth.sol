// SPDX-License-Identifier: MI
pragma solidity >=0.6.0 <0.8.0;


abstract contract ISynth {
    bytes32 public currencyKey;

    function totalSupply() virtual external view returns (uint256);

    function burn(address account, uint amount) virtual external;

    function issue(address account, uint amount) virtual external;

    function transfer(address to, uint value) virtual external returns (bool);

    function transferFrom(address from, address to, uint value) virtual external returns (bool);

    function balanceOf(address owner) virtual external view returns (uint);
}