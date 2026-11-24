class_name HitResolver
extends RefCounted
## Deterministic integer AABB Hitbox / Hurtbox detection, priority/trade resolution,
## hit registry deduplication, guard check, and corner pushback (spec part 3 section 5).


class PendingHit extends RefCounted:
	var source_kind: int = 0 # 0 = fighter melee, 1 = projectile
	var attacker_slot: int = 0
	var defender_slot: int = 1
	var source_id: int = 0
	var move_instance_id: int = 0
	var move_id: String = ""
	var hit_index: int = 0
	var hit_spec: DataModels.HitBoxSpec
	var attacker_facing: int = 1
	var impact_x: int = 0
	var impact_y: int = 0


static func get_world_pushbox(
	f: SimState.FighterSimState,
	bundle: DataModels.FighterBundle
) -> PackedInt64Array:
	var hp: DataModels.HurtboxProfile = bundle.hurtboxes
	var local: PackedInt64Array = hp.push_stand
	if f.state_name in ["KNOCKDOWN", "DEAD"]:
		local = hp.push_down
	elif f.pos_y < 0:
		local = hp.push_air
	elif f.state_name == "CROUCH":
		local = hp.push_crouch
	return FixedMath.mirror_rect(f.pos_x, f.pos_y, f.facing, local)


static func get_world_hurtboxes(
	f: SimState.FighterSimState,
	bundle: DataModels.FighterBundle
) -> Array[PackedInt64Array]:
	var out: Array[PackedInt64Array] = []
	if f.state_name == "DEAD":
		return out
	# Check frame-specific hurtbox_override first (spec part 3 section 5)
	if f.current_move_id != "" and bundle.moves.has(f.current_move_id):
		var mfd: DataModels.MoveFrameData = bundle.moves[f.current_move_id] as DataModels.MoveFrameData
		for ov in mfd.hurtbox_overrides:
			if f.state_tick >= ov.frames_start and f.state_tick <= ov.frames_end:
				for r in ov.rects:
					out.append(FixedMath.mirror_rect(f.pos_x, f.pos_y, f.facing, r))
				return out

	var hp: DataModels.HurtboxProfile = bundle.hurtboxes
	var src: Array[PackedInt64Array] = hp.stand
	if f.state_name == "KNOCKDOWN":
		src = hp.down
	elif f.pos_y < 0:
		src = hp.air
	elif f.state_name == "CROUCH":
		src = hp.crouch
	for r in src:
		out.append(FixedMath.mirror_rect(f.pos_x, f.pos_y, f.facing, r))
	return out


static func get_world_active_hitboxes(
	f: SimState.FighterSimState,
	bundle: DataModels.FighterBundle
) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if f.current_move_id == "" or not bundle.moves.has(f.current_move_id):
		return out
	if not (f.state_name in ["ATTACKING", "SKILL", "ULTIMATE", "THROWING"]):
		return out
	var mfd: DataModels.MoveFrameData = bundle.moves[f.current_move_id] as DataModels.MoveFrameData
	for hb in mfd.hitboxes:
		if f.state_tick >= hb.frames_start and f.state_tick <= hb.frames_end:
			out.append({
				"spec": hb,
				"world_rect": FixedMath.mirror_rect(f.pos_x, f.pos_y, f.facing, hb.rect),
			})
	return out


static func resolve_all_hits(
	state: SimState,
	bundles: Array[DataModels.FighterBundle],
	cfg: DataModels.CombatConfigData
) -> void:
	if state.round_phase != SimState.RoundPhase.FIGHT:
		return

	# 1. Collect candidate fighter melee hits in deterministic slot order (0 -> 1, then 1 -> 0)
	var melee_hits: Array[PendingHit] = [null, null]
	for atk_slot in range(2):
		var def_slot: int = 1 - atk_slot
		melee_hits[atk_slot] = _find_melee_hit(
			state, state.fighters[atk_slot], state.fighters[def_slot],
			bundles[atk_slot], bundles[def_slot], cfg
		)

	# 2. Simultaneous mutual hit check: compare priority; equal priority => Trade (both land)
	if melee_hits[0] != null and melee_hits[1] != null:
		var p0: int = melee_hits[0].hit_spec.priority
		var p1: int = melee_hits[1].hit_spec.priority
		if p0 > p1:
			melee_hits[1] = null
		elif p1 > p0:
			melee_hits[0] = null

	for atk_slot in range(2):
		if melee_hits[atk_slot] != null:
			_apply_hit(state, melee_hits[atk_slot], bundles, cfg)

	# 3. Collect & apply projectile hits in entity_id order
	for proj in state.projectiles:
		if not proj.active:
			continue
		var def_slot: int = 1 - proj.owner_slot
		var phit: PendingHit = _find_projectile_hit(
			state, proj, state.fighters[def_slot], bundles[def_slot], cfg
		)
		if phit != null:
			proj.active = false
			_apply_hit(state, phit, bundles, cfg)


