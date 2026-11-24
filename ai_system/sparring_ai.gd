class_name SparringAI
extends RefCounted
## Adapter-layer CPU opponent (spec part 3 section 10).
## Strictly read-only on SimState; uses its own local RNG seed and outputs a standard InputBits mask.

var bot_rng: int = 987654321
var hold_mask: int = 0
var hold_ticks: int = 0


func reset(seed_val: int = 987654321) -> void:
	bot_rng = seed_val if seed_val != 0 else 1
	hold_mask = 0
	hold_ticks = 0


func compute_input(
	state: SimState,
	my_slot: int,
	my_bundle: DataModels.FighterBundle
) -> int:
	if state.round_phase != SimState.RoundPhase.FIGHT:
		hold_mask = 0
		hold_ticks = 0
		return 0

	if hold_ticks > 0:
		hold_ticks -= 1
		return hold_mask

	var me: SimState.FighterSimState = state.fighters[my_slot]
	var opp: SimState.FighterSimState = state.fighters[1 - my_slot]
	var dx: int = opp.pos_x - me.pos_x
	var dist: int = absi(dx)
	var toward_bit: int = InputBits.RIGHT if dx > 0 else InputBits.LEFT
	var away_bit: int = InputBits.LEFT if dx > 0 else InputBits.RIGHT

	var roll_pair: PackedInt64Array = SimRng.next_bounded(bot_rng, 1000)
	bot_rng = roll_pair[0]
	var roll: int = roll_pair[1]

	# Defensive reaction when opponent attacks nearby
	if opp.state_name in ["ATTACKING", "SKILL", "ULTIMATE"] and dist < 130000:
		if roll < 450:
			hold_mask = away_bit | InputBits.BLOCK
			hold_ticks = 12
			return hold_mask

	# Close range offense
	if dist <= 88000:
		if roll < my_bundle.ai_aggression_permille:
			hold_mask = 0
			hold_ticks = 4
			return InputBits.LIGHT if (roll % 3 != 0) else InputBits.HEAVY
		if roll < 720:
			hold_mask = away_bit | InputBits.BLOCK
			hold_ticks = 8
			return hold_mask

	# Mid/far range zoning or approach
	if not my_bundle.skills.is_empty() and dist > 160000 and roll < FixedMath.div_trunc(my_bundle.ai_zoning_permille, 3):
		hold_mask = 0
		hold_ticks = 6
		return InputBits.SKILL_1

	if roll < 650:
		hold_mask = toward_bit
		hold_ticks = 10
		return hold_mask
	if roll < 730:
		hold_mask = toward_bit | InputBits.UP
		hold_ticks = 3
		return hold_mask

	hold_mask = 0
	hold_ticks = 6
	return 0
