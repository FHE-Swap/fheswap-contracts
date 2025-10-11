// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, externalEuint64, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ConfidentialFungibleToken} from "@openzeppelin/confidential-contracts/token/ConfidentialFungibleToken.sol";
import {
    IConfidentialFungibleToken
} from "@openzeppelin/confidential-contracts/interfaces/IConfidentialFungibleToken.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

contract ConfidentialFungibleTokenMintableBurnable is ConfidentialFungibleToken, Ownable, SepoliaConfig {
    using FHE for *;
    // Map: request id -> receiver address (reserved for integrations)
    mapping(uint256 requestId => address) private _receivers;
    // Source confidential token for swaps
    IConfidentialFungibleToken private _fromToken;
    // Destination ERC20 token (not used in this contract)
    IERC20 private _toToken;

    constructor(
        address owner,
        string memory name,
        string memory symbol,
        string memory uri
    ) ConfidentialFungibleToken(name, symbol, uri) Ownable(owner) {}

    function mint(address to, externalEuint64 amount, bytes memory inputProof) public onlyOwner {
        // Decrypt the external encrypted amount
        euint64 minted = FHE.fromExternal(amount, inputProof);
        // Ensure the contract can operate on this value
        FHE.allowThis(minted);
        // Mint to recipient
        _mint(to, minted);
        // Grant recipient access on the minted value
        FHE.allow(minted, to);
    }

    function burn(address from, externalEuint64 amount, bytes memory inputProof) public onlyOwner {
        // Decrypt the external encrypted amount
        euint64 burned = FHE.fromExternal(amount, inputProof);
        // Ensure the contract can operate on this value
        FHE.allowThis(burned);
        // Burn from the address
        _burn(from, burned);
        // Allow source to access the burned value
        FHE.allow(burned, from);
    }

    function swapConfidentialForConfidential(
        IConfidentialFungibleToken fromToken,
        IConfidentialFungibleToken toToken,
        externalEuint64 amountInput,
        bytes calldata inputProof
    ) public virtual {
        // Caller must set this contract as operator on fromToken
        require(fromToken.isOperator(msg.sender, address(this)));

        // Decrypt the external encrypted input
        euint64 amount = FHE.fromExternal(amountInput, inputProof);

        // Allow transient use on fromToken
        FHE.allowTransient(amount, address(fromToken));
        // Pull tokens from sender to this contract
        euint64 amountTransferred = fromToken.confidentialTransferFrom(msg.sender, address(this), amount);

        // Allow transient use on toToken for the transferred amount
        FHE.allowTransient(amountTransferred, address(toToken));
        // Send out as toToken to the caller
        toToken.confidentialTransfer(msg.sender, amountTransferred);
    }

    /**
     * @notice Let a holder authorize this token contract to operate on their encrypted balance.
     * @dev Helps avoid ACLNotAllowed by doing explicit on-chain authorization.
     * @param balanceHandle Encrypted balance handle to authorize.
     */
    function authorizeSelf(euint64 balanceHandle) public {
        // Only the owner of balanceHandle can effectively authorize.
        // FHE.allow performs ACL checks on-chain.
        FHE.allow(balanceHandle, address(this));
    }
}
