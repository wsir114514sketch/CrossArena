class_name FighterController
extends RefCounted
## Data-driven fighter state machine and movement controller (spec part 3 section 4).
## Reads transition permissions from res://fighter/state_transitions.json.

static var _cached_state_table: Dictionary = {}


static func get_state_rules(state_name: String) -> Dictionary:
	if _cached_state_table.is_empty():
		var raw: Dictionary = DataLoader.read_json_dict(DataLoader.STATE_TABLE_PATH)
		_cached_state_table = raw.get("states", {}) as Dictionary
	return _cached_state_table.get(state_name, {}) as Dictionary


static func reset_for_round(
	f: SimState.FighterSimState,
	slot: int,
	bundle: DataModels.FighterBundle,
	start_x: int,
	facing: int
) -> void:
	f.slot = slot
	f.pos_x = start_x
	f.pos_y = 0
	f.vel_x = 0
	f.vel_y = 0
	f.facing = facing
	f.max_hp = bundle.max_hp
	f.hp = bundle.max_hp
	f.max_gauge = bundle.max_gauge
	f.state_name = "IDLE"
	f.state_tick = 0
	f.anim_id = "idle"
	f.anim_tick = 0
	f.current_move_id = ""
	f.hitstop_ticks = 0
	f.stun_ticks = 0
	f.combo_count = 0
	f.juggle_count = 0
	f.landing_ticks = 0
	f.prev_input = 0
	f.current_input = 0
	f.buffered_buttons.clear()
	f.skill_cooldowns.resize(bundle.skills.size())
	f.skill_cooldowns.fill(0)
	f.combo_move_counts.resize(bundle.move_ids_sorted.size())
	f.combo_move_counts.fill(0)


static func update_auto_facing(
	f: SimState.FighterSimState,
	opp: SimState.FighterSimState
) -> void:
	if f.pos_y < 0:
		return
	var rules: Dictionary = get_state_rules(f.state_name)
	if bool(rules.get("locks_facing", true)):
		return
	if opp.pos_x > f.pos_x:
		f.facing = 1
	elif opp.pos_x < f.pos_x:
		f.facing = -1


