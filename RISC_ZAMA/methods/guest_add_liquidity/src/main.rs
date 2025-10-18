use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct AddLiquidityInputs {
    pub reserve0: u128,
    pub reserve1: u128,
    pub amount0: u128,
    pub amount1: u128,
    pub total_supply: u128,
    pub is_first_add: bool,
    
      
    pub min_amount0: u128,          
    pub min_amount1: u128,          
    pub min_liquidity: u128,        
    
      
    pub fee_enabled: bool,
    pub fee_to: [u8; 20],
    pub last_k: u128,
    
      
    pub chain_id: u64,
    pub pool: [u8; 20],
    pub user: [u8; 20],
    pub expiry: u64,
    pub nonce: u64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AddLiquidityJournal {
    pub chain_id: u64,
    pub pool: [u8; 20],
    pub user: [u8; 20],
    pub expiry: u64,
    pub nonce: u64,
    
      
    pub reserve0: u128,
    pub reserve1: u128,
    pub amount0: u128,
    pub amount1: u128,
    pub total_supply: u128,
    pub is_first_add: bool,
    pub liquidity_minted: u128,
    
      
    pub protocol_fee_lp: u128,    
    pub new_k: u128,              
}

fn approximate_sqrt(n: u128) -> u128 {
    if n == 0 { return 0; }
    if n < 4 { return 1; }
    
    let mut x = n;
    let mut y = (x + 1) / 2;
    
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    
    x
}

fn calculate_protocol_fee(reserve0: u128, reserve1: u128, total_supply: u128, last_k: u128) -> (u128, u128) {
    let current_k = reserve0 * reserve1;
    
    if last_k == 0 {
        return (0, current_k);   
    }
    
    let root_k = approximate_sqrt(current_k);
    let root_k_last = approximate_sqrt(last_k);
    
    if root_k > root_k_last {
        let numerator = total_supply * (root_k - root_k_last);
        let denominator = root_k * 5 + root_k_last;
        let protocol_fee = numerator / denominator;
        (protocol_fee, current_k)
    } else {
        (0, current_k)
    }
}

fn main() {

    let input: AddLiquidityInputs = env::read();

    if !input.is_first_add {
          
        assert!(input.reserve0 > 0, "reserve0 must be > 0 for non-first add");
        assert!(input.reserve1 > 0, "reserve1 must be > 0 for non-first add");
        assert!(input.total_supply > 0, "total_supply must be > 0 for non-first add");
    }
    assert!(input.amount0 > 0, "amount0 must be > 0");
    assert!(input.amount1 > 0, "amount1 must be > 0");
    assert!(input.chain_id > 0, "chain_id must be > 0");
    assert!(input.expiry > 0, "expiry must be > 0");
    assert!(input.nonce > 0, "nonce must be > 0");

    let liquidity_minted = if input.is_first_add {
          
        let product = input.amount0.saturating_mul(input.amount1);
        let sqrt_product = approximate_sqrt(product);
        sqrt_product.saturating_sub(1000)
    } else {
          
        let lp_from_token0 = (input.amount0 * input.total_supply) / input.reserve0;
        let lp_from_token1 = (input.amount1 * input.total_supply) / input.reserve1;
        lp_from_token0.min(lp_from_token1)
    };


    assert!(liquidity_minted > 0, "liquidity must be > 0");

    assert!(input.amount0 >= input.min_amount0, "amount0 below minimum: amount0={}, min_amount0={}", input.amount0, input.min_amount0);
    assert!(input.amount1 >= input.min_amount1, "amount1 below minimum: amount1={}, min_amount1={}", input.amount1, input.min_amount1);
    assert!(liquidity_minted >= input.min_liquidity, "liquidity below minimum: liquidity={}, min_liquidity={}", liquidity_minted, input.min_liquidity);

    if !input.is_first_add {
          
        let expected_amount1 = (input.amount0 * input.reserve1) / input.reserve0;
        let ratio_tolerance = expected_amount1 / 100; 
        assert!(
            input.amount1 >= expected_amount1.saturating_sub(ratio_tolerance) &&
            input.amount1 <= expected_amount1.saturating_add(ratio_tolerance),
            "amount ratio mismatch: amount1={}, expected={}, tolerance={}",
            input.amount1,
            expected_amount1,
            ratio_tolerance
        );
    }

    let (protocol_fee_lp, new_k) = if input.fee_enabled && input.fee_to != [0u8; 20] {
        calculate_protocol_fee(
            input.reserve0 + input.amount0,    
            input.reserve1 + input.amount1,    
            input.total_supply,                
            input.last_k
        )
    } else {
        (0, 0)
    };

    let journal = AddLiquidityJournal {
        chain_id: input.chain_id,
        pool: input.pool,
        user: input.user,
        expiry: input.expiry,
        nonce: input.nonce,
        reserve0: input.reserve0,
        reserve1: input.reserve1,
        amount0: input.amount0,
        amount1: input.amount1,
        total_supply: input.total_supply,
        is_first_add: input.is_first_add,
        liquidity_minted,
        protocol_fee_lp,
        new_k,
    };

    env::commit(&journal);
}
