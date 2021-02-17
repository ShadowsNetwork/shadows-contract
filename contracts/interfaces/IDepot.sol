pragma solidity 0.4.25;


/**
 * @title Shadows Depot interface
 */
contract IDepot {
    function exchangeEtherForSynths() public payable returns (uint);

    function exchangeEtherForSynthsAtRate(uint guaranteedRate) external payable returns (uint);

    function depositSynths(uint amount) external;

    function withdrawMyDepositedSynths() external;

    // Deprecated ABI for MAINNET. Only used on Testnets
    function exchangeEtherForDOWS() external payable returns (uint);

    function exchangeEtherForDOWSAtRate(uint guaranteedRate) external payable returns (uint);

    function exchangeSynthsForDOWS() external payable returns (uint);
}
