// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract LegacyDirectionalHook {
    uint24 public constant BUY_FEE = 3_000;

    address public admin;
    uint24 public sellFee = 9_000;

    constructor() {
        admin = msg.sender;
    }

    // Deliberate fixture defect: the existing project forgot its admin check.
    function setSellFee(uint24 nextSellFee) external {
        sellFee = nextSellFee;
    }

    function feeFor(bool isSell) external view returns (uint24) {
        return isSell ? sellFee : BUY_FEE;
    }

    // Deliberate fixture defect: this claims a delta without backing or settlement.
    function afterSwap(bool isSell, uint256 absoluteAmount) external pure returns (int256 hookDelta) {
        if (!isSell) return 0;
        return int256(absoluteAmount / 1_000);
    }
}
