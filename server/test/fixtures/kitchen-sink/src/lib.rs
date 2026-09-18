#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, BytesN, Env,
    Map, String, Symbol, Vec,
};

/// A pair of a number and an address.
#[contracttype]
#[derive(Clone)]
pub struct Pair {
    pub a: i128,
    pub b: Address,
}

/// A shape: either nothing or a boxed value.
#[contracttype]
#[derive(Clone)]
pub enum Shape {
    Unit,
    Boxed(u32, Symbol),
}

/// A level.
#[contracttype]
#[derive(Clone, Copy)]
#[repr(u32)]
pub enum Level {
    Low = 1,
    High = 2,
}

/// A nested struct exercising bytes, maps and unions inside a udt.
#[contracttype]
#[derive(Clone)]
pub struct Nested {
    pub blob: Bytes,
    pub meta: Map<Symbol, i128>,
    pub shape: Shape,
    pub id: BytesN<4>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The number was too big.
    TooBig = 1,
    /// Not allowed.
    Forbidden = 2,
}

/// Emitted by ping.
#[contractevent]
#[derive(Clone)]
pub struct Pinged {
    #[topic]
    pub who: Address,
    pub n: u32,
}

#[contract]
pub struct KitchenSink;

#[contractimpl]
impl KitchenSink {
    /// Returns the sum of two i128 values.
    pub fn add(_e: Env, a: i128, b: i128) -> i128 { a + b }
    /// Echoes a map.
    pub fn echo_map(_e: Env, m: Map<Symbol, i128>) -> Map<Symbol, i128> { m }
    /// Echoes bytes.
    pub fn echo_bytes(_e: Env, b: Bytes) -> Bytes { b }
    /// Echoes a 32-byte hash.
    pub fn echo_hash(_e: Env, h: BytesN<32>) -> BytesN<32> { h }
    /// Echoes a pair.
    pub fn echo_pair(_e: Env, p: Pair) -> Pair { p }
    /// Echoes a shape.
    pub fn echo_shape(_e: Env, s: Shape) -> Shape { s }
    /// Echoes a nested struct.
    pub fn echo_nested(_e: Env, n: Nested) -> Nested { n }
    /// Echoes a level.
    pub fn echo_level(_e: Env, l: Level) -> Level { l }
    /// Echoes an optional number.
    pub fn maybe(_e: Env, v: Option<u64>) -> Option<u64> { v }
    /// Returns the length of the list.
    pub fn list(_e: Env, v: Vec<Address>) -> u32 { v.len() }
    /// Echoes a string.
    pub fn text(_e: Env, s: String) -> String { s }
    /// Echoes a tuple.
    pub fn tuple(_e: Env, t: (u32, bool)) -> (u32, bool) { t }
    /// Fails with TooBig when n > 100.
    pub fn checked(_e: Env, n: u32) -> Result<u32, Error> {
        if n > 100 { Err(Error::TooBig) } else { Ok(n) }
    }
    /// Requires `who` to authorize and emits Pinged.
    pub fn ping(e: Env, who: Address, n: u32) {
        who.require_auth();
        Pinged { who, n }.publish(&e);
    }
    /// Increments and returns a counter (write).
    pub fn bump(e: Env) -> u32 {
        let k = Symbol::new(&e, "count");
        let n: u32 = e.storage().instance().get(&k).unwrap_or(0) + 1;
        e.storage().instance().set(&k, &n);
        n
    }
    /// Returns the counter (read).
    pub fn get_count(e: Env) -> u32 {
        e.storage().instance().get(&Symbol::new(&e, "count")).unwrap_or(0)
    }
}
