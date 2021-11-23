// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "./interfaces/ISynthesizer.sol";

contract Shadows is
    Initializable,
    OwnableUpgradeable,
    ERC20PausableUpgradeable
{
    // Maximum Total Supply 100 M
    uint256 constant maxTotalSupply = 1e8 ether;

    ISynthesizer public synthesizer;

    function initialize() external initializer {
        __Ownable_init();
        __ERC20_init("Shadows", "DOWS");
        __ERC20Pausable_init();
        _mint(_msgSender(), 37000000 ether);
    }

    function liquidateDelinquentAccount(address account, uint256 susdAmount)
        external
    {
        require(
            address(synthesizer) != address(0),
            "Missing Synthesizer address"
        );
        (uint256 totalRedeemed, uint256 amountLiquidated) = synthesizer
        .liquidateDelinquentAccount(account, susdAmount, _msgSender());

        emit AccountLiquidated(
            account,
            totalRedeemed,
            amountLiquidated,
            _msgSender()
        );

        // Transfer DOWS redeemed to messageSender
        // Reverts if amount to redeem is more than balanceOf account, ie due to escrowed balance
        _transfer(account, _msgSender(), totalRedeemed);
    }

    function transfer(address recipient, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        if (address(synthesizer) != address(0)) {
            require(
                amount <= synthesizer.transferableShadows(_msgSender()),
                "Cannot transfer staked DOWS"
            );
        }
        super.transfer(recipient, amount);
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        if (address(synthesizer) != address(0)) {
            require(
                amount <= synthesizer.transferableShadows(sender),
                "Cannot transfer staked DOWS"
            );
        }
        super.transferFrom(sender, recipient, amount);
        return true;
    }

    function _beforeTokenTransfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal override {
        // if (address(synthesizer) != address(0)) {
        //     require(
        //         amount <= synthesizer.transferableShadows(sender),
        //         "Cannot transfer staked DOWS"
        //     );
        // }
        return super._beforeTokenTransfer(sender, recipient, amount);
    }

    function mint(address account, uint256 amount) external onlyOwner {
        _mint(account, amount);
    }

    function _mint(address account, uint256 amount) internal override {
        uint256 totalSupply = super.totalSupply();
        require(
            maxTotalSupply >= totalSupply + amount,
            "Max total supply over"
        );

        super._mint(account, amount);
    }

    function setSynthesizer(ISynthesizer _synthesizer) external onlyOwner {
        // require(
        // address(_synthesizer) != address(0),
        //    "synthesizer can not be zero address"
        // );
        synthesizer = _synthesizer;
        emit SynthesizerUpdated(_synthesizer);
    }

    event SynthesizerUpdated(ISynthesizer _synthesizer);
    event AccountLiquidated(
        address indexed account,
        uint256 dowsRedeemed,
        uint256 amountLiquidated,
        address liquidator
    );
}
