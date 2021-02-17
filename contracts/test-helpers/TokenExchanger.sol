/* TokenExchanger.sol: Used for testing contract to contract calls on chain 
 * with Shadows for testing ERC20 compatability
 */
pragma solidity 0.4.25;

import "../Owned.sol";
import "../interfaces/IShadows.sol";
import "../interfaces/IFeePool.sol";
import "../interfaces/IERC20.sol";


contract TokenExchanger is Owned {
    address public integrationProxy;
    address public shadows;

    constructor(address _owner, address _integrationProxy) public Owned(_owner) {
        integrationProxy = _integrationProxy;
    }

    function setShadowsProxy(address _integrationProxy) external onlyOwner {
        integrationProxy = _integrationProxy;
    }

    function setShadows(address _shadows) external onlyOwner {
        shadows = _shadows;
    }

    function checkBalance(address account) public view shadowsProxyIsSet returns (uint) {
        return IERC20(integrationProxy).balanceOf(account);
    }

    function checkAllowance(address tokenOwner, address spender) public view shadowsProxyIsSet returns (uint) {
        return IERC20(integrationProxy).allowance(tokenOwner, spender);
    }

    function checkBalanceDOWSDirect(address account) public view shadowsProxyIsSet returns (uint) {
        return IERC20(shadows).balanceOf(account);
    }

    function getDecimals(address tokenAddress) public view returns (uint) {
        return IERC20(tokenAddress).decimals();
    }

    function doTokenSpend(address fromAccount, address toAccount, uint amount) public shadowsProxyIsSet returns (bool) {
        // Call Immutable static call #1
        require(checkBalance(fromAccount) >= amount, "fromAccount does not have the required balance to spend");

        // Call Immutable static call #2
        require(
            checkAllowance(fromAccount, address(this)) >= amount,
            "I TokenExchanger, do not have approval to spend this guys tokens"
        );

        // Call Mutable call
        return IERC20(integrationProxy).transferFrom(fromAccount, toAccount, amount);
    }

    modifier shadowsProxyIsSet {
        require(integrationProxy != address(0), "Shadows Integration proxy address not set");
        _;
    }

    event LogString(string name, string value);
    event LogInt(string name, uint value);
    event LogAddress(string name, address value);
    event LogBytes(string name, bytes4 value);
}
