// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

// Test without SepoliaConfig
contract TestFHEWithoutConfig {
    function testAsEuint64() external returns (euint64) {
        return FHE.asEuint64(1);
    }
}

// Test with SepoliaConfig
contract TestFHEWithConfig is SepoliaConfig {
    function testAsEuint64() external returns (euint64) {
        return FHE.asEuint64(1);
    }

    function testMultipleFHECalls() external returns (euint64, euint64, euint64, euint64) {
        euint64 a = FHE.asEuint64(100);
        euint64 b = FHE.asEuint64(200);
        euint64 c = FHE.asEuint64(300);
        euint64 d = FHE.asEuint64(400);
        return (a, b, c, d);
    }

    function testFHEWithAllow() external returns (euint64, euint64) {
        euint64 a = FHE.asEuint64(100);
        euint64 b = FHE.asEuint64(200);
        FHE.allowTransient(a, address(this));
        FHE.allowTransient(b, address(this));
        return (a, b);
    }
}
