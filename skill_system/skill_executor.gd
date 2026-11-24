class_name SkillExecutor
extends RefCounted
## Data-driven skill activation, cooldown/gauge management, and projectile spawning.


static func try_trigger_buffered_skill(
	state: SimState,
	f: SimState.FighterSimState,
	bundle: DataModels.FighterBundle,
	allow_from_cancel: bool,
	cur_move_fd: DataModels.MoveFrameData
) -> bool:
	for i in range(bundle.skills.size()):
		var sk: DataModels.SkillSpec = bundle.skills[i]
		var btn: int = _input_code_to_bit(sk.input_code)
		if btn == 0 or not InputBuffer.has_buffered(f, btn):
			continue
		if i < f.skill_cooldowns.size() and f.skill_cooldowns[i] > 0:
			continue
		if f.gauge < sk.cost:
			continue
		var category: String = "ultimate" if sk.type == "ultimate" else "skill"
		if allow_from_cancel:
			if not ComboRules.can_cancel_move(cur_move_fd, f.state_tick, sk.move_id, category):
				continue
		if not bundle.moves.has(sk.move_id):
			continue
		InputBuffer.consume_buffered(f, btn)
		f.gauge -= sk.cost
		if i < f.skill_cooldowns.size():
			f.skill_cooldowns[i] = sk.cooldown
		var target_state: String = "ULTIMATE" if sk.type == "ultimate" else "SKILL"
		var mfd: DataModels.MoveFrameData = bundle.moves[sk.move_id] as DataModels.MoveFrameData
		f.state_name = target_state
		f.state_tick = 0
		f.current_move_id = sk.move_id
		f.move_instance_id += 1
		f.anim_id = mfd.animation_id
		f.anim_tick = 0
		f.vel_x = 0
		f.gauge = mini(f.max_gauge, f.gauge + mfd.meter_gain_on_whiff)
		if mfd.has_super_freeze and mfd.super_freeze_frame == 0:
			state.super_freeze_ticks = maxi(state.super_freeze_ticks, mfd.super_freeze_duration)
			state.push_event("super_freeze", f.slot, sk.skill_id, f.pos_x, f.pos_y, mfd.super_freeze_duration)
		return true
	return false


static func process_move_frame_triggers(
	state: SimState,
	f: SimState.FighterSimState,
	bundle: DataModels.FighterBundle
) -> void:
	if f.current_move_id == "" or not bundle.moves.has(f.current_move_id):
		return
	var mfd: DataModels.MoveFrameData = bundle.moves[f.current_move_id] as DataModels.MoveFrameData
	if mfd.has_super_freeze and mfd.super_freeze_frame == f.state_tick and f.state_tick > 0:
		state.super_freeze_ticks = maxi(state.super_freeze_ticks, mfd.super_freeze_duration)

	if mfd.projectile_spawns.is_empty():
		return
	var sk: DataModels.SkillSpec = _find_skill_for_move(bundle, f.current_move_id)
	for ps in mfd.projectile_spawns:
		if ps.frame != f.state_tick:
			continue
		var p := SimState.ProjectileSimState.new()
		p.entity_id = state.next_entity_id
		state.next_entity_id += 1
		p.owner_slot = f.slot
		p.facing = f.facing
		var ox: int = ps.offset_x if f.facing >= 0 else -ps.offset_x
		p.pos_x = f.pos_x + ox
		p.pos_y = f.pos_y + ps.offset_y
		var spd: int = sk.proj_speed if sk != null else 8000
		p.vel_x = spd if f.facing >= 0 else -spd
		p.vel_y = sk.proj_vel_y if sk != null else 0
		p.gravity = sk.proj_gravity if sk != null else 0
		p.remaining_ticks = sk.proj_lifetime if sk != null else 90
		p.effect_path = sk.proj_effect if sk != null else ""
		p.rect = ps.rect.duplicate()
		p.damage = ps.hit.damage
		p.knockback_x = ps.hit.knockback_x
		p.knockback_y = ps.hit.knockback_y
		p.hitstun = ps.hit.hitstun
		p.blockstun = ps.hit.blockstun
		p.hitstop = ps.hit.hitstop
		p.block_hitstop = ps.hit.block_hitstop
		p.air_hit = ps.hit.air_hit
		p.priority = ps.hit.priority
		p.meter_gain_on_hit = ps.hit.meter_gain_on_hit
		p.meter_gain_on_block = ps.hit.meter_gain_on_block
		p.active = true
		state.projectiles.append(p)
		state.push_event("projectile_spawn", f.slot, p.effect_path, p.pos_x, p.pos_y, p.entity_id)


static func _find_skill_for_move(bundle: DataModels.FighterBundle, move_id: String) -> DataModels.SkillSpec:
	for sk in bundle.skills:
		if sk.move_id == move_id:
			return sk
	return null


static func _input_code_to_bit(code: String) -> int:
	match code:
		"skill_01":
			return InputBits.SKILL_1
		"skill_ultimate", "ultimate":
			return InputBits.ULTIMATE
		_:
			return InputBits.SKILL_1
