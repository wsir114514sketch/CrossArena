extends GutTest
## Phase 1 Gate Tests:
## 1. Two fighters complete a full multi-round match from INTRO to MATCH_END.
## 2. Replaying an identical input log produces bit-identical per-frame checksums.
## 3. Mid-match save_state() / load_state() rollback & re-simulation matches checksums bit-for-bit.
## 4. BattleScene node hierarchy instantiates and renders cleanly without writing back to SimState.


func test_complete_two_round_match_to_victory() -> void:
	var cfg: DataModels.CombatConfigData = DataLoader.load_combat_config()
	var b0: DataModels.FighterBundle = DataLoader.load_fighter("test_pack.dummy_a")
	var b1: DataModels.FighterBundle = DataLoader.load_fighter("test_pack.dummy_b")
	var s: SimState = CombatSim.create_match_state(b0, b1, cfg, 777)

	var safety_ticks: int = 0
	while s.round_phase != SimState.RoundPhase.MATCH_END and safety_ticks < 6000:
		var p1_in: int = 0
		if s.round_phase == SimState.RoundPhase.FIGHT:
			var dist: int = absi(s.fighters[1].pos_x - s.fighters[0].pos_x)
			if dist > 72000:
				p1_in = InputBits.RIGHT
			else:
				# Alternate press/release so edge-triggered input buffer fires attacks
				p1_in = InputBits.HEAVY if (s.tick % 6 == 0) else 0
		CombatSim.step(s, PackedInt64Array([p1_in, 0]), [b0, b1], cfg)
		safety_ticks += 1

	assert_eq(s.round_phase, SimState.RoundPhase.MATCH_END, "match reached MATCH_END")
	assert_eq(s.match_winner, 0, "P1 won the best-of-3 match")
	assert_eq(s.rounds_won[0], cfg.rounds_to_win)
	assert_lt(safety_ticks, 6000)


func test_deterministic_replay_and_rollback_checksums_match_bit_for_bit() -> void:
	var cfg: DataModels.CombatConfigData = DataLoader.load_combat_config()
	var b0: DataModels.FighterBundle = DataLoader.load_fighter("test_pack.dummy_a")
	var b1: DataModels.FighterBundle = DataLoader.load_fighter("test_pack.dummy_b")
	var bundles: Array[DataModels.FighterBundle] = [b0, b1]

	var ai0 := SparringAI.new()
	var ai1 := SparringAI.new()
	ai0.reset(11111)
	ai1.reset(22222)

	# Run 1: record 900 ticks of dynamic 2-bot combat + per-frame checksums + snapshot at tick 300
	var s1: SimState = CombatSim.create_match_state(b0, b1, cfg, 20261124)
	var input_log: Array[PackedInt64Array] = []
	var checksums_run1 := PackedInt64Array()
	var snap_300: Dictionary = {}

	for t in range(900):
		var in0: int = ai0.compute_input(s1, 0, b0)
		var in1: int = ai1.compute_input(s1, 1, b1)
		var frame_in := PackedInt64Array([in0, in1])
		input_log.append(frame_in)
		CombatSim.step(s1, frame_in, bundles, cfg)
		checksums_run1.append(s1.compute_checksum())
		if t == 299:
			snap_300 = s1.save_state()

	# Run 2: fresh state replaying recorded input_log -> every single frame checksum must match!
	var s2: SimState = CombatSim.create_match_state(b0, b1, cfg, 20261124)
	for t in range(900):
		CombatSim.step(s2, input_log[t], bundles, cfg)
		assert_eq(s2.compute_checksum(), checksums_run1[t], "replay checksum mismatch at index %d" % t)

	# Run 3: simulate divergent timeline on s2, then rollback to tick 300 via load_state and re-simulate!
	for _k in range(120):
		CombatSim.step(s2, PackedInt64Array([InputBits.LEFT | InputBits.UP, InputBits.HEAVY]), bundles, cfg)
	s2.load_state(snap_300)
	assert_eq(s2.compute_checksum(), checksums_run1[299], "restored snapshot checksum must match tick 300")
	for t in range(300, 900):
		CombatSim.step(s2, input_log[t], bundles, cfg)
		assert_eq(s2.compute_checksum(), checksums_run1[t], "post-rollback checksum mismatch at index %d" % t)


func test_battle_scene_instantiates_and_renders_cleanly() -> void:
	var packed: PackedScene = load("res://combat/battle_scene.tscn") as PackedScene
	assert_not_null(packed)
	var scene: Node2D = packed.instantiate() as Node2D
	add_child_autofree(scene)

	for _i in range(90):
		scene._process(1.0 / 60.0)

	assert_not_null(scene.state)
	assert_eq(scene.state.tick, 90)
	assert_eq(scene.state.round_phase, SimState.RoundPhase.FIGHT)
	assert_not_null(scene.fighter_p1_view.character_sprite.texture)
	assert_not_null(scene.fighter_p2_view.character_sprite.texture)