static func update_fighter_state(
	state: SimState,
	f: SimState.FighterSimState,
	opp: SimState.FighterSimState,
	bundle: DataModels.FighterBundle,
	controls_enabled: bool
) -> void:
	if f.hitstop_ticks > 0 or f.state_name == "DEAD":
		return

	# 1. Complete timed / finite states first
	_advance_completed_states(f, opp, bundle)
	update_auto_facing(f, opp)

	if not controls_enabled:
		if f.pos_y == 0 and f.state_name in ["WALK_FORWARD", "WALK_BACKWARD", "CROUCH", "BLOCKING"]:
			_enter_state(f, "IDLE", "idle")
			f.vel_x = 0
		return

	var rules: Dictionary = get_state_rules(f.state_name)

	# 2. Cancel window checks while in ATTACKING / SKILL
	if f.state_name in ["ATTACKING", "SKILL"] and bundle.moves.has(f.current_move_id):
		var cur_fd: DataModels.MoveFrameData = bundle.moves[f.current_move_id] as DataModels.MoveFrameData
		if SkillExecutor.try_trigger_buffered_skill(state, f, bundle, true, cur_fd):
			SkillExecutor.process_move_frame_triggers(state, f, bundle)
			_emit_anim_events_if_frame_start(state, f, bundle)
			return
		if _try_trigger_normal_attack(f, bundle, true, cur_fd):
			_emit_anim_events_if_frame_start(state, f, bundle)
			return

	# 3. Normal / neutral / airborne state transitions driven by state_transitions.json
	if bool(rules.get("can_skill", false)) and f.pos_y == 0:
		if SkillExecutor.try_trigger_buffered_skill(state, f, bundle, false, null):
			SkillExecutor.process_move_frame_triggers(state, f, bundle)
			_emit_anim_events_if_frame_start(state, f, bundle)
			return

	if bool(rules.get("can_normal_attack", false)):
		if _try_trigger_normal_attack(f, bundle, false, null):
			_emit_anim_events_if_frame_start(state, f, bundle)
			return

	if bool(rules.get("can_jump", false)) and f.pos_y == 0 and (f.current_input & InputBits.UP) != 0:
		f.landing_ticks = 0
		var hx: int = InputBits.horizontal_sign(f.current_input)
		f.vel_x = hx * bundle.walk_speed
		f.vel_y = -bundle.jump_velocity
		var j_anim: String = "jump_start" if bundle.anims.has("jump_start") else "jump_loop"
		_enter_state(f, "JUMP", j_anim)
		_emit_anim_events_if_frame_start(state, f, bundle)
		return

	# Ground guard / crouch / walk / idle
	if f.pos_y == 0 and f.state_name in ["IDLE", "WALK_FORWARD", "WALK_BACKWARD", "CROUCH", "BLOCKING"]:
		var wants_block: bool = (f.current_input & InputBits.BLOCK) != 0 or (
			InputBits.is_holding_back(f.current_input, f.facing) and _opponent_is_threatening(state, opp)
		)
		if wants_block and bool(rules.get("can_block", false)) and bundle.supports_move("block"):
			f.vel_x = 0
			if f.state_name != "BLOCKING":
				_enter_state(f, "BLOCKING", "block")
		elif (f.current_input & InputBits.DOWN) != 0 and bool(rules.get("can_crouch", false)):
			f.vel_x = 0
			if f.state_name != "CROUCH":
				_enter_state(f, "CROUCH", "crouch")
		elif InputBits.is_holding_forward(f.current_input, f.facing) and bool(rules.get("can_walk", false)):
			f.vel_x = f.facing * bundle.walk_speed
			if f.state_name != "WALK_FORWARD":
				_enter_state(f, "WALK_FORWARD", "walk_forward")
		elif InputBits.is_holding_back(f.current_input, f.facing) and bool(rules.get("can_walk", false)):
			f.vel_x = -f.facing * bundle.walk_speed
			if f.state_name != "WALK_BACKWARD":
				_enter_state(f, "WALK_BACKWARD", "walk_backward")
		else:
			f.vel_x = 0
			if f.state_name != "IDLE":
				var idle_anim: String = "landing" if f.landing_ticks > 0 and bundle.anims.has("landing") else "idle"
				_enter_state(f, "IDLE", idle_anim)

	# Switch jump_start -> jump_loop once jump_start finishes
	if f.state_name == "JUMP" and f.anim_id == "jump_start" and bundle.anims.has("jump_start") and bundle.anims.has("jump_loop"):
		var js: DataModels.AnimSpec = bundle.anims["jump_start"] as DataModels.AnimSpec
		var js_len: int = FixedMath.div_trunc(js.frame_count * 60 + js.animation_fps - 1, js.animation_fps)
		if f.anim_tick >= js_len:
			f.anim_id = "jump_loop"
			f.anim_tick = 0

	SkillExecutor.process_move_frame_triggers(state, f, bundle)
	_emit_anim_events_if_frame_start(state, f, bundle)


static func apply_physics_step(
	state: SimState,
	f: SimState.FighterSimState,
	bundle: DataModels.FighterBundle,
	stage_half_width: int
) -> void:
	if f.hitstop_ticks > 0:
		return
	var was_airborne: bool = f.pos_y < 0 or f.vel_y < 0
	f.pos_x += f.vel_x
	f.pos_y += f.vel_y

	if was_airborne:
		f.vel_y += bundle.gravity

	if f.pos_y >= 0:
		f.pos_y = 0
		f.vel_y = 0
		if was_airborne:
			_on_landed(state, f, bundle)

	# Ground friction during stun/knockdown
	if f.pos_y == 0 and f.state_name in ["HITSTUN", "BLOCKSTUN", "KNOCKDOWN", "WAKEUP", "ATTACKING", "SKILL", "ULTIMATE", "DEAD"]:
		if f.vel_x > 0:
			f.vel_x = maxi(0, f.vel_x - 600)
		elif f.vel_x < 0:
			f.vel_x = mini(0, f.vel_x + 600)

	f.pos_x = FixedMath.clamp_int(f.pos_x, -stage_half_width, stage_half_width)


