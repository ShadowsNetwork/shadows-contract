// SPDX-License-Identifier: MI
pragma solidity 0.6.11;


interface ISynths {
    function burn(address account, uint amount) external;

    function issue(address account, uint amount) external;

    function transfer(address to, uint value) external returns (bool);

    function transferFrom(address from, address to, uint value) external returns (bool);

    function balanceOf(address owner) external view returns (uint);
}