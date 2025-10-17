use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct SwapInputs {
    pub reserve_in: u128,
    pub reserve_out: u128,
    pub amount_in: u128,
    pub fee_numerator: u128,
    pub fee_denominator: u128,
    pub expected_out: u128,
    pub min_out: u128,
    pub max_slippage_bps: u128,   
    // context binding
    pub chain_id: u64,
    pub pool: [u8; 20],
    pub token_in: [u8; 20],
    pub to: [u8; 20],
    pub expiry: u64,
    pub nonce: u64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SwapJournal {
    pub chain_id: u64,
    pub pool: [u8; 20],
    pub token_in: [u8; 20],
    pub to: [u8; 20],
    pub expiry: u64,
    pub nonce: u64,

    pub reserve_in: u128,
    pub reserve_out: u128,
    pub amount_in: u128,
    pub fee_numerator: u128,
    pub fee_denominator: u128,
    pub expected_out: u128,
    pub min_out: u128,
    pub max_slippage_bps: u128,
}

fn div_floor(n: u128, d: u128) -> u128 {
    // Assumes d > 0
    n / d
}

fn main() {
  
    let input: SwapInputs = env::read();

 
    assert!(input.reserve_in > 0, "reserve_in must be > 0");
    assert!(input.reserve_out > 0, "reserve_out must be > 0");
    assert!(input.amount_in > 0, "amount_in must be > 0");
    assert!(input.fee_numerator > 0, "fee_numerator must be > 0");
    assert!(input.fee_denominator > 0, "fee_denominator must be > 0");
    assert!(input.fee_numerator < input.fee_denominator, "fee_numerator must be < fee_denominator");
    assert!(input.expected_out > 0, "expected_out must be > 0");
    assert!(input.min_out > 0, "min_out must be > 0");
    assert!(input.min_out <= input.expected_out, "min_out must be <= expected_out");
    assert!(input.max_slippage_bps > 0, "max_slippage_bps must be > 0");
    assert!(input.max_slippage_bps <= 10000, "max_slippage_bps must be <= 100% (10000 bps)");

  
    // amountInWithFee = amountIn * feeNumerator
    let amount_in_with_fee = input.amount_in.saturating_mul(input.fee_numerator);
    // numerator = amountInWithFee * reserveOut
    let numerator = amount_in_with_fee.saturating_mul(input.reserve_out);
    // denominator = reserveIn * feeDenominator + amountInWithFee
    let denominator = input
        .reserve_in
        .saturating_mul(input.fee_denominator)
        .saturating_add(amount_in_with_fee);

    // computed_out = floor(numerator / denominator)
    assert!(denominator > 0, "denominator must be > 0");
    let computed_out = div_floor(numerator, denominator);

  
    assert!(
        computed_out == input.expected_out,
        "AMM calculation mismatch: computed={}, expected={}",
        computed_out,
        input.expected_out
    );

 
    let min_allowed_out = (input.expected_out * (10000 - input.max_slippage_bps)) / 10000;
    
    assert!(
        input.min_out >= min_allowed_out,
        "slippage protection too strict: min_out={}, min_allowed={} (max_slippage={} bps)",
        input.min_out,
        min_allowed_out,
        input.max_slippage_bps
    );

  
    let actual_slippage_bps = if input.expected_out > 0 {
        ((input.expected_out - input.min_out) * 10000) / input.expected_out
    } else {
        0
    };
    
    assert!(
        actual_slippage_bps <= input.max_slippage_bps,
        "slippage too high: {} bps > {} bps (user max)",
        actual_slippage_bps,
        input.max_slippage_bps
    );

   
    assert!(
        input.expected_out < input.reserve_out,
        "swap would deplete reserve: expected_out={}, reserve_out={}",
        input.expected_out,
        input.reserve_out
    );

   
    let journal = SwapJournal {
        chain_id: input.chain_id,
        pool: input.pool,
        token_in: input.token_in,
        to: input.to,
        expiry: input.expiry,
        nonce: input.nonce,
        reserve_in: input.reserve_in,
        reserve_out: input.reserve_out,
        amount_in: input.amount_in,
        fee_numerator: input.fee_numerator,
        fee_denominator: input.fee_denominator,
        expected_out: input.expected_out,
        min_out: input.min_out,
        max_slippage_bps: input.max_slippage_bps,
    };

    env::commit(&journal);
}
