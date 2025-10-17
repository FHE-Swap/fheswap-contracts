use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct RemoveLiquidityInputs {
    pub reserve0: u128,
    pub reserve1: u128,
    pub total_supply: u128,
    pub liquidity: u128,
    
      
    pub min_amount0_out: u128,      
    pub min_amount1_out: u128,      
    
      
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
pub struct RemoveLiquidityJournal {
    pub chain_id: u64,
    pub pool: [u8; 20],
    pub user: [u8; 20],
    pub expiry: u64,
    pub nonce: u64,
    
      
    pub reserve0: u128,
    pub reserve1: u128,
    pub total_supply: u128,
    pub liquidity: u128,
    pub amount0_out: u128,
    pub amount1_out: u128,
    
      
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

    let input: RemoveLiquidityInputs = env::read();

    assert!(input.reserve0 > 0, "reserve0 must be > 0");
    assert!(input.reserve1 > 0, "reserve1 must be > 0");
    assert!(input.total_supply > 0, "total_supply must be > 0");
    assert!(input.liquidity > 0, "liquidity must be > 0");
    assert!(input.liquidity <= input.total_supply, "liquidity exceeds total supply");
    assert!(input.chain_id > 0, "chain_id must be > 0");
    assert!(input.expiry > 0, "expiry must be > 0");
    assert!(input.nonce > 0, "nonce must be > 0");


    // amount0_out = (liquidity * reserve0) / total_supply
    // amount1_out = (liquidity * reserve1) / total_supply
    let amount0_out = (input.liquidity * input.reserve0) / input.total_supply;
    let amount1_out = (input.liquidity * input.reserve1) / input.total_supply;

    assert!(amount0_out > 0, "amount0_out must be > 0");
    assert!(amount1_out > 0, "amount1_out must be > 0");

    assert!(amount0_out >= input.min_amount0_out, "amount0_out below minimum: amount0_out={}, min_amount0_out={}", amount0_out, input.min_amount0_out);
    assert!(amount1_out >= input.min_amount1_out, "amount1_out below minimum: amount1_out={}, min_amount1_out={}", amount1_out, input.min_amount1_out);

    let (protocol_fee_lp, new_k) = if input.fee_enabled && input.fee_to != [0u8; 20] {
        calculate_protocol_fee(
            input.reserve0,
            input.reserve1,
            input.total_supply,
            input.last_k
        )
    } else {
        (0, 0)
    };

    let journal = RemoveLiquidityJournal {
        chain_id: input.chain_id,
        pool: input.pool,
        user: input.user,
        expiry: input.expiry,
        nonce: input.nonce,
        reserve0: input.reserve0,
        reserve1: input.reserve1,
        total_supply: input.total_supply,
        liquidity: input.liquidity,
        amount0_out,
        amount1_out,
        protocol_fee_lp,
        new_k,
    };

    env::commit(&journal);
}
