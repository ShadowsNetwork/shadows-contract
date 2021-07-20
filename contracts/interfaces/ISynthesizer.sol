// SPDX-License-Identifier: MI
pragma solidity >=0.6.0 <0.8.0;

import "../Synth.sol";

abstract contract ISynthesizer {
    uint256 public totalSupply;

    uint256 public issuanceRatio;

    mapping(bytes32 => Synth) public synths;

    mapping(address => bytes32) public synthsByAddress;

    uint256[] public debtLedger;

    function balanceOf(address account) external view virtual returns (uint256);

    function transfer(address to, uint256 value)
        external
        virtual
        returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external virtual returns (bool);

    function exchange(
        bytes32 sourceCurrencyKey,
        uint256 sourceAmount,
        bytes32 destinationCurrencyKey
    ) external virtual returns (uint256 amountReceived);

    function issueSynths(uint256 amount) external virtual;

    function issueMaxSynths() external virtual;

    function burnSynths(uint256 amount) external virtual;

    function settle(bytes32 currencyKey)
        external
        virtual
        returns (uint256 reclaimed, uint256 refunded);

    function collateralisationRatio(address issuer)
        external
        view
        virtual
        returns (uint256);

    function totalIssuedSynths(bytes32 currencyKey)
        external
        view
        virtual
        returns (uint256);

    function totalIssuedSynthsExcludeEtherCollateral(bytes32 currencyKey)
        external
        view
        virtual
        returns (uint256);

    function debtBalanceOf(address issuer, bytes32 currencyKey)
        external
        view
        virtual
        returns (uint256);

    function remainingIssuableSynths(address issuer)
        external
        view
        virtual
        returns (uint256, uint256);

    function isWaitingPeriod(bytes32 currencyKey)
        external
        view
        virtual
        returns (bool);

    function debtLedgerLength() external view virtual returns (uint256);

    function transferableShadows(address account)
        external
        view
        virtual
        returns (uint256);

    function liquidateDelinquentAccount(
        address account,
        uint256 susdAmount,
        address liquidator
    )
        external
        virtual
        returns (uint256 totalRedeemed, uint256 amountToLiquidate);
}
