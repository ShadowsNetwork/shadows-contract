// SPDX-License-Identifier: MI
pragma solidity 0.6.11;


interface IIssuer {
    function issueSynths(address from, uint amount) external;

    function issueMaxSynths(address from) external;

    function burnSynths(address from, uint amount) external;
}
