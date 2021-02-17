# Synth

This contract is the basis of all Synth flavours.
It exposes sufficient functionality for the [`Shadows`](Shadows.md) and [`FeePool`](FeePool.md) contracts to manage its supply. Otherwise Synths are fairly vanilla ERC20 tokens; the [`PurgeableSynth`](PurgeableSynth.md) contract extends this basic functionality to allow the owner to liquidate a Synth if its total value is low enough.

See the [main synth notes](../../synths) for more information about how Synths function in practice.

???+ note "A Note on Conversion Fees"

    Since transfer conversion is not operating, the following is recorded only to be kept in mind in case it is ever reactivated. At present there is no way for users to set a preferred currency.

    The Shadows system has implements both [exchange](FeePool.md#exchangefeerate) and [transfer](FeePool.md#transferfeerate) fees on Synths. Although they should be distinct, the preferred currency auto conversion on transfer only charges the transfer fee, and not the exchange fee.
    As a result, it is possible to convert Synths more cheaply whenever the transfer fee is less than the conversion fee.

    Given that the transfer fee is currently nil, if a user was able to set a preferred currency for themselves, it would be possible by this means to perform free Synth conversions. This would
    undercut fee revenue for the system to incentivise participants with. If markets had priced in the conversion fee, but were unaware of the exploit, then there would be a profit cycle available for someone exploiting this.

    In particular:

    Let $\phi_\kappa, \ \phi_\tau \in [0,1]$ be the conversion and transfer fee rates, respectively.
    Let $\pi_A, \ \pi_B$ be the prices of synths $A$ and $B$ in terms of some implicit common currency.
    $Q_A$ will be the starting quantity of synth $A$.

    Then to convert from $A$ to $B$, quantities

    $$
    Q^\kappa_B = Q_A\frac{\pi_A}{\pi_B}(1 - \phi_\kappa) \\
    Q^\tau_B = Q_A\frac{\pi_A}{\pi_B}(1 - \phi_\tau)
    $$

    are received if the user performs a standard conversion or a transfer conversion, respectively.
    The profit of performing a transfer conversion relative to a standard one is then:

    $$
    Q^\tau_B - Q^\kappa_B = Q_A\frac{\pi_A}{\pi_B}(\phi_\kappa - \phi_\tau)
    $$

    That is, the relative profit is simply $(\phi_\kappa - \phi_\tau)$. With no transfer fee, this is $\phi_\kappa$, as expected.

**Source:** [Synth.sol](https://github.com/Shadowsio/shadows/blob/master/contracts/Synth.sol)

## Architecture

---

### Inheritance Graph

<centered-image>
    ![Synth inheritance graph](../img/graphs/Synth.svg)
</centered-image>

---

## Variables

---

### `feePool`

The address of the [`FeePool`](FeePool.md) contract.

**Type:** `FeePool public`

---

### `shadows`

The address of the [`Shadows`](Shadows.md) contract.

**Type:** `FeePool public`

---

### `currencyKey`

The [identifier](Shadows.md#synths) of this Synth within the Shadows ecosystem. The currency key could in principle be distinct from this token's [ERC20 symbol](ExternStateToken.md#symbol).

**Type:** `bytes32`

---

### `DECIMALS`

The number of decimal places this token uses. Fixed at $18$.

**Type:** `uint8 constant`

**Value:** `18`

---

## Functions

---

### `constructor`

Initialises the [`feePool`](#feepool) and [`shadows`](#shadows) addresses, this Synth's [`currencyKey`](#currencyKey), and the inherited [`ExternStateToken`](ExternStateToken.md) instance.

The precision in every Synth's fixed point representation is fixed at 18 so they are all conveniently [interconvertible](ExchangeRates.md#effectivevalue). The total supply of all new Synths is initialised to 0 since they must be created by the [`Shadows`](Shadows.md) contract when [issuing](Shadows.md#issuesynths) or [converting between](Shadows.md#exchange) Synths, or by the [`FeePool`](FeePool.md) when users [claim fees](FeePool.md#claimfees).

??? example "Details"

    **Signature**

    `constructor(address _proxy, TokenState _tokenState, Shadows _shadows, IFeePool _feePool, string _tokenName, string _tokenSymbol, address _owner, bytes32 _currencyKey) public`

    **Superconstructors**

    * [`ExternStateToken(_proxy, _tokenState, _tokenName, _tokenSymbol, 0, DECIMALS, _owner)`](ExternStateToken.md#constructor)

    **Preconditions**

    * The provided proxy, shadows, fee pool, and owner addresses must not be zero.
    * The provided currency key must not already be [registered on shadows](Shadows.md#synths).

---

### `setShadows`

Allows the owner to set the address of the [`shadows`](Shadows.md) contract.

??? example "Details"

    **Signature**

    `setShadows(Shadows _shadows) external`

    **Modifiers**

    * [`Proxyable.optionalProxy_onlyOwner`](Proxyable.md#optionalproxy_onlyowner)

    **Emits**

    * [`ShadowsUpdated(_shadows)`](#shadowsupdated)

---

### `setFeePool`

Allows the owner to set the address of the [`feePool`](FeePool.md) contract.

??? example "Details"

    **Signature**

    `setFeePool(FeePool _feePool) external`

    **Modifiers**

    * [`Proxyable.optionalProxy_onlyOwner`](Proxyable.md#optionalproxy_onlyowner)

    **Emits**

    * [`FeePoolUpdated(_feePool)`](#feepoolupdated)

---

### `transfer`

This is a pair of ERC20 transfer function.

Implemented based on [`ExternStateToken._transfer_byProxy`](ExternStateToken#_transfer_byproxy).

??? example "Details"

    **Signatures**

    * `transfer(address to, uint value) public returns (bool)`

    **Modifiers**

    * [`Proxyable.optionalProxy`](Proxyable.md#optionalproxy)

---

### `transferFrom`

This is a ERC20 transferFrom function.

Implemented based on [`ExternStateToken._transferFrom_byProxy`](ExternStateToken#_transferfrom_byproxy).

??? example "Details"

    **Signatures**

    * `transferFrom(address from, address to, uint value) public returns (bool)`
    * `transfer(address from, address to, uint value) public returns (bool)`

    **Modifiers**

    * [`Proxyable.optionalProxy`](Proxyable.md#optionalproxy)

---

---

### `_internalTransfer`

This function implements all of the other ERC20 transfer functions supported by this contract. It is itself simply a wrapper to [`ExternStateToken._internalTransfer`](ExternStateToken.md#_internalTransfer).

!!! danger "Dormant Preferred Currency Conversion"

    If [`ShadowsState.preferredCurrency(to)`](ShadowsState.md#preferredcurrency) is nonzero, this function automatically performs an exchange into the preferred Synth flavour using [`Shadows.synthInitiatedExchange`](Shadows.md#synthinitiatedexchange). However, there is currently no way for accounts to set their preferred currency, so this feature has effectively been deactivated.

??? example "Details"

    **Signature**

    `_internalTransfer(address from, address to, uint value) internal returns (bool)`

    **Preconditions and Events**

    As per [`ExternStateToken._internalTransfer`](ExternStateToken.md#_internalTransfer).

---

### `issue`

Allows the [`Shadows`](Shadows.md) contract to issue new Synths of this flavour. This is used whenever Synths are [exchanged](Shadows.md#_internalexchange) or [issued directly](Shadows.md#issuesynths). This is also used by the [`FeePool`](FeePool.md) to [pay fees out](FeePool.md#_payfees).

??? example "Details"

    **Signature**

    `issue(address account, uint amount) external`

    **Modifiers**

    * [`onlyShadowsOrFeePool`](#onlyshadowsorfeepool)

    **Emits**

    * [`Transfer(address(0), account, amount)`](ExternStateToken.md#transfer)
    * [`Issued(account, amount)`](#issued)

---

### `burn`

Allows the [`Shadows`](Shadows.md) contract to burn existing Synths of this flavour. This is used whenever Synths are [exchanged](Shadows.md#_internalexchange) or [burnt directly](Shadows.md#burnSynths). This is also used to burn Synths involved in oracle frontrunning as part of the [protection circuit](Shadows.md#protectioncircuit). This is also used by the [`FeePool`](FeePool.md) to [burn xUSD when fees are paid out](FeePool.md#_payfees).

??? example "Details"

    **Signature**

    `burn(address account, uint amount) external`

    **Modifiers**

    * [`onlyShadowsOrFeePool`](#onlyshadowsorfeepool)

    **Emits**

    * [`Transfer(account, address(0), amount)`](ExternStateToken.md#transfer)
    * [`Burned(account, amount)`](#burned)

---

### `setTotalSupply`

This allows the owner to set the total supply directly for upgrades, where the [`tokenState`](ExternStateToken.md#tokenstate) is retained, but the total supply figure must be migrated.

For example, just such a migration is performed by [this script](https://github.com/Shadowsio/shadows/blob/master/publish/src/commands/replace-synths.js).

??? example "Details"

    **Signature**

    `setTotalSupply(uint amount) external`

    **Modifiers**

    * [`Proxyable.optionalProxy_onlyOwner`](Proxyable.md#optionalproxy_onlyowner)

---

## Modifiers

---

### `onlyShadowsOrFeePool`

Reverts the transaction if the `msg.sender` is neither [`shadows`](#shadows) nor [`feePool`](#feepool).

---

**Signature:** `notFeeAddress(address account)`

---

## Events

---

### `ShadowsUpdated`

Records that the [`shadows`](#shadows) address was [updated](#setshadows).

This event is emitted from the Synths's [proxy](Proxy.md#_emit) with the `emitShadowsUpdated` function.

**Signature:** `ShadowsUpdated(address newShadows)`

---

### `FeePoolUpdated`

Records that the [`feePool`](#feepool) address was [updated](#setfeepool).

This event is emitted from the Synths's [proxy](Proxy.md#_emit) with the `emitFeePoolUpdated` function.

**Signature:** `FeePoolUpdated(address newFeePool)`

---

### `Issued`

Records that a quantity of this Synth was newly [issued](#issue).

This event is emitted from the Synths's [proxy](Proxy.md#_emit) with the `emitIssued` function.

**Signature:** `Issued(address indexed account, uint value)`

---

### `Burned`

Records that a quantity of this Synth was [burned](#burn).

This event is emitted from the Synths's [proxy](Proxy.md#_emit) with the `emitBurned` function.

**Signature:** `Burned(address indexed account, uint value)`

---
