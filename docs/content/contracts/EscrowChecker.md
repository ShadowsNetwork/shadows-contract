# EscrowChecker

## Description

A small utility contract that augments the DOWS escrow contract to allow extracting a user's schedule as an array rather than as individual entries.

**Source:** [EscrowChecker.sol](https://github.com/Shadowsio/shadows/blob/master/contracts/EscrowChecker.sol)

## Architecture

---

### Inheritance Graph

<centered-image>
    ![EscrowChecker inheritance graph](../img/graphs/EscrowChecker.svg)
</centered-image>

---

### Related Contracts

- [ShadowsEscrow](ShadowsEscrow.md)

---

## Variables

---

### `shadows_escrow`

The [DOWS escrow contract](ShadowsEscrow.md).

**Type:** `ShadowsEscrow public`

---

## Functions

---

### `constructor`

Initialises the [shadows escrow address](#shadows_escrow).

??? example "Details"

    **Signature**

    `constructor(ShadowsEscrow _esc) public`

---

### `checkAccountSchedule`

Returns the given address's vesting schedule as up to 16 `uints`, composed of an alternating sequence of up to 8 `(timestamp, quantity)` pairs, as per [`ShadowsEscrow.getVestingScheduleEntry`](ShadowsEscrow.md#getVestingScheduleEntry).

Vested entries are not skipped, and appear as a leading sequence of zeroes.

??? example "Details"

    **Signature**

    `checkAccountSchedule(address account) public view returns (uint[16])`