static func _find_melee_hit(
	state: SimState,
	atk: SimState.FighterSimState,
	dfd: SimState.FighterSimState,
	atk_bundle: DataModels.FighterBundle,
	dfd_bundle: DataModels.FighterBundle,
	cfg: DataModels.CombatConfigData
) -> PendingHit:
	if atk.hitstop_ticks > 0:
		return null
	if FighterController.is_fighter_invulnerable(dfd, dfd_bundle):
		return null
	if dfd.pos_y < 0 and dfd.juggle_count >= cfg.juggle_max_hits:
		return null
	if ComboRules.get_move_combo_uses(dfd, atk_bundle, atk.current_move_id) >= cfg.same_move_combo_limit:
		return null

	var hurtboxes: Array[PackedInt64Array] = get_world_hurtboxes(dfd, dfd_bundle)
	if hurtboxes.is_empty():
		return null

	for item in get_world_active_hitboxes(atk, atk_bundle):
		var spec: DataModels.HitBoxSpec = item["spec"] as DataModels.HitBoxSpec
		if dfd.pos_y < 0 and not spec.air_hit:
			continue
		if _is_registered(state, 0, atk.slot, atk.move_instance_id, spec.hit_index, dfd.slot):
			continue
		var wrect: PackedInt64Array = item["world_rect"] as PackedInt64Array
		for hbox in hurtboxes:
			if FixedMath.rects_overlap(wrect, hbox):
				var ph := PendingHit.new()
				ph.source_kind = 0
				ph.attacker_slot = atk.slot
				ph.defender_slot = dfd.slot
				ph.source_id = atk.slot
				ph.move_instance_id = atk.move_instance_id
				ph.move_id = atk.current_move_id
				ph.hit_index = spec.hit_index
				ph.hit_spec = spec
				ph.attacker_facing = atk.facing
				ph.impact_x = FixedMath.div_trunc(maxi(wrect[0], hbox[0]) + mini(wrect[0] + wrect[2], hbox[0] + hbox[2]), 2)
				ph.impact_y = FixedMath.div_trunc(maxi(wrect[1], hbox[1]) + mini(wrect[1] + wrect[3], hbox[1] + hbox[3]), 2)
				return ph
	return null


static func _find_projectile_hit(
	state: SimState,
	proj: SimState.ProjectileSimState,
	dfd: SimState.FighterSimState,
	dfd_bundle: DataModels.FighterBundle,
	cfg: DataModels.CombatConfigData
) -> PendingHit:
	if FighterController.is_fighter_invulnerable(dfd, dfd_bundle):
		return null
	if dfd.pos_y < 0 and (not proj.air_hit or dfd.juggle_count >= cfg.juggle_max_hits):
		return null
	if _is_registered(state, 1, proj.entity_id, proj.entity_id, 0, dfd.slot):
		return null
	var hurtboxes: Array[PackedInt64Array] = get_world_hurtboxes(dfd, dfd_bundle)
	var wrect: PackedInt64Array = FixedMath.mirror_rect(proj.pos_x, proj.pos_y, proj.facing, proj.rect)
	for hbox in hurtboxes:
		if FixedMath.rects_overlap(wrect, hbox):
			var spec := DataModels.HitBoxSpec.new()
			spec.damage = proj.damage
			spec.knockback_x = proj.knockback_x
			spec.knockback_y = proj.knockback_y
			spec.hitstun = proj.hitstun
			spec.blockstun = proj.blockstun
			spec.hitstop = proj.hitstop
			spec.block_hitstop = proj.block_hitstop
			spec.air_hit = proj.air_hit
			spec.priority = proj.priority
			spec.meter_gain_on_hit = proj.meter_gain_on_hit
			spec.meter_gain_on_block = proj.meter_gain_on_block
			var ph := PendingHit.new()
			ph.source_kind = 1
			ph.attacker_slot = proj.owner_slot
			ph.defender_slot = dfd.slot
			ph.source_id = proj.entity_id
			ph.move_instance_id = proj.entity_id
			ph.move_id = ""
			ph.hit_index = 0
			ph.hit_spec = spec
			ph.attacker_facing = proj.facing
			ph.impact_x = proj.pos_x
			ph.impact_y = proj.pos_y
			return ph
	return null


