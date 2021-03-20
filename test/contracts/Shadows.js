const { expect } = require("chai");
const Oracle = artifacts.require("Oracle");
const FeePool = artifacts.require("FeePool");

contract("Shadows", async (accounts) => {
  let oracle,
    feePool;

  beforeEach(async () => {
    oracle = await Oracle.deployed();
    feePool = await FeePool.deployed();
  });

  it("should set params on initialize", async () => {});
});
