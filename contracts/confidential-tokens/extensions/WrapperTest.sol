// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {FHE} from "@fhevm/solidity/lib/FHE.sol";
import {ERC20Wrapper} from "./ERC20Wrapper.sol";
import {WrapperFactory} from "./WrapperFactory.sol";

/**
 * @title WrapperTest
 * @dev Simple ERC20 token for testing wrapper functionality
 */
contract WrapperTest is ERC20 {
    constructor() ERC20("Test Token", "TEST") {
        _mint(msg.sender, 1000000 * 10**18);
    }
}

/**
 * @title WrapperTestSuite
 * @dev Test suite for wrapper functionality
 */
contract WrapperTestSuite {
    WrapperFactory public factory;
    WrapperTest public testToken;
    ERC20Wrapper public wrapper;
    
    event TestCompleted(string testName, bool success);
    
    constructor() {
        testToken = new WrapperTest();
        
        factory = new WrapperFactory();
        
        address wrapperAddress = factory.createWrapper(
            address(testToken),
            "Wrapped Test Token",
            "wTEST",
            1,
            WrapperFactory.TokenType.PLAIN_ERC20
        );
        wrapper = ERC20Wrapper(wrapperAddress);
    }
    
    /**
     * @dev Test wrapping functionality
     */
    function testWrap() external {
        uint256 amount = 1000 * 10**18;
        
        testToken.approve(address(wrapper), amount);
        
        wrapper.wrap(msg.sender, amount);
        
        emit TestCompleted("testWrap", true);
    }
    
    /**
     * @dev Test query functions
     * @return originalToken Original token address
     * @return wrappedToken Wrapped token address
     * @return isWrapped Whether the address is a wrapped token
     * @return rate Wrapping rate
     * @return underlyingBalance Underlying token balance
     */
    function testQueries() external view returns (
        address originalToken,
        address wrappedToken,
        bool isWrapped,
        uint256 rate,
        uint256 underlyingBalance
    ) {
        originalToken = factory.getOriginal(address(wrapper));
        wrappedToken = factory.getWrapper(address(testToken));
        isWrapped = factory.isWrapper(address(wrapper));
        rate = wrapper.rate();
        underlyingBalance = wrapper.underlyingBalance();
    }
    
    /**
     * @dev Get test token balance
     * @param account Account address
     * @return Balance of test tokens
     */
    function getTestTokenBalance(address account) external view returns (uint256) {
        return testToken.balanceOf(account);
    }
    
    /**
     * @dev Get wrapper balance (encrypted)
     * @param account Account address
     * @return Encrypted balance as bytes32
     */
    function getWrapperBalance(address account) external view returns (bytes32) {
        return FHE.toBytes32(wrapper.confidentialBalanceOf(account));
    }
}