static func _apply_hit(
	state: SimState,
	ph: PendingHit,
	bundles: Array[DataModels.FighterBundle],
	cfg: DataModels.CombatConfigData
) -> void:
	var atk: SimState.FighterSimState = state.fighters[ph.attacker_slot]
	var dfd: SimState.FighterSimState = state.fighters[ph.defender_slot]
	var atk_bundle: DataModels.FighterBundle = bundles[ph.attacker_slot]
	var dfd_bundle: DataModels.FighterBundle = bundles[ph.defender_slot]
	var spec: DataModels.HitBoxSpec = ph.hit_spec

	_register_hit(state, ph.source_kind, ph.source_id, ph.move_instance_id, ph.hit_index, dfd.slot)

	var is_guarded: bool = _can_defender_block(dfd, dfd_bundle, ph.attacker_facing)
	var push_dir: int = 1 if ph.attacker_facing >= 0 else -1

	if is_guarded:
		var bstun: int = spec.blockstun
		var bstop: int = spec.block_hitstop
		dfd.state_name = "BLOCKSTUN"
		dfd.state_tick = 0
		dfd.current_move_id = ""
		dfd.anim_id = "block" if dfd_bundle.supports_move("block") else "idle"
		dfd.anim_tick = 0
		dfd.stun_ticks = bstun
		dfd.hitstop_ticks = maxi(dfd.hitstop_ticks, bstop)
		if ph.source_kind == 0:
			atk.hitstop_ticks = maxi(atk.hitstop_ticks, bstop)
		var block_kb: int = FixedMath.div_trunc(spec.knockback_x, 2)
		_apply_horizontal_knockback_with_corner(atk, dfd, push_dir * block_kb, ph.source_kind == 0, cfg)
		atk.gauge = mini(atk.max_gauge, atk.gauge + spec.meter_gain_on_block)
		var def_gain: int = FixedMath.div_trunc(spec.meter_gain_on_block * dfd_bundle.gauge_gain_on_block_pct, 100)
		dfd.gauge = mini(dfd.max_gauge, dfd.gauge + def_gain)
		state.push_event("block_spark", dfd.slot, "block", ph.impact_x, ph.impact_y, 0)
		return

	# Clean hit (or armored hit)
	var raw_scaled: int = ComboRules.compute_scaled_damage(spec.damage, dfd.combo_count, cfg)
	var def_factor: int = maxi(1, dfd_bundle.defense)
	var final_damage: int = maxi(1, FixedMath.div_trunc(raw_scaled * 100, def_factor)) if spec.damage > 0 else 0
	dfd.hp = maxi(0, dfd.hp - final_damage)

	var hstop: int = spec.hitstop
	dfd.hitstop_ticks = maxi(dfd.hitstop_ticks, hstop)
	if ph.source_kind == 0:
		atk.hitstop_ticks = maxi(atk.hitstop_ticks, hstop)

	atk.gauge = mini(atk.max_gauge, atk.gauge + spec.meter_gain_on_hit)
	var hurt_gain: int = FixedMath.div_trunc(final_damage * dfd_bundle.gauge_gain_on_hurt_pct, 100)
	dfd.gauge = mini(dfd.max_gauge, dfd.gauge + hurt_gain)

	if dfd.hp <= 0:
		dfd.combo_count += 1
		dfd.state_name = "DEAD"
		dfd.state_tick = 0
		dfd.current_move_id = ""
		dfd.anim_id = "knockdown" if dfd_bundle.supports_move("knockdown") else "hit"
		dfd.anim_tick = 0
		dfd.stun_ticks = 0
		_apply_horizontal_knockback_with_corner(atk, dfd, push_dir * spec.knockback_x, ph.source_kind == 0, cfg)
		state.push_event("hit_spark", dfd.slot, "ko_hit", ph.impact_x, ph.impact_y, final_damage)
		return

	var armored: bool = FighterController.fighter_has_armor(dfd, dfd_bundle)
	if not armored:
		var scaled_stun: int = ComboRules.compute_scaled_hitstun(spec.hitstun, dfd.combo_count)
		dfd.combo_count += 1
		if ph.move_id != "":
			ComboRules.record_move_combo_use(dfd, atk_bundle, ph.move_id)
		dfd.state_name = "HITSTUN"
		dfd.state_tick = 0
		dfd.current_move_id = ""
		dfd.anim_id = "hit" if dfd_bundle.supports_move("hit") else "idle"
		dfd.anim_tick = 0
		dfd.stun_ticks = scaled_stun
		if dfd.pos_y < 0 or spec.knockback_y < 0:
			dfd.juggle_count += 1
			dfd.vel_y = spec.knockback_y if spec.knockback_y < 0 else -4500
		_apply_horizontal_knockback_with_corner(atk, dfd, push_dir * spec.knockback_x, ph.source_kind == 0, cfg)

	state.push_event("hit_spark", dfd.slot, "hit", ph.impact_x, ph.impact_y, final_damage)
	if final_damage >= 60:
		state.push_event("camera_shake", atk.slot, "heavy", ph.impact_x, ph.impact_y, hstop)


