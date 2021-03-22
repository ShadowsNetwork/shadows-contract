"use strict";
const BN = require('bn.js');
const w3utils = require("web3-utils");
const { toBN, asciiToHex, toWei } = require("web3-utils");

/**
 * Converts a string into a hex representation of bytes32, with right padding
 */
const toBytes32 = (key) => w3utils.rightPad(asciiToHex(key), 64);

const toUnit = (amount) => toBN(toWei(amount.toString(), "ether"));

const UNIT = toWei(new BN('1'), 'ether')

module.exports = { toBytes32, toUnit, toWei };
