extends GutTest
## Tests for Phase 1 combat rules: DataLoader test_only filter, movement, jump,
## pushbox separation, normal attack + hitstop + single-hit registry, block, cancel combo,
## mutual hit priority/trade, corner pushback, and projectile skill.

var cfg: DataModels.CombatConfigData
var b_a: DataModels.FighterBundle
var b_b: DataModels.FighterBundle


func before_each() -> void:
	cfg = DataLoader.load_combat_config()
	b_a = DataLoader.load_fighter("test_pack.dummy_a")
	b_b = DataLoader.load_fighter("test_pack.dummy_b")
	assert_not_null(b_a)
	assert_not_null(b_b)


func _ready_fight_state() -> SimState:
	var s: SimState = CombatSim.create_match_state(b_a, b_b, cfg, 42)
	# Advance past INTRO into FIGHT
	for _i in range(cfg.intro_ticks):
		CombatSim.step(s, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	assert_eq(s.round_phase, SimState.RoundPhase.FIGHT)
	return s


func test_dataloader_hides_test_only_packs_by_default() -> void:
	var prod_ips: Array[DataModels.IPInfo] = DataLoader.list_ips(false)
	for info in prod_ips:
		assert_false(info.test_only, "test_only packs must be hidden when include_test=false (D9)")
	var all_ips: Array[DataModels.IPInfo] = DataLoader.list_ips(true)
	var found_test := false
	for info in all_ips:
		if info.id == "test_pack":
			found_test = true
	assert_true(found_test)


func test_walk_jump_and_pushbox_never_overlap() -> void:
	var s: SimState = _ready_fight_state()
	# Jump and land with P1
	CombatSim.step(s, PackedInt64Array([InputBits.UP, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[0].state_name, "JUMP")
	assert_lt(s.fighters[0].pos_y, 0)
	for _i in range(60):
		CombatSim.step(s, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[0].pos_y, 0)
	assert_eq(s.fighters[0].state_name, "IDLE")

	# Walk both toward each other for 120 ticks -> pushboxes must never overlap
	for _i in range(120):
		CombatSim.step(s, PackedInt64Array([InputBits.RIGHT, InputBits.LEFT]), [b_a, b_b], cfg)
		var p0: PackedInt64Array = HitResolver.get_world_pushbox(s.fighters[0], b_a)
		var p1: PackedInt64Array = HitResolver.get_world_pushbox(s.fighters[1], b_b)
		assert_false(FixedMath.rects_overlap(p0, p1))


func test_light_attack_hitstop_and_single_hit_registration() -> void:
	var s: SimState = _ready_fight_state()
	s.fighters[0].pos_x = -35000
	s.fighters[1].pos_x = 35000

	# Trigger light_01 (startup=6, active=2 on ticks 6..7, hitstop=6, damage=30)
	CombatSim.step(s, PackedInt64Array([InputBits.LIGHT, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[0].state_name, "ATTACKING")
	assert_eq(s.fighters[0].current_move_id, "light_01")

	# Step 5 more ticks to reach state_tick == 6 (first active frame)
	for _i in range(5):
		CombatSim.step(s, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[1].hp, 1000, "not hit yet during startup 0..5")

	# Next step evaluates state_tick == 6 -> HIT!
	CombatSim.step(s, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[1].hp, 970, "took 30 damage once")
	assert_eq(s.fighters[1].state_name, "HITSTUN")
	# Step 6 of that tick decremented hitstop from 6 -> 5 while freezing state_tick at 6!
	assert_eq(s.fighters[0].hitstop_ticks, 5)
	assert_eq(s.fighters[0].state_tick, 6)
	assert_eq(s.fighters[0].anim_tick, 6)

	# Step through remaining hitstop + remainder of move -> must NOT hit a second time on frame 7!
	for _i in range(25):
		CombatSim.step(s, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[1].hp, 970, "hit registry prevented duplicate hit on 2nd active frame")


func test_blocking_prevents_damage_and_applies_blockstun() -> void:
	var s: SimState = _ready_fight_state()
	s.fighters[0].pos_x = -35000
	s.fighters[1].pos_x = 35000

	CombatSim.step(s, PackedInt64Array([InputBits.LIGHT, InputBits.BLOCK]), [b_a, b_b], cfg)
	for _i in range(10):
		CombatSim.step(s, PackedInt64Array([0, InputBits.BLOCK]), [b_a, b_b], cfg)
	assert_eq(s.fighters[1].hp, 1000, "blocked normal deals 0 damage")
	assert_eq(s.fighters[1].state_name, "BLOCKSTUN")


func test_cancel_light_into_heavy_with_damage_scaling() -> void:
	var s: SimState = _ready_fight_state()
	s.fighters[0].pos_x = -26000
	s.fighters[1].pos_x = 26000

	CombatSim.step(s, PackedInt64Array([InputBits.LIGHT, 0]), [b_a, b_b], cfg)
	# Advance until hit lands and hitstop finishes
	for _i in range(12):
		CombatSim.step(s, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[1].hp, 970)
	assert_eq(s.fighters[0].state_tick, 7, "inside cancel window [6, 12]")

	# Cancel into heavy_01 (base damage 80 -> 2nd hit scaled to 90% = 72; total damage 30 + 72 = 102 -> HP 898)
	CombatSim.step(s, PackedInt64Array([InputBits.HEAVY, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[0].current_move_id, "heavy_01")
	for _i in range(30):
		CombatSim.step(s, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[1].hp, 898, "2-hit combo applied 90% scaling on 2nd hit")
	assert_eq(s.fighters[1].combo_count, 2)


func test_mutual_hit_priority_and_equal_trade() -> void:
	# Equal priority (light_01 priority 1 vs light_01 priority 1) -> Trade!
	var s: SimState = _ready_fight_state()
	s.fighters[0].pos_x = -35000
	s.fighters[1].pos_x = 35000
	CombatSim.step(s, PackedInt64Array([InputBits.LIGHT, InputBits.LIGHT]), [b_a, b_b], cfg)
	for _i in range(6):
		CombatSim.step(s, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[0].hp, 970, "P1 took trade damage")
	assert_eq(s.fighters[1].hp, 970, "P2 took trade damage")

	# Higher priority wins cleanly: heavy_01 (priority 2, startup 12) vs light_01 (priority 1, startup 6)
	var s2: SimState = _ready_fight_state()
	s2.fighters[0].pos_x = -38000
	s2.fighters[1].pos_x = 38000
	CombatSim.step(s2, PackedInt64Array([InputBits.HEAVY, 0]), [b_a, b_b], cfg)
	for _i in range(5):
		CombatSim.step(s2, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	# Trigger P2 light_01 6 ticks later so both reach active frame on the exact same tick!
	CombatSim.step(s2, PackedInt64Array([0, InputBits.LIGHT]), [b_a, b_b], cfg)
	for _i in range(6):
		CombatSim.step(s2, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	assert_eq(s2.fighters[0].hp, 1000, "higher priority heavy_01 beat light_01 cleanly")
	assert_eq(s2.fighters[1].hp, 920, "defender took full 80 damage from heavy_01")


func test_corner_pushback_transfers_to_attacker() -> void:
	var s: SimState = _ready_fight_state()
	s.fighters[1].pos_x = cfg.stage_half_width
	s.fighters[0].pos_x = cfg.stage_half_width - 60000
	var atk_initial_x: int = s.fighters[0].pos_x

	CombatSim.step(s, PackedInt64Array([InputBits.HEAVY, 0]), [b_a, b_b], cfg)
	for _i in range(13):
		CombatSim.step(s, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[1].pos_x, cfg.stage_half_width, "defender stays inside right stage wall")
	assert_lt(s.fighters[0].pos_x, atk_initial_x, "corner pushback pushed melee attacker left")


func test_projectile_skill_spawn_and_hit() -> void:
	var s: SimState = _ready_fight_state()
	# Put dummy_b in slot 1 at range and fire skill_01
	CombatSim.step(s, PackedInt64Array([0, InputBits.SKILL_1]), [b_a, b_b], cfg)
	assert_eq(s.fighters[1].state_name, "SKILL")
	for _i in range(70):
		CombatSim.step(s, PackedInt64Array([0, 0]), [b_a, b_b], cfg)
	assert_eq(s.fighters[0].hp, 960, "dummy_b projectile dealt 40 damage to P1")
