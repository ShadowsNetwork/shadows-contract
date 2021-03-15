// SPDX-License-Identifier: MIT
pragma solidity 0.6.11

import "@openzeppelin/contracts/access/Ownable.sol"


contract AddressResolver is Ownable {
    mapping(bytes32 => address) public repository;

    constructor(address _owner) public {}

    function importAddresses(bytes32[] names, address[] destinations) public onlyOwner {
        require(names.length == destinations.length, "Input lengths must match");

        for (uint i = 0; i < names.length; i++) {
            repository[names[i]] = destinations[i];
        }
    }

    function getAddress(bytes32 name) public view returns (address) {
        return repository[name];
    }

    function requireAndGetAddress(bytes32 name, string reason) public view returns (address) {
        address _foundAddress = repository[name];
        require(_foundAddress != address(0), reason);
        return _foundAddress;
    }
}
