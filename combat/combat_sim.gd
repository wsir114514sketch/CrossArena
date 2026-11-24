class_name CombatSim
extends RefCounted
## Deterministic 60 Hz simulation engine (spec part 3 section 2).
## Core contract: step(state, inputs) -> state.
## Given identical initial state and per-tick input masks, every tick checksum is bit-identical.


static func create_match_state(
	p1_bundle: DataModels.FighterBundle,
	p2_bundle: DataModels.FighterBundle,
	cfg: DataModels.CombatConfigData,
	rng_seed: int = 20261124
) -> SimState:
	var s := SimState.new()
	s.tick = 0
	s.rng_state = rng_seed if rng_seed != 0 else 1
	s.round_number = 1
	s.rounds_won = PackedInt64Array([0, 0])
	s.round_winner = -1
	s.match_winner = -1
	_setup_round(s, p1_bundle, p2_bundle, cfg)
	return s


static func step(
	state: SimState,
	inputs: PackedInt64Array,
	bundles: Array[DataModels.FighterBundle],
	cfg: DataModels.CombatConfigData
) -> SimState:
	## Executes one 60 Hz simulation tick in the exact 8-step order from spec part 3 section 2.
	state.events.clear()
	state.tick += 1

	var p1_in: int = inputs[0] if inputs.size() > 0 else 0
	var p2_in: int = inputs[1] if inputs.size() > 1 else 0

	# Step 1: Read both players' inputs and update input buffers
	InputBuffer.update_fighter_input(state.fighters[0], p1_in, cfg.input_buffer_frames)
	InputBuffer.update_fighter_input(state.fighters[1], p2_in, cfg.input_buffer_frames)

	# Super freeze pauses gameplay simulation for fixed ticks (spec part 3 section 8)
	if state.super_freeze_ticks > 0:
		state.super_freeze_ticks -= 1
		return state

	var controls_enabled: bool = (state.round_phase == SimState.RoundPhase.FIGHT)

	# Step 2: Update fighter state machines, cancel checks, and skill triggers
	FighterController.update_fighter_state(state, state.fighters[0], state.fighters[1], bundles[0], controls_enabled)
	FighterController.update_fighter_state(state, state.fighters[1], state.fighters[0], bundles[1], controls_enabled)

	# Step 3: Apply velocity & gravity, move fighters, clamp stage bounds, resolve pushbox overlap
	FighterController.apply_physics_step(state, state.fighters[0], bundles[0], cfg.stage_half_width)
	FighterController.apply_physics_step(state, state.fighters[1], bundles[1], cfg.stage_half_width)
	_resolve_pushbox_collision(state.fighters[0], state.fighters[1], bundles[0], bundles[1], cfg.stage_half_width)
	FighterController.update_auto_facing(state.fighters[0], state.fighters[1])
	FighterController.update_auto_facing(state.fighters[1], state.fighters[0])

	# Step 4: Update projectiles
	_step_projectiles(state, cfg)

	# Step 5: Hit detection and resolution
	HitResolver.resolve_all_hits(state, bundles, cfg)
	_prune_stale_hit_registry(state)

	# Step 6: Process Hitstop counters, stun/cooldown decay, anim_tick advance, and round timer
	for slot in range(2):
		var f: SimState.FighterSimState = state.fighters[slot]
		if f.hitstop_ticks > 0:
			f.hitstop_ticks -= 1
		else:
			f.state_tick += 1
			f.anim_tick += 1
			if f.stun_ticks > 0:
				f.stun_ticks -= 1
			for si in range(f.skill_cooldowns.size()):
				if f.skill_cooldowns[si] > 0:
					f.skill_cooldowns[si] -= 1

	# Step 7: Advance round phase & judge round / match victory
	_update_round_lifecycle(state, bundles, cfg)

	# Step 8: Events are already queued on `state.events` with `state.tick`
	return state