static func is_fighter_invulnerable(f: SimState.FighterSimState, bundle: DataModels.FighterBundle) -> bool:
	var rules: Dictionary = get_state_rules(f.state_name)
	if bool(rules.get("invulnerable", false)):
		return true
	if f.current_move_id != "" and bundle.moves.has(f.current_move_id):
		var mfd: DataModels.MoveFrameData = bundle.moves[f.current_move_id] as DataModels.MoveFrameData
		if mfd.is_invulnerable_at(f.state_tick):
			return true
	return false


static func fighter_has_armor(f: SimState.FighterSimState, bundle: DataModels.FighterBundle) -> bool:
	if f.current_move_id != "" and bundle.moves.has(f.current_move_id):
		var mfd: DataModels.MoveFrameData = bundle.moves[f.current_move_id] as DataModels.MoveFrameData
		return mfd.has_armor_at(f.state_tick)
	return false


static func _advance_completed_states(
	f: SimState.FighterSimState,
	opp: SimState.FighterSimState,
	bundle: DataModels.FighterBundle
) -> void:
	if f.landing_ticks > 0:
		f.landing_ticks -= 1
		if f.landing_ticks == 0 and f.state_name == "IDLE" and f.anim_id == "landing":
			f.anim_id = "idle"
			f.anim_tick = 0

	match f.state_name:
		"ATTACKING", "SKILL", "ULTIMATE", "THROWING":
			if bundle.moves.has(f.current_move_id):
				var mfd: DataModels.MoveFrameData = bundle.moves[f.current_move_id] as DataModels.MoveFrameData
				if f.state_tick >= mfd.total_ticks:
					f.current_move_id = ""
					if f.pos_y < 0:
						_enter_state(f, "JUMP", "jump_loop" if bundle.anims.has("jump_loop") else "idle")
					else:
						_enter_state(f, "IDLE", "idle")
			else:
				f.current_move_id = ""
				_enter_state(f, "IDLE", "idle")
		"HITSTUN":
			if f.pos_y == 0 and f.stun_ticks <= 0:
				f.combo_count = 0
				f.juggle_count = 0
				f.combo_move_counts.fill(0)
				_enter_state(f, "IDLE", "idle")
		"BLOCKSTUN":
			if f.stun_ticks <= 0:
				var still_blocking: bool = (f.current_input & InputBits.BLOCK) != 0 or InputBits.is_holding_back(f.current_input, f.facing)
				if still_blocking and bundle.supports_move("block"):
					_enter_state(f, "BLOCKING", "block")
				else:
					_enter_state(f, "IDLE", "idle")
		"KNOCKDOWN":
			var kd_len: int = _anim_sim_ticks(bundle, "knockdown", 30)
			if f.state_tick >= kd_len:
				if bundle.supports_move("wakeup"):
					_enter_state(f, "WAKEUP", "wakeup")
					if bundle.moves.has("wakeup"):
						f.current_move_id = "wakeup"
				else:
					f.combo_count = 0
					f.juggle_count = 0
					f.combo_move_counts.fill(0)
					_enter_state(f, "IDLE", "idle")
		"WAKEUP":
			var wu_len: int = _anim_sim_ticks(bundle, "wakeup", 16)
			if bundle.moves.has("wakeup"):
				wu_len = (bundle.moves["wakeup"] as DataModels.MoveFrameData).total_ticks
			if f.state_tick >= wu_len:
				f.current_move_id = ""
				f.combo_count = 0
				f.juggle_count = 0
				f.combo_move_counts.fill(0)
				update_auto_facing(f, opp)
				_enter_state(f, "IDLE", "idle")


