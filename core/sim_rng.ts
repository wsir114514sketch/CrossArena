/**
 * Deterministic 64-bit SplitMix64 PRNG stored as a BigInt inside SimState.
 * Never calls Math.random(). Snapshot & restore of `seedState` guarantees bit-exact replay/rollback.
 */

const MASK_64 = 0xffffffffffffffffn;

export function normalizeSeed(seed: bigint | number): bigint {
  const raw = typeof seed === "bigint" ? seed : BigInt(Math.trunc(seed));
  const masked = raw & MASK_64;
  return masked === 0n ? 0x9e3779b97f4a7c15n : masked;
}

export interface RngStep {
  nextState: bigint;
  value32: number; // unsigned 32-bit integer [0 .. 2^32 - 1]
}

/** Advance SplitMix64 state by one step and return next state + unsigned 32-bit output. */
export function stepRng(state: bigint): RngStep {
  const nextState = (state + 0x9e3779b97f4a7c15n) & MASK_64;
  let z = nextState;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  z = (z ^ (z >> 31n)) & MASK_64;
  const value32 = Number(z & 0xffffffffn) >>> 0;
  return { nextState, value32 };
}

/** Draw an integer in [minInclusive, maxInclusive] deterministically. */
export function randRangeInt(state: bigint, minInclusive: number, maxInclusive: number): { nextState: bigint; result: number } {
  if (maxInclusive <= minInclusive) {
    return { nextState: state, result: minInclusive };
  }
  const span = maxInclusive - minInclusive + 1;
  const { nextState, value32 } = stepRng(state);
  return {
    nextState,
    result: minInclusive + (value32 % span),
  };
}