static func _setup_round(
	s: SimState,
	p1_bundle: DataModels.FighterBundle,
	p2_bundle: DataModels.FighterBundle,
	cfg: DataModels.CombatConfigData
) -> void:
	s.round_phase = SimState.RoundPhase.INTRO
	s.phase_timer = cfg.intro_ticks
	s.round_timer_ticks = cfg.round_time_seconds * FixedMath.SIM_HZ
	s.round_winner = -1
	s.super_freeze_ticks = 0
	s.projectiles.clear()
	s.hit_registry.clear()
	FighterController.reset_for_round(s.fighters[0], 0, p1_bundle, cfg.p1_start_x, 1)
	FighterController.reset_for_round(s.fighters[1], 1, p2_bundle, cfg.p2_start_x, -1)
	s.push_event("round_intro", -1, "round_%d" % s.round_number, 0, 0, s.round_number)


static func _resolve_pushbox_collision(
	f0: SimState.FighterSimState,
	f1: SimState.FighterSimState,
	b0: DataModels.FighterBundle,
	b1: DataModels.FighterBundle,
	stage_half_width: int
) -> void:
	if f0.state_name == "DEAD" or f1.state_name == "DEAD":
		return
	var p0: PackedInt64Array = HitResolver.get_world_pushbox(f0, b0)
	var p1: PackedInt64Array = HitResolver.get_world_pushbox(f1, b1)
	if not FixedMath.rects_overlap(p0, p1):
		return

	var c0_twice: int = 2 * p0[0] + p0[2]
	var c1_twice: int = 2 * p1[0] + p1[2]
	var f0_is_left: bool = true
	if c0_twice < c1_twice:
		f0_is_left = true
	elif c0_twice > c1_twice:
		f0_is_left = false
	elif f0.pos_x != f1.pos_x:
		f0_is_left = f0.pos_x < f1.pos_x
	else:
		f0_is_left = (f0.facing >= 0)

	if f0_is_left:
		var overlap: int = (p0[0] + p0[2]) - p1[0]
		if overlap <= 0:
			return
		var left_push: int = FixedMath.div_trunc(overlap + 1, 2)
		var right_push: int = overlap - left_push
		f0.pos_x -= left_push
		f1.pos_x += right_push
		if f0.pos_x < -stage_half_width:
			var spill: int = -stage_half_width - f0.pos_x
			f0.pos_x = -stage_half_width
			f1.pos_x = mini(stage_half_width, f1.pos_x + spill)
		elif f1.pos_x > stage_half_width:
			var spill2: int = f1.pos_x - stage_half_width
			f1.pos_x = stage_half_width
			f0.pos_x = maxi(-stage_half_width, f0.pos_x - spill2)
	else:
		var overlap_r: int = (p1[0] + p1[2]) - p0[0]
		if overlap_r <= 0:
			return
		var left_push_r: int = FixedMath.div_trunc(overlap_r + 1, 2)
		var right_push_r: int = overlap_r - left_push_r
		f1.pos_x -= left_push_r
		f0.pos_x += right_push_r
		if f1.pos_x < -stage_half_width:
			var spill3: int = -stage_half_width - f1.pos_x
			f1.pos_x = -stage_half_width
			f0.pos_x = mini(stage_half_width, f0.pos_x + spill3)
		elif f0.pos_x > stage_half_width:
			var spill4: int = f0.pos_x - stage_half_width
			f0.pos_x = stage_half_width
			f1.pos_x = maxi(-stage_half_width, f1.pos_x - spill4)


static func _step_projectiles(state: SimState, cfg: DataModels.CombatConfigData) -> void:
	var margin: int = cfg.stage_half_width + 160000
	var survivors: Array[SimState.ProjectileSimState] = []
	for p in state.projectiles:
		if not p.active:
			continue
		p.pos_x += p.vel_x
		p.pos_y += p.vel_y
		p.vel_y += p.gravity
		p.remaining_ticks -= 1
		if p.remaining_ticks <= 0 or absi(p.pos_x) > margin or p.pos_y > 60000:
			continue
		survivors.append(p)
	state.projectiles = survivors


