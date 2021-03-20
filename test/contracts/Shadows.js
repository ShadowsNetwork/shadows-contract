const { expect } = require("chai");
const Oracle = artifacts.require("Oracle");
const Shadows = artifacts.require("Shadows");
const FeePool = artifacts.require("FeePool");
const SafeDecimalMath = artifacts.require("SafeDecimalMath");
const AddressResolver = artifacts.require("AddressResolver");
const { toBytes32 } = require("../utils");

contract("Shadows", async (accounts) => {
  let shadows, oracle, feePool, safeDecimalMath, addressResolver;

  beforeEach(async () => {
    addressResolver = await AddressResolver.new();
    safeDecimalMath = await SafeDecimalMath.new();

    await Shadows.link(safeDecimalMath);
    shadows = await Shadows.new();
    shadows.initialize(addressResolver.address);

    await Oracle.link(safeDecimalMath);
    oracle = await Oracle.new();

    await FeePool.link(safeDecimalMath);
    feePool = await FeePool.new();

    await addressResolver.importAddresses(
      [toBytes32("Shadows"), toBytes32("Oracle"), toBytes32("FeePool")],
      [shadows.address, oracle.address, feePool.address]
    );
  });

  it("should set params on initialize", async () => {
    assert.equal(await shadows.name(), "Shadows Network Token");
    assert.equal(await shadows.symbol(), "DOWS");
  });
});
