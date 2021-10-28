// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";


contract AddressResolver is Ownable {
    mapping(bytes32 => address) public repository;

    function importAddresses(bytes32[] calldata names, address[] calldata destinations) public onlyOwner {
        require(names.length == destinations.length, "Input lengths must match");
        for (uint i = 0; i < names.length; i++) {
            require(Address.isContract(destinations[i]), "Must be contract address");
            repository[names[i]] = destinations[i];
        }
    }

    function getAddress(bytes32 name) public view returns (address) {
        return repository[name];
    }

    function requireAndGetAddress(bytes32 name, string calldata reason) public view returns (address) {
        address _foundAddress = repository[name];
        require(_foundAddress != address(0), reason);
        return _foundAddress;
    }
}