static func _apply_horizontal_knockback_with_corner(
	atk: SimState.FighterSimState,
	dfd: SimState.FighterSimState,
	signed_kb_x: int,
	allow_corner_transfer: bool,
	cfg: DataModels.CombatConfigData
) -> void:
	## Immediate displacement component + velocity slide; transfers excess push to melee attacker at stage wall.
	var instant_disp: int = signed_kb_x * 4
	var desired_x: int = dfd.pos_x + instant_disp
	var clamped_x: int = FixedMath.clamp_int(desired_x, -cfg.stage_half_width, cfg.stage_half_width)
	var blocked_disp: int = desired_x - clamped_x
	dfd.pos_x = clamped_x
	dfd.vel_x = FixedMath.div_trunc(signed_kb_x, 2)

	if allow_corner_transfer and blocked_disp != 0 and atk.pos_y == 0:
		var push_back: int = FixedMath.div_trunc(blocked_disp * cfg.corner_pushback_permille, 1000)
		atk.pos_x = FixedMath.clamp_int(atk.pos_x - push_back, -cfg.stage_half_width, cfg.stage_half_width)


static func _can_defender_block(
	dfd: SimState.FighterSimState,
	dfd_bundle: DataModels.FighterBundle,
	attacker_facing: int
) -> bool:
	if dfd.pos_y < 0 or not dfd_bundle.supports_move("block"):
		return false
	# Defender must be facing toward the incoming attack
	if dfd.facing == attacker_facing:
		return false
	if dfd.state_name in ["BLOCKING", "BLOCKSTUN"]:
		return true
	if dfd.state_name in ["IDLE", "WALK_BACKWARD", "CROUCH"]:
		if (dfd.current_input & InputBits.BLOCK) != 0 or InputBits.is_holding_back(dfd.current_input, dfd.facing):
			return true
	return false


static func _is_registered(
	state: SimState,
	source_kind: int,
	source_id: int,
	move_inst: int,
	hit_idx: int,
	target_slot: int
) -> bool:
	for entry in state.hit_registry:
		if (
			entry[0] == source_kind
			and entry[1] == source_id
			and entry[2] == move_inst
			and entry[3] == hit_idx
			and entry[4] == target_slot
		):
			return true
	return false


static func _register_hit(
	state: SimState,
	source_kind: int,
	source_id: int,
	move_inst: int,
	hit_idx: int,
	target_slot: int
) -> void:
	state.hit_registry.append(PackedInt64Array([source_kind, source_id, move_inst, hit_idx, target_slot]))
