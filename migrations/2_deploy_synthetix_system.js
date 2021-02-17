const { table } = require('table');
const { gray, green } = require('chalk');

const { toBytes32 } = require('../.');

const AddressResolver = artifacts.require('AddressResolver');
const EtherCollateral = artifacts.require('EtherCollateral');
const ExchangeRates = artifacts.require('ExchangeRates');
const FeePool = artifacts.require('FeePool');
const FeePoolState = artifacts.require('FeePoolState');
const FeePoolEternalStorage = artifacts.require('FeePoolEternalStorage');
const DelegateApprovals = artifacts.require('DelegateApprovals');
const Shadows = artifacts.require('Shadows');
const Exchanger = artifacts.require('Exchanger');
const ExchangeState = artifacts.require('ExchangeState');
const Issuer = artifacts.require('Issuer');
const ShadowsEscrow = artifacts.require('ShadowsEscrow');
const RewardEscrow = artifacts.require('RewardEscrow');
const RewardsDistribution = artifacts.require('RewardsDistribution');
const ShadowsState = artifacts.require('ShadowsState');
const SupplySchedule = artifacts.require('SupplySchedule');
const Synth = artifacts.require('Synth');
const MultiCollateralSynth = artifacts.require('MultiCollateralSynth');
const Owned = artifacts.require('Owned');
const Proxy = artifacts.require('Proxy');
// const ProxyERC20 = artifacts.require('ProxyERC20');
const PublicSafeDecimalMath = artifacts.require('PublicSafeDecimalMath');
const PublicMath = artifacts.require('PublicMath');
const PurgeableSynth = artifacts.require('PurgeableSynth');
const SafeDecimalMath = artifacts.require('SafeDecimalMath');
const MathLib = artifacts.require('Math');
const TokenState = artifacts.require('TokenState');
const Depot = artifacts.require('Depot');
const SelfDestructible = artifacts.require('SelfDestructible');
const DappMaintenance = artifacts.require('DappMaintenance');

// Update values before deployment
const ZERO_ADDRESS = '0x' + '0'.repeat(40);
const SHADOWS_TOTAL_SUPPLY = web3.utils.toWei('100000000');

