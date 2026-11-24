class_name SimRng
extends RefCounted
## Seeded 64-bit deterministic integer PRNG (SplitMix64 mix on two's-complement int).
## State is stored inside SimState so snapshots/replays restore exact RNG sequences.

const GOLDEN_GAMMA: int = -7046029254386353131 # 0x9E3779B97F4A7C15 in signed 64-bit
const MIX_MUL_1: int = -4658895280553007687    # 0xBF58476D1CE4E5B9 in signed 64-bit
const MIX_MUL_2: int = -7723592293110705685    # 0x94D049BB133111EB in signed 64-bit


static func step_raw(state: int) -> PackedInt64Array:
	## Advances RNG state by 1 step and returns [next_state, non_negative_63bit_output].
	var next_state: int = state + GOLDEN_GAMMA
	var z: int = next_state
	z = (z ^ ((z >> 30) & 0x3FFFFFFFF)) * MIX_MUL_1
	z = (z ^ ((z >> 27) & 0x1FFFFFFFFF)) * MIX_MUL_2
	z = z ^ ((z >> 31) & 0x1FFFFFFFF)
	return PackedInt64Array([next_state, z & 0x7FFFFFFFFFFFFFFF])


static func next_bounded(state: int, bound: int) -> PackedInt64Array:
	## Returns [next_state, value in 0 .. bound - 1].
	assert(bound > 0, "SimRng.next_bounded: bound must be > 0")
	var pair: PackedInt64Array = step_raw(state)
	return PackedInt64Array([pair[0], posmod(pair[1], bound)])
