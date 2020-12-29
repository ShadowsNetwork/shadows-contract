/*
-----------------------------------------------------------------
FILE INFORMATION
-----------------------------------------------------------------
file:       LimitedSetup.sol
-----------------------------------------------------------------
*/

pragma solidity ^0.4.21;

/**
 * @title Any function decorated with the modifier this contract provides
 * deactivates after a specified setup period.
 */
contract LimitedSetup {

    uint setupExpiryTime;

    /**
     * @dev Constructor.
     * @param setupDuration The time the setup period will last for.
     */
    function LimitedSetup(uint setupDuration)
        public
    {
        setupExpiryTime = now + setupDuration;
    }

    modifier setupFunction
    {
        require(now < setupExpiryTime);
        _;
    }
}
