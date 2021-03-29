# deploy
```
npx hardhat run scripts/deploy.js --network bsctestnet
```

# update contract
**proxy mode**

update publish/deployed/${network}/config.json

set deploy to true

**not proxy mode**

update publish/deployed/${network}/config.json

set needUpgrade to true