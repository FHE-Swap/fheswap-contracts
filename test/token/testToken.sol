// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.27;

import "@fhevm/solidity/lib/FHE.sol";
import {ERC7984} from "./confidential-tokens/base/ERC7984.sol";

/**
 * @notice SepoliaConfig is inherited through ERC7984
 */
contract ConfidentialToken is ERC7984 {
    euint64 private airDropAmount;

    constructor(string memory name_, string memory symbol_) ERC7984(name_, symbol_, "") {
        uint64 scalingFactor = uint64(10) ** decimals();
        euint64 mintAmount = FHE.asEuint64(100_000 * scalingFactor);
        airDropAmount = FHE.asEuint64(1000 * scalingFactor);
        FHE.allowThis(airDropAmount);
        _mint(msg.sender, mintAmount);
    }

    function airDrop() public {
        _mint(msg.sender, airDropAmount);
    }
}
