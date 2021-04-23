## deploy contract
```
yarn hardhat deploy --network ropsten  --tags Shadows
```

##  verify contract
```
yarn hardhat --network ropsten  etherscan-verify
//or
yarn hardhat --network bsctestnet etherscan-verify --api-key apikey
```

## export
```
yarn hardhat export  --network ropsten --export  ./deployments/ropsten.json
```