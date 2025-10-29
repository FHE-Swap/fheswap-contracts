// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title FHEACLMock
 * @dev Mock ACL contract for local FHEVM testing
 * 
 * This contract provides a minimal implementation of FHE ACL functionality
 * for local testing environments where the real FHE coprocessor is not available.
 */
contract FHEACLMock {
    // Events for debugging
    event Allowed(address indexed from, address indexed to, bytes32 handle);
    event AllowedTransient(address indexed from, address indexed to, bytes32 handle);
    event ACLSet(address indexed acl);

    // Access control mappings
    mapping(bytes32 => mapping(address => bool)) public access;
    mapping(bytes32 => mapping(address => bool)) public transientAccess;

    // ACL address (for compatibility)
    address public acl;

    /**
     * @dev Allow access to a handle
     * @param handle The FHE handle
     * @param to The address to grant access to
     */
    function allow(bytes32 handle, address to) external {
        access[handle][to] = true;
        emit Allowed(msg.sender, to, handle);
    }

    /**
     * @dev Allow transient access to a handle
     * @param handle The FHE handle
     * @param to The address to grant transient access to
     */
    function allowTransient(bytes32 handle, address to) external {
        transientAccess[handle][to] = true;
        emit AllowedTransient(msg.sender, to, handle);
    }

    /**
     * @dev Check if access is allowed
     * @param handle The FHE handle
     * @param user The user address
     * @return Whether access is allowed
     */
    function isAllowed(bytes32 handle, address user) external view returns (bool) {
        return access[handle][user] || transientAccess[handle][user];
    }

    /**
     * @dev Set ACL address (for compatibility)
     * @param _acl The ACL address
     */
    function setACL(address _acl) external {
        acl = _acl;
        emit ACLSet(_acl);
    }

    /**
     * @dev Check if user has access to handle
     * @param handle The FHE handle
     * @param user The user address
     * @return Whether user has access
     */
    function hasAccess(bytes32 handle, address user) external view returns (bool) {
        return access[handle][user];
    }

    /**
     * @dev Check if user has transient access to handle
     * @param handle The FHE handle
     * @param user The user address
     * @return Whether user has transient access
     */
    function hasTransientAccess(bytes32 handle, address user) external view returns (bool) {
        return transientAccess[handle][user];
    }
}