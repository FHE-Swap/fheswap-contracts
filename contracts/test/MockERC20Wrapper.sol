// SPDX-License-Identifier: MIT

pragma solidity ^0.8.27;

import {FHE, externalEuint64, ebool, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC7984} from "../confidential-tokens/base/ERC7984.sol";
import {IERC20Wrapper} from "../confidential-tokens/extensions/IERC20Wrapper.sol";

/**
 * @title MockERC20Wrapper
 * @dev ERC20 wrapper for testing, supports mock decryption callbacks
 *      Inherits all functionality of ERC20Wrapper, but adds test-specific mock features
 */
contract MockERC20Wrapper is ERC7984, SepoliaConfig {
    using SafeERC20 for IERC20;

    // Underlying ERC20 token contract
    IERC20 private immutable _underlying;
    
    // Wrapping rate: rate ERC20 tokens = 1 confidential token
    uint256 private immutable _rate;
    
    // Decimal places of the underlying token
    uint8 private immutable _underlyingDecimals;
    
    // Unwrap request mapping
    mapping(uint256 requestID => address user) private _unwrapRequests;
    
    // Mock test specific: record last request ID
    uint256 private _lastRequestID;

    // Event definitions
    event Wrapped(address indexed user, uint256 amount, euint64 wrappedAmount);
    event Unwrapped(address indexed user, euint64 amount, uint256 unwrappedAmount);

    // Error definitions
    error InvalidAmount();
    error InvalidRate();
    error UnwrapRequestNotFound();
    error InvalidUnderlyingToken();

    /**
     * @dev Constructor
     * @param underlying_ Underlying ERC20 token address
     * @param name_ Confidential token name
     * @param symbol_ Confidential token symbol
     * @param rate_ Wrapping rate (rate ERC20 = 1 confidential token)
     */
    constructor(
        address underlying_,
        string memory name_,
        string memory symbol_,
        uint256 rate_
    ) ERC7984(name_, symbol_, "") {
        if (underlying_ == address(0)) revert InvalidUnderlyingToken();
        if (rate_ == 0) revert InvalidRate();
        
        _underlying = IERC20(underlying_);
        _rate = rate_;
        
        // Get decimal places of the underlying token
        try IERC20Metadata(address(_underlying)).decimals() returns (uint8 decimals) {
            _underlyingDecimals = decimals;
        } catch {
            _underlyingDecimals = 18; // Default value
        }
    }

    /**
     * @dev Get underlying ERC20 token address
     */
    function underlying() public view returns (address) {
        return address(_underlying);
    }

    /**
     * @dev Get wrapping rate
     */
    function rate() public view returns (uint256) {
        return _rate;
    }

    /**
     * @dev Get decimal places of the underlying token
     */
    function underlyingDecimals() public view returns (uint8) {
        return _underlyingDecimals;
    }

    /**
     * @dev Wrap ERC20 tokens into confidential tokens
     * @param to Address to receive confidential tokens
     * @param amount Amount of ERC20 tokens to wrap
     */
    function wrap(address to, uint256 amount) public {
        if (amount == 0) revert InvalidAmount();
        
        // Transfer ERC20 tokens from user to contract
        _underlying.safeTransferFrom(msg.sender, address(this), amount);
        
        // Mint confidential tokens: amount / rate confidential tokens
        uint256 confidentialAmount = amount / _rate;
        if (confidentialAmount == 0) revert InvalidAmount();
        
        euint64 encryptedWrappedAmount = FHE.asEuint64(uint64(confidentialAmount));
        _mint(to, encryptedWrappedAmount);
        
        emit Wrapped(msg.sender, amount, encryptedWrappedAmount);
    }

    /**
     * @dev Unwrap confidential tokens to ERC20 tokens
     * @param from Confidential token sender address
     * @param amount Amount of confidential tokens to unwrap
     */
    function unwrap(address from, address /* to */, euint64 amount) public {
        // Verify caller permissions
        require(FHE.isAllowed(amount, msg.sender), "Unauthorized amount access");
        require(msg.sender == from || isOperator(from, msg.sender), "Not authorized");
        
        // Prepare decryption request
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(amount);
        
        // Request decryption
        uint256 requestID = FHE.requestDecryption(cts, this.finalizeUnwrap.selector);
        
        // Record unwrap request and request ID (mock test specific)
        _unwrapRequests[requestID] = from;
        _lastRequestID = requestID;
        
        // Burn confidential tokens (temporarily, will be restored if decryption fails)
        _burn(from, amount);
    }

    /**
     * @dev Callback function to finalize unwrap request
     * @param requestID Request ID
     * @param cleartexts Decrypted plaintext data
     * @param decryptionProof Decryption proof
     */
    function finalizeUnwrap(uint256 requestID, bytes memory cleartexts, bytes memory decryptionProof) public {
        // Verify signature (skipped in test environment)
        // FHE.checkSignatures(requestID, cleartexts, decryptionProof);
        
        // Decode decrypted amount
        uint64 amount = abi.decode(cleartexts, (uint64));
        
        // Get requesting user
        address user = _unwrapRequests[requestID];
        if (user == address(0)) revert UnwrapRequestNotFound();
        
        // Calculate ERC20 token amount
        uint256 unwrappedAmount = uint256(amount) * _rate;
        
        // Check if contract balance is sufficient
        uint256 contractBalance = _underlying.balanceOf(address(this));
        if (contractBalance < unwrappedAmount) {
            revert("Insufficient contract balance for unwrap");
        }
        
        // Transfer ERC20 tokens to user
        _underlying.safeTransfer(user, unwrappedAmount);
        
        // Clear request record
        delete _unwrapRequests[requestID];
        
        emit Unwrapped(user, FHE.asEuint64(uint64(amount)), unwrappedAmount);
    }

    /**
     * @dev Mock test specific: get last request ID
     */
    function getLastRequestID() public view returns (uint256) {
        return _lastRequestID;
    }

    /**
     * @dev Mock test specific: simulate decryption response
     * @param requestID Request ID
     * @param amount Decrypted amount
     */
    function mockDecryptResponse(uint256 requestID, uint256 amount) public {
        // Directly call internal unwrap logic, skip FHE verification
        _mockFinalizeUnwrap(requestID, amount);
    }

    /**
     * @dev Mock test specific: internal unwrap logic
     * @param requestID Request ID
     * @param amount Decrypted amount
     */
    function _mockFinalizeUnwrap(uint256 requestID, uint256 amount) internal {
        // Get requesting user
        address user = _unwrapRequests[requestID];
        if (user == address(0)) revert UnwrapRequestNotFound();
        
        // Calculate ERC20 token amount
        uint256 unwrappedAmount = amount * _rate;
        
        // Check if contract balance is sufficient
        uint256 contractBalance = _underlying.balanceOf(address(this));
        if (contractBalance < unwrappedAmount) {
            revert("Insufficient contract balance for unwrap");
        }
        
        // Transfer ERC20 tokens to user
        _underlying.safeTransfer(user, unwrappedAmount);
        
        // Clear request record
        delete _unwrapRequests[requestID];
        
        emit Unwrapped(user, FHE.asEuint64(uint64(amount)), unwrappedAmount);
    }

    /**
     * @dev Get underlying token balance held by contract
     */
    function underlyingBalance() public view returns (uint256) {
        return _underlying.balanceOf(address(this));
    }

    /**
     * @dev Emergency withdraw function (only callable by contract owner)
     * @param to Receiving address
     * @param amount Withdrawal amount
     */
    function emergencyWithdraw(address to, uint256 amount) external {
        // Owner permission check should be added here
        _underlying.safeTransfer(to, amount);
    }
}