static func _try_trigger_normal_attack(
	f: SimState.FighterSimState,
	bundle: DataModels.FighterBundle,
	from_cancel: bool,
	cur_fd: DataModels.MoveFrameData
) -> bool:
	var candidates: Array[Array] = []
	if f.pos_y < 0:
		candidates = [
			[InputBits.HEAVY, "air_attack"],
			[InputBits.MEDIUM, "air_attack"],
			[InputBits.LIGHT, "air_attack"],
		]
	else:
		candidates = [
			[InputBits.HEAVY, "heavy_01"],
			[InputBits.MEDIUM, "medium_01"],
			[InputBits.LIGHT, "light_02" if (from_cancel and f.current_move_id == "light_01" and bundle.moves.has("light_02")) else "light_01"],
		]

	for pair in candidates:
		var bit: int = int(pair[0])
		var mid: String = String(pair[1])
		if not InputBuffer.has_buffered(f, bit):
			continue
		if not bundle.moves.has(mid) or not bundle.supports_move(mid):
			continue
		if from_cancel and not ComboRules.can_cancel_move(cur_fd, f.state_tick, mid, ""):
			continue
		InputBuffer.consume_buffered(f, bit)
		var mfd: DataModels.MoveFrameData = bundle.moves[mid] as DataModels.MoveFrameData
		f.state_name = "ATTACKING"
		f.state_tick = 0
		f.current_move_id = mid
		f.move_instance_id += 1
		f.anim_id = mfd.animation_id
		f.anim_tick = 0
		if f.pos_y == 0:
			f.vel_x = 0
		f.gauge = mini(f.max_gauge, f.gauge + mfd.meter_gain_on_whiff)
		return true
	return false


static func _on_landed(
	state: SimState,
	f: SimState.FighterSimState,
	bundle: DataModels.FighterBundle
) -> void:
	f.vel_x = 0
	if f.state_name == "DEAD":
		return
	if f.state_name == "HITSTUN":
		if bundle.supports_move("knockdown"):
			_enter_state(f, "KNOCKDOWN", "knockdown")
			f.stun_ticks = 0
			state.push_event("knockdown", f.slot, "knockdown", f.pos_x, f.pos_y, 0)
		else:
			f.combo_count = 0
			f.juggle_count = 0
			f.combo_move_counts.fill(0)
			_enter_state(f, "IDLE", "idle")
		return
	f.current_move_id = ""
	if bundle.supports_move("landing"):
		f.landing_ticks = _anim_sim_ticks(bundle, "landing", 4)
		_enter_state(f, "IDLE", "landing")
	else:
		_enter_state(f, "IDLE", "idle")
	state.push_event("sfx", f.slot, "land", f.pos_x, f.pos_y, 0)


static func _opponent_is_threatening(state: SimState, opp: SimState.FighterSimState) -> bool:
	if opp.state_name in ["ATTACKING", "SKILL", "ULTIMATE"]:
		return true
	for p in state.projectiles:
		if p.active and p.owner_slot == opp.slot:
			return true
	return false


static func _anim_sim_ticks(bundle: DataModels.FighterBundle, anim_id: String, fallback: int) -> int:
	if not bundle.anims.has(anim_id):
		return fallback
	var a: DataModels.AnimSpec = bundle.anims[anim_id] as DataModels.AnimSpec
	return FixedMath.div_trunc(a.frame_count * 60 + a.animation_fps - 1, a.animation_fps)


static func _enter_state(f: SimState.FighterSimState, new_state: String, new_anim: String) -> void:
	f.state_name = new_state
	f.state_tick = 0
	f.anim_id = new_anim
	f.anim_tick = 0


static func _emit_anim_events_if_frame_start(
	state: SimState,
	f: SimState.FighterSimState,
	bundle: DataModels.FighterBundle
) -> void:
	if not bundle.anims.has(f.anim_id):
		return
	var a: DataModels.AnimSpec = bundle.anims[f.anim_id] as DataModels.AnimSpec
	if a.presentation_events.is_empty():
		return
	var cur_disp: int = FixedMath.div_trunc(f.anim_tick * a.animation_fps, 60)
	var prev_disp: int = -1 if f.anim_tick == 0 else FixedMath.div_trunc((f.anim_tick - 1) * a.animation_fps, 60)
	if cur_disp == prev_disp:
		return
	var frame_idx: int = posmod(cur_disp, a.frame_count) if a.loop else mini(cur_disp, a.frame_count - 1)
	for ev in a.presentation_events:
		if ev.frame == frame_idx:
			state.push_event(ev.type, f.slot, ev.id, f.pos_x, f.pos_y, frame_idx)
