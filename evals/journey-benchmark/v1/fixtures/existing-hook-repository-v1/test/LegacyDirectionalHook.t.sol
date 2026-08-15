// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LegacyDirectionalHook} from "../src/LegacyDirectionalHook.sol";

contract LegacyDirectionalHookTest {
    function testSellFeeExceedsBuyFee() external {
        LegacyDirectionalHook hook = new LegacyDirectionalHook();
        require(hook.feeFor(true) > hook.feeFor(false), "directional fee drift");
    }

    // Deliberately missing: a non-admin caller must not be able to set the sell fee.
}