module.exports = async function(deployer, network, accounts) {
	const [deployerAccount, owner, oracle, fundsWallet] = accounts;

	// Note: This deployment script is not used on mainnet, it's only for testing deployments.

	// The Owned contract is not used in a standalone way on mainnet, this is for testing
	// ----------------
	// Owned
	// ----------------
	await deployer.deploy(Owned, owner, { from: deployerAccount });

	// ----------------
	// Safe Decimal Math library
	// ----------------
	console.log(gray('Deploying SafeDecimalMath...'));
	await deployer.deploy(SafeDecimalMath, { from: deployerAccount });

	// ----------------
	// Math library
	// ----------------
	console.log(gray('Deploying Math library...'));
	deployer.link(SafeDecimalMath, MathLib);
	await deployer.deploy(MathLib, { from: deployerAccount });

	// The PublicSafeDecimalMath contract is not used in a standalone way on mainnet, this is for testing
	// ----------------
	// Public Safe Decimal Math Library
	// ----------------
	deployer.link(SafeDecimalMath, PublicSafeDecimalMath);
	await deployer.deploy(PublicSafeDecimalMath, { from: deployerAccount });

	// The PublicMath contract is not used in a standalone way on mainnet, this is for testing
	// ----------------
	// Public Math Library
	// ----------------
	deployer.link(SafeDecimalMath, PublicMath);
	deployer.link(MathLib, PublicMath);
	await deployer.deploy(PublicMath, { from: deployerAccount });

	// ----------------
	// AddressResolver
	// ----------------
	console.log(gray('Deploying AddressResolver...'));
	const resolver = await deployer.deploy(AddressResolver, owner, { from: deployerAccount });

	// ----------------
	// Exchange Rates
	// ----------------
	console.log(gray('Deploying ExchangeRates...'));
	deployer.link(SafeDecimalMath, ExchangeRates);
	const exchangeRates = await deployer.deploy(
		ExchangeRates,
		owner,
		oracle,
		[toBytes32('DOWS')],
		[web3.utils.toWei('0.2', 'ether')],
		{ from: deployerAccount }
	);

	// ----------------
	// Escrow
	// ----------------
	console.log(gray('Deploying ShadowsEscrow...'));
	const escrow = await deployer.deploy(ShadowsEscrow, owner, ZERO_ADDRESS, {
		from: deployerAccount,
	});

	console.log(gray('Deploying RewardEscrow...'));
	const rewardEscrow = await deployer.deploy(RewardEscrow, owner, ZERO_ADDRESS, ZERO_ADDRESS, {
		from: deployerAccount,
	});

	// ----------------
	// Shadows State
	// ----------------
	console.log(gray('Deploying ShadowsState...'));
	// constructor(address _owner, address _associatedContract)
	deployer.link(SafeDecimalMath, ShadowsState);
	const shadowsState = await deployer.deploy(ShadowsState, owner, ZERO_ADDRESS, {
		from: deployerAccount,
	});

	// ----------------
	// Fee Pool - Delegate Approval
	// ----------------
	console.log(gray('Deploying Delegate Approvals...'));
	const delegateApprovals = await deployer.deploy(DelegateApprovals, owner, ZERO_ADDRESS, {
		from: deployerAccount,
	});

	// ----------------
	// Fee Pool
	// ----------------
	console.log(gray('Deploying FeePoolProxy...'));
	// constructor(address _owner)
	const feePoolProxy = await Proxy.new(owner, { from: deployerAccount });

	console.log(gray('Deploying FeePoolState...'));
	deployer.link(SafeDecimalMath, FeePoolState);
	const feePoolState = await deployer.deploy(FeePoolState, owner, ZERO_ADDRESS, {
		from: deployerAccount,
	});

	console.log(gray('Deploying FeePoolEternalStorage...'));
	deployer.link(SafeDecimalMath, FeePoolEternalStorage);
	const feePoolEternalStorage = await deployer.deploy(FeePoolEternalStorage, owner, ZERO_ADDRESS, {
		from: deployerAccount,
	});

	console.log(gray('Deploying FeePool...'));
	deployer.link(SafeDecimalMath, FeePool);
	const feePool = await deployer.deploy(
		FeePool,
		feePoolProxy.address,
		owner,
		web3.utils.toWei('0.0030', 'ether'),
		resolver.address,
		{ from: deployerAccount }
	);

	await feePoolProxy.setTarget(feePool.address, { from: owner });

	// Set feePool on feePoolState & rewardEscrow
	await feePoolState.setFeePool(feePool.address, { from: owner });
	await rewardEscrow.setFeePool(feePool.address, { from: owner });

	// Set delegate approval on feePool
	// Set feePool as associatedContract on delegateApprovals & feePoolEternalStorage
	await delegateApprovals.setAssociatedContract(feePool.address, { from: owner });
	await feePoolEternalStorage.setAssociatedContract(feePool.address, { from: owner });

	// ----------------------
	// Deploy RewardDistribution
	// ----------------------
	console.log(gray('Deploying RewardsDistribution...'));
	const rewardsDistribution = await deployer.deploy(
		RewardsDistribution,
		owner,
		ZERO_ADDRESS, // Authority = Shadows Underlying
		ZERO_ADDRESS, // Shadows ProxyERC20
		rewardEscrow.address,
		feePoolProxy.address, // FeePoolProxy
		{
			from: deployerAccount,
		}
	);

	// ----------------
	// Shadows
	// ----------------
	console.log(gray('Deploying SupplySchedule...'));
	// constructor(address _owner)
	deployer.link(SafeDecimalMath, SupplySchedule);
	deployer.link(MathLib, SupplySchedule);

	const lastMintEvent = 0; // No mint event, weeksSinceIssuance will use inflation start date
	const weeksOfRewardSupply = 0;
	const supplySchedule = await deployer.deploy(
		SupplySchedule,
		owner,
		lastMintEvent,
		weeksOfRewardSupply,
		{
			from: deployerAccount,
		}
	);

	console.log(gray('Deploying ShadowsProxy...'));
	// constructor(address _owner)
	const shadowsProxy = await Proxy.new(owner, { from: deployerAccount });

	console.log(gray('Deploying ShadowsTokenState...'));
	// constructor(address _owner, address _associatedContract)
	const shadowsTokenState = await TokenState.new(owner, deployerAccount, {
		from: deployerAccount,
	});

	console.log(gray('Deploying Shadows...'));
	deployer.link(SafeDecimalMath, Shadows);
	const shadows = await deployer.deploy(
		Shadows,
		shadowsProxy.address,
		shadowsTokenState.address,
		owner,
		SHADOWS_TOTAL_SUPPLY,
		resolver.address,
		{
			from: deployerAccount,
			gas: 8000000,
		}
	);

	// ----------------------
	// Connect Token State
	// ----------------------
	// Set initial balance for the owner to have all Havvens.
	await shadowsTokenState.setBalanceOf(owner, web3.utils.toWei('100000000'), {
		from: deployerAccount,
	});

	await shadowsTokenState.setAssociatedContract(shadows.address, { from: owner });

	// ----------------------
	// Connect Proxy
	// ----------------------
	await shadowsProxy.setTarget(shadows.address, { from: owner });

	// ----------------------
	// Connect Escrow to Shadows
	// ----------------------
	await escrow.setShadows(shadows.address, { from: owner });
	await rewardEscrow.setShadows(shadows.address, { from: owner });

	// ----------------------
	// Connect SupplySchedule
	// ----------------------
	await supplySchedule.setShadowsProxy(shadowsProxy.address, { from: owner });

	// ----------------------
	// Connect RewardsDistribution
	// ----------------------
	await rewardsDistribution.setAuthority(shadows.address, { from: owner });
	await rewardsDistribution.setShadowsProxy(shadowsProxy.address, { from: owner });

	// ----------------
	// Synths
	// ----------------
	const currencyKeys = ['XDR', 'xUSD', 'xAUD', 'xEUR', 'xBTC', 'iBTC', 'xETH'];
	// const currencyKeys = ['xUSD', 'xETH'];
	// Initial prices
	const { timestamp } = await web3.eth.getBlock('latest');
	// xAUD: 0.5 USD
	// xEUR: 1.25 USD
	// xBTC: 0.1
	// iBTC: 5000 USD
	// DOWS: 4000 USD
	await exchangeRates.updateRates(
		currencyKeys
			.filter(currency => currency !== 'xUSD')
			.concat(['DOWS'])
			.map(toBytes32),
		// ['172', '1.20'].map(number =>
		['5', '0.5', '1.25', '0.1', '5000', '4000', '172'].map(number =>
			web3.utils.toWei(number, 'ether')
		),
		timestamp,
		{ from: oracle }
	);

	const synths = [];

	deployer.link(SafeDecimalMath, PurgeableSynth);

	for (const currencyKey of currencyKeys) {
		console.log(gray(`Deploying SynthTokenState for ${currencyKey}...`));
		const tokenState = await deployer.deploy(TokenState, owner, ZERO_ADDRESS, {
			from: deployerAccount,
		});

		console.log(gray(`Deploying SynthProxy for ${currencyKey}...`));
		const proxy = await deployer.deploy(Proxy, owner, { from: deployerAccount });

		let SynthSubclass = Synth;
		// Determine class of Synth
		if (currencyKey === 'xETH') {
			SynthSubclass = MultiCollateralSynth;
		}

		const synthParams = [
			SynthSubclass,
			proxy.address,
			tokenState.address,
			`Synth ${currencyKey}`,
			currencyKey,
			owner,
			toBytes32(currencyKey),
			web3.utils.toWei('0'),
			resolver.address,
			{ from: deployerAccount },
		];

		if (currencyKey === 'xETH') {
			synthParams.splice(synthParams.length - 1, 0, toBytes32('EtherCollateral'));
		}

		console.log(`Deploying ${currencyKey} Synth...`);

		const synth = await deployer.deploy(...synthParams);

		console.log(gray(`Setting associated contract for ${currencyKey} token state...`));
		await tokenState.setAssociatedContract(synth.address, { from: owner });

		console.log(gray(`Setting proxy target for ${currencyKey} proxy...`));
		await proxy.setTarget(synth.address, { from: owner });

		// ----------------------
		// Connect Shadows to Synth
		// ----------------------
		console.log(gray(`Adding ${currencyKey} to Shadows contract...`));
		await shadows.addSynth(synth.address, { from: owner });

		synths.push({
			currencyKey,
			tokenState,
			proxy,
			synth,
		});
	}

	// --------------------
	// Depot
	// --------------------
	console.log(gray('Deploying Depot...'));
	deployer.link(SafeDecimalMath, Depot);
	const depot = await deployer.deploy(Depot, owner, fundsWallet, resolver.address, {
		from: deployerAccount,
	});

	// --------------------
	// EtherCollateral
	// --------------------
	console.log('Deploying EtherCollateral...');
	// Needs the SynthxETH & SynthxUSD in the address resolver
	const xETHSynth = synths.find(synth => synth.currencyKey === 'xETH');
	const xUSDSynth = synths.find(synth => synth.currencyKey === 'xUSD');
	deployer.link(SafeDecimalMath, EtherCollateral);
	const etherCollateral = await deployer.deploy(EtherCollateral, owner, resolver.address, {
		from: deployerAccount,
	});

	// ----------------------
	// Deploy DappMaintenance
	// ----------------------
	console.log(gray('Deploying DappMaintenance...'));
	await deployer.deploy(DappMaintenance, owner, {
		from: deployerAccount,
	});

	// ----------------
	// Self Destructible
	// ----------------
	console.log(gray('Deploying SelfDestructible...'));
	await deployer.deploy(SelfDestructible, owner, { from: deployerAccount });

	// ----------------
	// Exchanger
	// ----------------
	console.log(gray('Deploying Exchanger...'));
	deployer.link(SafeDecimalMath, Exchanger);
	const exchanger = await deployer.deploy(Exchanger, owner, resolver.address, {
		from: deployerAccount,
	});

	// ----------------
	// ExchangeState
	// ----------------
	console.log(gray('Deploying ExchangeState...'));
	// deployer.link(SafeDecimalMath, ExchangeState);
	const exchangeState = await deployer.deploy(ExchangeState, owner, exchanger.address, {
		from: deployerAccount,
	});

	// ----------------
	// Issuer
	// ----------------
	console.log(gray('Deploying Issuer...'));
	deployer.link(SafeDecimalMath, Issuer);
	const issuer = await deployer.deploy(Issuer, owner, resolver.address, { from: deployerAccount });

	// ----------------------
	// Connect Shadows State to the Issuer
	// ----------------------
	console.log(gray('Setting associated contract of ShadowsState to Issuer...'));
	await shadowsState.setAssociatedContract(issuer.address, { from: owner });

	// -----------------
	// Updating Resolver
	// -----------------
	console.log(gray('Adding addresses to Resolver...'));
	await resolver.importAddresses(
		[
			'DelegateApprovals',
			'Depot',
			'EtherCollateral',
			'Exchanger',
			'ExchangeRates',
			'ExchangeState',
			'FeePool',
			'FeePoolEternalStorage',
			'FeePoolState',
			'Issuer',
			'MultiCollateral',
			'RewardEscrow',
			'RewardsDistribution',
			'SupplySchedule',
			'Shadows',
			'ShadowsEscrow',
			'ShadowsState',
			'SynthxETH',
			'SynthxUSD',
		].map(toBytes32),
		[
			delegateApprovals.address,
			depot.address,
			etherCollateral.address,
			exchanger.address,
			exchangeRates.address,
			exchangeState.address,
			feePool.address,
			feePoolEternalStorage.address,
			feePoolState.address,
			issuer.address,
			etherCollateral.address, // MultiCollateral for Synth uses EtherCollateral
			rewardEscrow.address,
			rewardsDistribution.address,
			supplySchedule.address,
			shadows.address,
			escrow.address,
			shadowsState.address,
			xETHSynth.synth.address,
			xUSDSynth.synth.address,
		],
		{ from: owner }
	);

	const tableData = [
		['Contract', 'Address'],
		['AddressResolver', resolver.address],
		['EtherCollateral', etherCollateral.address],
		['Exchange Rates', exchangeRates.address],
		['Fee Pool', FeePool.address],
		['Fee Pool Proxy', feePoolProxy.address],
		['Fee Pool State', feePoolState.address],
		['Fee Pool Eternal Storage', feePoolEternalStorage.address],
		['Shadows State', shadowsState.address],
		['Shadows Token State', shadowsTokenState.address],
		['Shadows Proxy', shadowsProxy.address],
		['Shadows', Shadows.address],
		['Shadows Escrow', ShadowsEscrow.address],
		['Reward Escrow', RewardEscrow.address],
		['Rewards Distribution', RewardsDistribution.address],
		['Depot', Depot.address],
		['Owned', Owned.address],
		['SafeDecimalMath', SafeDecimalMath.address],
		['DappMaintenance', DappMaintenance.address],
		['SelfDestructible', SelfDestructible.address],
	];

	for (const synth of synths) {
		tableData.push([`${synth.currencyKey} Synth`, synth.synth.address]);
		tableData.push([`${synth.currencyKey} Proxy`, synth.proxy.address]);
		tableData.push([`${synth.currencyKey} Token State`, synth.tokenState.address]);
	}

	console.log();
	console.log(gray(table(tableData)));
	console.log();
	console.log(green('Successfully deployed all contracts:'));
	console.log();
};
