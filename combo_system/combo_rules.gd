class_name ComboRules
extends RefCounted
## Combo scaling, cancel window checks, and infinite-combo protection (spec part 3 section 7).


static func compute_scaled_damage(
	base_damage: int,
	combo_hit_index: int,
	cfg: DataModels.CombatConfigData
) -> int:
	## combo_hit_index is 0 for the 1st hit (100%), 1 for 2nd hit (90%), etc.
	if base_damage <= 0:
		return 0
	var pct: int = cfg.min_damage_scaling_pct
	if combo_hit_index >= 0 and combo_hit_index < cfg.damage_scaling_pct.size():
		pct = cfg.damage_scaling_pct[combo_hit_index]
	var scaled: int = FixedMath.div_trunc(base_damage * pct, 100)
	return maxi(1, scaled)


static func compute_scaled_hitstun(base_hitstun: int, combo_hit_index: int) -> int:
	## Gradual hitstun decay after 3rd hit to prevent infinite loops (spec part 3 section 7).
	if base_hitstun <= 0:
		return 0
	if combo_hit_index <= 2:
		return base_hitstun
	var decay: int = (combo_hit_index - 2) * 2
	return maxi(6, base_hitstun - decay)


static func can_cancel_move(
	move_fd: DataModels.MoveFrameData,
	move_tick: int,
	target_move_id: String,
	target_category: String
) -> bool:
	if move_fd == null:
		return false
	for cw in move_fd.cancel_windows:
		if move_tick >= cw.frames_start and move_tick <= cw.frames_end:
			if cw.into.has(target_move_id):
				return true
			if target_category != "" and cw.into.has(target_category):
				return true
	return false


static func get_move_combo_uses(
	defender: SimState.FighterSimState,
	attacker_bundle: DataModels.FighterBundle,
	move_id: String
) -> int:
	var idx: int = attacker_bundle.move_ids_sorted.find(move_id)
	if idx < 0 or idx >= defender.combo_move_counts.size():
		return 0
	return defender.combo_move_counts[idx]


static func record_move_combo_use(
	defender: SimState.FighterSimState,
	attacker_bundle: DataModels.FighterBundle,
	move_id: String
) -> void:
	var idx: int = attacker_bundle.move_ids_sorted.find(move_id)
	if idx < 0:
		return
	if defender.combo_move_counts.size() < attacker_bundle.move_ids_sorted.size():
		defender.combo_move_counts.resize(attacker_bundle.move_ids_sorted.size())
	defender.combo_move_counts[idx] += 1
