# Shadows

Shadows is a decentralized synthetic asset issuance protocol built on Substrate. The value of these synthetic assets is underpinned by DOWS, and as long as DOWS is locked in a smart contract, synthetic assets can be issued.

Unique debt pool design mechanism.
Trading of synthetic assets is essentially a transfer between debts. Smart contracts automatically execute the conversion of a synthetic asset to another synthetic asset without an order book, without counterparties, and without the problems of liquidity and trading slippage.

## DApps

* https://reactor.shadows.link

## Usage and requirements

### For tests (in javascript)

Install the dependencies for the project using npm

```
$ npm i
```

To run the tests:

```
$ npm test
```

## Contracts

- **ExchangeRates.sol:** A key value store (bytes4 -> uint) of currency exchange rates, all priced in USD. Understands the concept of whether a rate is stale (as in hasn't been updated frequently enough), and only allows a single annointed oracle address to do price updates.
- **ExternStateToken.sol:** The concept of an ERC20 token which stores its allowances and balances outside of the contract for upgradability.
- **FeePool.sol:** Understands fee information for Shadows. As users transact, their fees are kept in `0xfeefeefee...` and stored in xUSDs. Allows users to claim fees they're entitled to.
- **Shadows.sol:** Has a list of Synths and understands issuance data for users to be able to mint and burn Synths.
- **ShadowsEscrow.sol:** During the crowdsale, users were asked to escrow their Havvens to insulate against price shocks on the token. Users are able to unlock their DOWS on a vesting schedule.
- **Depot.sol:** Allows users to exchange ETH for xUSD and DOWS (has not yet been updated for multicurrency).
- **LimitedSetup.sol:** Some contracts have actions that should only be able to be performed during a specific limited setup period. After this period elapses, any functions using the `onlyDuringSetup` modifier should no longer be callable.
- **Migrations.sol:** Truffle's migrations contract.
- **Synth.sol:** Synth token contract which remits fees on transfers, and directs the Shadows contract to do exchanges when appropriate.
- **SynthAirdropper.sol:** Used to optimise gas during our initial airdrop of Synth.
- **Owned.sol:** Allows us to leverage the concept of a contract owner that is specially priviledged and can perform certain actions.
- **Pausable.sol:** Implements the concept of a pause button on a contract. Methods that should be paused use a particular modifier.
- **Proxy.sol:** Our proxy contracts which forward all calls they receive to their target. Events are always emitted at the proxy, not within the target, even if you call the target directly.
- **Proxyable.sol:** Implemented on a contract so it can be the target of a proxy contract.
- **SafeDecimalMath.sol:** Safe math + decimal math. Using `_dec` on an operation makes it operate "on decimals" by either dividing out the extra UNIT after a multiplication, or multiplying it in before a division.
- **SelfDestructible.sol:** Allows an owner of a contract to set a self destruct timer on it, then once the timer has expired, to kill the contract with `selfdestruct`.
- **State.sol:** Implements the concept of an associated contract which can be changed by the owner.
- **TokenState.sol:** Holds approval and balance information for tokens.

## publish
publish to BSC
```
node publish deploy -n bsctestnet -d publish/deployed/bsctestnet -a -v ${private key} -y -g 20
```

veryfy to BSC
```
node publish verify --deployment-path publish/deployed/bsctestnet
```