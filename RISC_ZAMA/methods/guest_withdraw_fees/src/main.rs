use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct WithdrawFeesInputs {
      
    pub reserve0: u128,
    pub reserve1: u128,
    pub total_supply: u128,
    pub fee_to_lp_balance: u128,    
    
      
    pub lp_amount: u128,             
    
      
    pub expected_amount0_out: u128,
    pub expected_amount1_out: u128,
    
      
    pub chain_id: u64,
    pub pool: [u8; 20],
    pub fee_to: [u8; 20],
    pub expiry: u64,
    pub nonce: u64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct WithdrawFeesJournal {
    pub chain_id: u64,
    pub pool: [u8; 20],
    pub fee_to: [u8; 20],
    pub expiry: u64,
    pub nonce: u64,
    
      
    pub reserve0: u128,
    pub reserve1: u128,
    pub total_supply: u128,
    pub fee_to_lp_balance: u128,
    
      
    pub lp_amount: u128,
    pub amount0_out: u128,
    pub amount1_out: u128,
    
      
    pub is_valid: bool,
}

fn main() {

    let input: WithdrawFeesInputs = env::read();
    

    let mut is_valid = true;
    

    if input.lp_amount > input.fee_to_lp_balance {
        is_valid = false;
    }
    

    if input.total_supply == 0 {
        is_valid = false;
    }

    if input.reserve0 == 0 || input.reserve1 == 0 {
        is_valid = false;
    }

    let amount0_out = if is_valid && input.total_supply > 0 {
        (input.lp_amount * input.reserve0) / input.total_supply
    } else {
        0
    };
    
    let amount1_out = if is_valid && input.total_supply > 0 {
        (input.lp_amount * input.reserve1) / input.total_supply
    } else {
        0
    };
    

    if is_valid {
        if amount0_out != input.expected_amount0_out {
            is_valid = false;
        }
        if amount1_out != input.expected_amount1_out {
            is_valid = false;
        }
    }
 
    if is_valid {
        if amount0_out > input.reserve0 || amount1_out > input.reserve1 {
            is_valid = false;
        }
    }

    let journal = WithdrawFeesJournal {
        chain_id: input.chain_id,
        pool: input.pool,
        fee_to: input.fee_to,
        expiry: input.expiry,
        nonce: input.nonce,
        
        reserve0: input.reserve0,
        reserve1: input.reserve1,
        total_supply: input.total_supply,
        fee_to_lp_balance: input.fee_to_lp_balance,
        
        lp_amount: input.lp_amount,
        amount0_out,
        amount1_out,
        
        is_valid,
    };
    

    env::commit(&journal);
}
