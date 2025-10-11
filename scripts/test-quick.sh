#!/bin/bash

# FHESwapSimple Quick Test Script
# Usage: ./test-quick.sh [test-type]

set -e

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Print colored message
print_message() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

print_header() {
    echo
    echo "================================"
    print_message $BOLD "$1"
    echo "================================"
}

# Check dependencies
check_prerequisites() {
    print_header "🔍 Environment Check"
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_message $RED "❌ Node.js not installed"
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_message $RED "❌ npm not installed"
        exit 1
    fi
    
    # Check Hardhat
    if ! npx hardhat --version &> /dev/null; then
        print_message $RED "❌ Hardhat not installed or misconfigured"
        exit 1
    fi
    
    print_message $GREEN "✅ Environment check passed"
}

# Show help
show_help() {
    print_header "📋 FHESwapSimple Quick Test"
    
    echo "Usage:"
    echo "  ./test-quick.sh [test-type]"
    echo
    echo "Test types:"
    echo "  optimized    - 🌟 Optimized test suite (recommended)"
    echo "  quick        - 🚀 Local quick test"
    echo "  step         - 📋 Step-by-step test"
    echo "  full         - 📚 Complete test suite"
    echo
    echo "Options:"
    echo "  --help, -h   - Show this help message"
    echo
    echo "Examples:"
    echo "  ./test-quick.sh optimized"
    echo "  ./test-quick.sh quick"
}

# Run tests
run_test() {
    local test_type=$1
    
    case $test_type in
        "optimized")
            print_header "🌟 Running Optimized Test Suite"
            print_message $BLUE "File: test/FHESwapSimple.sepolia.optimized.ts"
            print_message $BLUE "Network: sepolia"
            print_message $YELLOW "⚠️  Please ensure account has sufficient ETH balance"
            echo
            npx hardhat test test/FHESwapSimple.sepolia.optimized.ts --network sepolia
            ;;
        "quick")
            print_header "🚀 Running Quick Test"
            print_message $BLUE "File: test/FHESwapSimple.test.ts"
            print_message $BLUE "Network: localfhevm"
            echo
            npx hardhat test test/FHESwapSimple.test.ts
            ;;
        "step")
            print_header "📋 Running Step-by-Step Test"
            print_message $BLUE "File: test/FHESwapSimple.sepolia.step.ts"
            print_message $BLUE "Network: sepolia"
            print_message $YELLOW "⚠️  Please ensure account has sufficient ETH balance"
            echo
            npx hardhat test test/FHESwapSimple.sepolia.step.ts --network sepolia
            ;;
        "full")
            print_header "📚 Running Complete Test"
            print_message $BLUE "File: test/FHESwapSimple.sepolia.ts"
            print_message $BLUE "Network: sepolia"
            print_message $YELLOW "⚠️  Please ensure account has sufficient ETH balance"
            echo
            npx hardhat test test/FHESwapSimple.sepolia.ts --network sepolia
            ;;
        *)
            print_message $RED "❌ Unknown test type: $test_type"
            echo
            show_help
            exit 1
            ;;
    esac
}

# Main program
main() {
    # Check parameters
    if [[ $# -eq 0 ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
        show_help
        exit 0
    fi
    
    local test_type=$1
    
    # Check environment
    check_prerequisites
    
    # Show start information
    print_header "🚀 Starting Test"
    print_message $BLUE "Test type: $test_type"
    print_message $BLUE "Start time: $(date)"
    
    # Record start time
    local start_time=$(date +%s)
    
    # Run test
    if run_test $test_type; then
        # Calculate duration
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        print_header "🎉 Test Completed"
        print_message $GREEN "✅ Test successful"
        print_message $BLUE "Total duration: ${duration} seconds"
        print_message $BLUE "End time: $(date)"
    else
        # Calculate duration
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        print_header "💥 Test Failed"
        print_message $RED "❌ Test failed"
        print_message $BLUE "Duration: ${duration} seconds"
        print_message $YELLOW "Suggestions:"
        echo "  1. Check network connection"
        echo "  2. Ensure sufficient account balance"
        echo "  3. Verify contracts are properly deployed"
        echo "  4. Check detailed error messages"
        exit 1
    fi
}

# Capture interrupt signal
trap 'print_message $YELLOW "\n⚠️  Test interrupted"; exit 130' INT

# Run main program
main "$@"