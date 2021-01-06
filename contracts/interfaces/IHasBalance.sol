pragma solidity >=0.4.24;


// https://docs.shadows.link/contracts/source/interfaces/ihasbalance
interface IHasBalance {
    // Views
    function balanceOf(address account) external view returns (uint);
}
