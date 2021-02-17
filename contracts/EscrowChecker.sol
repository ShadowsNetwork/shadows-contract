pragma solidity 0.4.25;


contract ShadowsEscrow {
    function numVestingEntries(address account) public returns (uint);

    function getVestingScheduleEntry(address account, uint index) public returns (uint[2]);
}


contract EscrowChecker {
    ShadowsEscrow public shadows_escrow;

    constructor(ShadowsEscrow _esc) public {
        shadows_escrow = _esc;
    }

    function checkAccountSchedule(address account) public view returns (uint[16]) {
        uint[16] memory _result;
        uint schedules = shadows_escrow.numVestingEntries(account);
        for (uint i = 0; i < schedules; i++) {
            uint[2] memory pair = shadows_escrow.getVestingScheduleEntry(account, i);
            _result[i * 2] = pair[0];
            _result[i * 2 + 1] = pair[1];
        }
        return _result;
    }
}