static func _prune_stale_hit_registry(state: SimState) -> void:
	var active_proj_ids := PackedInt64Array()
	for p in state.projectiles:
		if p.active:
			active_proj_ids.append(p.entity_id)

	var kept: Array[PackedInt64Array] = []
	for entry in state.hit_registry:
		if entry[0] == 0:
			var f: SimState.FighterSimState = state.fighters[entry[1]]
			if f.current_move_id != "" and f.move_instance_id == entry[2]:
				kept.append(entry)
		elif entry[0] == 1:
			if active_proj_ids.has(entry[1]):
				kept.append(entry)
	state.hit_registry = kept


static func _update_round_lifecycle(
	state: SimState,
	bundles: Array[DataModels.FighterBundle],
	cfg: DataModels.CombatConfigData
) -> void:
	match state.round_phase:
		SimState.RoundPhase.INTRO:
			state.phase_timer -= 1
			if state.phase_timer <= 0:
				state.round_phase = SimState.RoundPhase.FIGHT
				state.push_event("round_fight", -1, "fight", 0, 0, state.round_number)
		SimState.RoundPhase.FIGHT:
			var f0: SimState.FighterSimState = state.fighters[0]
			var f1: SimState.FighterSimState = state.fighters[1]
			if f0.hp <= 0 or f1.hp <= 0:
				_conclude_round(state, cfg, true)
				return
			if f0.hitstop_ticks == 0 and f1.hitstop_ticks == 0 and state.round_timer_ticks > 0:
				state.round_timer_ticks -= 1
			if state.round_timer_ticks <= 0:
				_conclude_round(state, cfg, false)
		SimState.RoundPhase.KO:
			state.phase_timer -= 1
			if state.phase_timer <= 0:
				state.round_phase = SimState.RoundPhase.ROUND_END
				state.phase_timer = cfg.round_end_ticks
		SimState.RoundPhase.ROUND_END:
			state.phase_timer -= 1
			if state.phase_timer <= 0:
				if state.rounds_won[0] >= cfg.rounds_to_win and state.rounds_won[1] >= cfg.rounds_to_win:
					state.match_winner = 2
					state.round_phase = SimState.RoundPhase.MATCH_END
					state.push_event("match_end", 2, "draw", 0, 0, 2)
				elif state.rounds_won[0] >= cfg.rounds_to_win:
					state.match_winner = 0
					state.round_phase = SimState.RoundPhase.MATCH_END
					state.push_event("match_end", 0, "p1_win", 0, 0, 0)
				elif state.rounds_won[1] >= cfg.rounds_to_win:
					state.match_winner = 1
					state.round_phase = SimState.RoundPhase.MATCH_END
					state.push_event("match_end", 1, "p2_win", 0, 0, 1)
				else:
					state.round_number += 1
					_setup_round(state, bundles[0], bundles[1], cfg)
		SimState.RoundPhase.MATCH_END:
			pass


static func _conclude_round(state: SimState, cfg: DataModels.CombatConfigData, by_ko: bool) -> void:
	var f0: SimState.FighterSimState = state.fighters[0]
	var f1: SimState.FighterSimState = state.fighters[1]
	var pct0: int = FixedMath.div_trunc(f0.hp * 10000, maxi(1, f0.max_hp))
	var pct1: int = FixedMath.div_trunc(f1.hp * 10000, maxi(1, f1.max_hp))

	if pct0 > pct1:
		state.round_winner = 0
		state.rounds_won[0] += 1
	elif pct1 > pct0:
		state.round_winner = 1
		state.rounds_won[1] += 1
	else:
		state.round_winner = 2
		state.rounds_won[0] += 1
		state.rounds_won[1] += 1

	state.round_phase = SimState.RoundPhase.KO
	state.phase_timer = cfg.ko_ticks
	state.push_event("ko" if by_ko else "time_over", state.round_winner, "round_over", 0, 0, state.round_winner)
