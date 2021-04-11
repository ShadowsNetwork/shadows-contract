// SPDX-License-Identifier: MI
pragma solidity >=0.6.0 <0.8.0;


interface IExchanger {
    function maxSecsLeftInWaitingPeriod(address account, bytes32 currencyKey) external view returns (uint);

    function settlementOwing(address account, bytes32 currencyKey)
        external
        view
        returns (uint reclaimAmount, uint rebateAmount);

    function settle(address from, bytes32 currencyKey) external returns (uint reclaimed, uint refunded);

    function exchange(
        address from,
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        address destinationAddress
    ) external returns (uint amountReceived);

    function calculateAmountAfterSettlement(address from, bytes32 currencyKey, uint amount, uint refunded)
        external
        view
        returns (uint amountAfterSettlement);
}
