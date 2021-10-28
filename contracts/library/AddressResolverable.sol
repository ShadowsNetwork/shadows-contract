// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import "./AddressResolver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AddressResolverable is Ownable {
    AddressResolver public resolver;

    constructor(address _resolver)  {
        resolver = AddressResolver(_resolver);
    }

    function setResolver(AddressResolver _resolver) public onlyOwner {
        resolver = _resolver;
    }
}
