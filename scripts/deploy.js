const { ethers, upgrades, artifacts } = require("hardhat");
const path = require("path");
const { gray, green, yellow, redBright, red } = require("chalk");
const fs = require("fs");
const { toWei, toBN } = require("web3-utils");
const {
  ensureNetwork,
  loadAndCheckRequiredSources,
  stringify,
} = require("./util");

const toUnit = (amount) => toBN(toWei(amount.toString(), "ether"));

async function main() {
  const accounts = await web3.eth.getAccounts();
  const network = process.env.HARDHAT_NETWORK
    ? process.env.HARDHAT_NETWORK
    : "local";
  const deploymentPath = path.join(
    __dirname,
    "..",
    `publish/deployed/${network}`
  );
  ensureNetwork(network);
  const {
    config,
    configFile,
    synths,
    deployment,
    deploymentFile,
    ownerActions,
    ownerActionsFile,
  } = loadAndCheckRequiredSources({
    deploymentPath,
    network,
  });

  console.log(
    gray(
      "Checking all contracts not flagged for deployment have addresses in this network..."
    )
  );
  const missingDeployments = Object.keys(config).filter((name) => {
    return (
      !config[name].deploy &&
      (!deployment.targets[name] || !deployment.targets[name].address)
    );
  });

  if (missingDeployments.length) {
    throw Error(
      `Cannot use existing contracts for deployment as addresses not found for the following contracts on ${network}:\n` +
        missingDeployments.join("\n") +
        "\n" +
        gray(`Used: ${deploymentFile} as source`)
    );
  }

  const updatedConfig = JSON.parse(JSON.stringify(config));

  const getExistingContract = (contract) => {
    const { address, source } = deployment.targets[contract];
    const { abi } = deployment.sources[source];

    return new web3.eth.Contract(abi, address);
  };

  console.log(gray(`Starting deployment to ${network.toUpperCase()}...`));
  const newContractsDeployed = [];

  const deployContract = async ({
    name,
    source = name,
    args,
    deps,
    safeDecimalMathAddress,
    force = false,
  }) => {
    let deploy = force;
    let proxyMode = false;
    let needUpgrade = false;
    if (config[name]) {
      deploy = config[name].deploy;
      proxyMode =
        config[name].proxyMode === undefined ? false : config[name].proxyMode;
      needUpgrade =
        config[name].needUpgrade === undefined
          ? false
          : config[name].needUpgrade;
    }

    const existingAddress = deployment.targets[name]
      ? deployment.targets[name].address
      : "";

    let address;
    let instance;
    let libraries = {};
    if (safeDecimalMathAddress) {
      libraries = {
        SafeDecimalMath: safeDecimalMathAddress,
      };
    }
    const NewContract = await ethers.getContractFactory(name, {
      libraries: libraries,
    });
    if (deploy) {
      console.log(
        gray(
          ` - Attempting to deploy ${name} , is proxy mode: ${proxyMode} , is need upgrade: ${needUpgrade}`
        )
      );
      if (proxyMode) {
        instance = await upgrades.deployProxy(
          NewContract,
          [...(args ? args : [])],
          { initializer: "initialize", unsafeAllowLinkedLibraries: true }
        );
      } else {
        instance = await NewContract.deploy(...(args ? args : []));
      }
      await instance.deployed();
      address = instance.address;
    } else if (existingAddress) {
      if (proxyMode && needUpgrade) {
        instance = await upgrades.upgradeProxy(existingAddress, NewContract, {
          unsafeAllowLinkedLibraries: true,
        });
        console.log(
          gray(` - Upgrade proxy instance of ${name} at ${existingAddress}`)
        );
        address = instance.address;
      } else {
        const deployedContract = getExistingContract(name);
        address = deployedContract.options.address;
        console.log(
          gray(` - Reusing instance of ${name} at ${existingAddress}`)
        );
      }
    } else {
      throw new Error(
        `Settings for contract: ${name} specify an existing contract, but do not give an address.`
      );
    }

    let timestamp = new Date();
    let txn = "";
    if (config[name] && !config[name].deploy) {
      // deploy is false, so we reused a deployment, thus lets grab the details that already exist
      timestamp = deployment.targets[name].timestamp;
      txn = deployment.targets[name].txn;
    }
    // now update the deployed contract information
    deployment.targets[name] = {
      name,
      address,
      source,
      link: `https://${
        network !== "mainnet" ? network + "." : ""
      }etherscan.io/address/${address}`,
      timestamp,
      txn,
      network,
    };
    const compiled = await artifacts.readArtifact(name);
    deployment.sources[source] = {
      bytecode: compiled.bytecode,
      abi: compiled.abi,
    };
    fs.writeFileSync(deploymentFile, stringify(deployment));

    // now update the flags to indicate it no longer needs deployment,
    // ignoring this step for local, which wants a full deployment by default
    if (network !== "local") {
      updatedConfig[name] = {
        deploy: false,
        proxyMode: proxyMode,
        needUpgrade: false,
      };
      fs.writeFileSync(configFile, stringify(updatedConfig));
    }

    if (deploy) {
      // add to the list of deployed contracts for later reporting
      newContractsDeployed.push({
        name,
        address,
      });
    }

    return address;
  };

  const safeDecimalMathAddress = await deployContract({
    name: "SafeDecimalMath",
  });

  const addressResolverAddress = await deployContract({
    name: "AddressResolver",
  });

  await deployContract({
    name: "Synthesizer",
    safeDecimalMathAddress: safeDecimalMathAddress,
    args: [addressResolverAddress],
  });

  await deployContract({
    name: "FeePool",
    safeDecimalMathAddress: safeDecimalMathAddress,
    args: [toUnit("0.0030").toString(), addressResolverAddress],
  });

  await deployContract({
    name: "Oracle",
    safeDecimalMathAddress: safeDecimalMathAddress,
    args: [accounts[0], [],[]],
  });
}

main();
