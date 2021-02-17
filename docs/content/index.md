![Shadows](img/logos/shadows_text_logo.png)

# System Documentation

## Introduction

Welcome to the Shadows system documentation. These pages contain a description of how Shadows operates; provided are high-level discussions of the system mechanics, as well as thorough technical specifications of the smart contract architecture and API. We hope this assists users and developers to understand the system, and to build on top of it.

## Get In Touch

* **Chat:** If you’re looking for somewhere to talk with the Shadows team or with other developers about Shadows, please visit our [Discord](https://discordapp.com/invite/AEdUHzt) or [/r/shadows_io](https://reddit.com/r/shadows_io) on reddit.
* **Read:** For updates, announcements, and information, check out our blog at [https://blog.shadows.io/](https://blog.shadows.io/), @twitter:shadows_io on Twitter, or our [Telegram channel](https://t.me/havven_news).
* **Email:** Otherwise you can [contact us by email](https://www.shadows.io/contact-us).

## Developer Resources

* **Code:** Open source repositories are available @shadowsio; the main Shadows repo is @shadowsio/shadows.
* **Smart Contract API:** Descriptions of all Shadows smart contracts, their APIs, and a listing of deployed instances can be found [here](contracts).
* **ShadowsJS:** Shadows offers a Javascript library which provides a simple interface to communicate with Shadows contracts. Under the hood this library uses [ethers.js](https://github.com/ethers-io/ethers.js). The source is available @shadowsio/shadows-js or just `npm i shadows-js`.
* **GraphQL API:** The system can also be queried through a GraphQL endpoint via [The Graph](https://thegraph.com/explorer/subgraph/shadowsio-team/shadows); source code available at @shadowsio/shadows-subgraph.

## Integrations and Dapps

* **Shadows Dashboard:** Provides an overview of the status of the Shadows system including price, token supply, exchange volume, fee pool size, open interest, and current collateralisation levels. The dashboard also provides listings of exchanges where [DOWS](https://dashboard.shadows.io/buy-dows) and [xUSD](https://dashboard.shadows.io/buy-xusd) are traded. The dashboard is available at [https://dashboard.shadows.io](https://dashboard.shadows.io).
* **Shadows.exchange:** The [Shadows Exchange](https://www.shadows.io/products/exchange) allows users to trade synths, and to buy xUSD with ether. Shadows.Exchange has also played host to [trading competitions](https://blog.shadows.io/shadows-exchange-trading-competition-v3/) offering DOWS prizes to the most successful participants. The source code for Shadows.Exchange can be found at @shadowsio/shadows-exchange. A twitter bot that reports statistics for the exchange posts daily at @twitter:SynthXBot.
* **Mintr:** [Mintr](https://www.shadows.io/products/mintr) is a dApp for DOWS holders to participate in the Shadows Network. Using Mintr, users can mint and burn Synths, monitor their collateralisation levels, buy and sell xUSD through the [Depot](contracts/Depot.md), claim their staking rewards, and vest any DOWS they have accrued from the token sale or by staking.
* **UniSwap:** [Uniswap](https://uniswap.io/) is a decentralised exchange for exchanging ETH and ERC20 tokens. Shadows integrates with it to deepen the Shadows ecosystem's liquidity, and it acts as an on-ramp/off-ramp for the Synth market. Users who provide liquidity to the [ETH/xETH pool](https://uniswap.exchange/swap/0x42456D7084eacF4083f1140d3229471bbA2949A8) are provided with staking rewards as [part of the Shadows protocol](https://sips.shadows.io/sips/sip-8). This is discussed further [here](https://blog.shadows.io/uniswap-seth-pool-incentives/) and [here](https://blog.shadows.io/dows-arbitrage-pool/).
* **KyberSwap:** Liquidity is further deepened by the integration of DOWS and xUSD with [KyberSwap](https://kyberswap.com/swap/eth-dows), which is built on the [Kyber Network Protocol](https://kyber.network/). An example use case is described [here](https://blog.shadows.io/dows-liquidity-has-been-added-to-kyberswap/).
