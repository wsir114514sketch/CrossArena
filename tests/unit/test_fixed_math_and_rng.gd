extends GutTest
## Unit tests for FixedMath (Decisions D4, D13), SimRng, InputBits, and FrameMapper.
## Zero Doubles / Stubs used.


func test_div_trunc_vs_div_floor() -> void:
	assert_eq(FixedMath.div_trunc(7, 2), 3)
	assert_eq(FixedMath.div_trunc(-7, 2), -3)
	assert_eq(FixedMath.div_floor(7, 2), 3)
	assert_eq(FixedMath.div_floor(-7, 2), -4)

	# Uniform 1000-unit pixel buckets across 0 (Decision D13)
	assert_eq(FixedMath.units_to_px(-1001), -2)
	assert_eq(FixedMath.units_to_px(-1000), -1)
	assert_eq(FixedMath.units_to_px(-1), -1)
	assert_eq(FixedMath.units_to_px(0), 0)
	assert_eq(FixedMath.units_to_px(999), 0)
	assert_eq(FixedMath.units_to_px(1000), 1)


func test_mirror_rect_left_and_right() -> void:
	# Local hitbox [20000, -130000, 60000, 40000] -> spans x: [20000, 80000] facing right
	var local := PackedInt64Array([20000, -130000, 60000, 40000])
	var r_right: PackedInt64Array = FixedMath.mirror_rect(100000, 0, 1, local)
	assert_eq(r_right, PackedInt64Array([120000, -130000, 60000, 40000]))

	# Facing left at x=100000 -> must span [20000, 80000], i.e. x' = 100000 - 20000 - 60000 = 20000
	var r_left: PackedInt64Array = FixedMath.mirror_rect(100000, 0, -1, local)
	assert_eq(r_left, PackedInt64Array([20000, -130000, 60000, 40000]))


func test_rects_overlap_strict_inequality() -> void:
	var a := PackedInt64Array([0, 0, 50000, 50000])
	var flush := PackedInt64Array([50000, 0, 50000, 50000])
	var overlap_1 := PackedInt64Array([49999, 0, 50000, 50000])
	assert_false(FixedMath.rects_overlap(a, flush), "flush edges must NOT overlap (D4)")
	assert_true(FixedMath.rects_overlap(a, overlap_1), "1-unit overlap must be detected")


func test_sim_rng_determinism() -> void:
	var s1: int = 123456789
	var s2: int = 123456789
	for _i in range(50):
		var p1: PackedInt64Array = SimRng.next_bounded(s1, 10000)
		var p2: PackedInt64Array = SimRng.next_bounded(s2, 10000)
		assert_eq(p1, p2)
		s1 = p1[0]
		s2 = p2[0]


func test_input_bits_socd_neutral() -> void:
	var both_lr: int = InputBits.LEFT | InputBits.RIGHT | InputBits.LIGHT
	assert_eq(InputBits.sanitize(both_lr), InputBits.LIGHT)
	var both_ud: int = InputBits.UP | InputBits.DOWN | InputBits.HEAVY
	assert_eq(InputBits.sanitize(both_ud), InputBits.HEAVY)


func test_frame_mapper_loop_and_clamp() -> void:
	# 4 frames @ 30 fps -> 2 sim ticks per frame
	assert_eq(FrameMapper.compute_display_frame(0, 30, 4, false), 0)
	assert_eq(FrameMapper.compute_display_frame(1, 30, 4, false), 0)
	assert_eq(FrameMapper.compute_display_frame(2, 30, 4, false), 1)
	assert_eq(FrameMapper.compute_display_frame(9, 30, 4, false), 3, "non-loop clamps to last frame")
	assert_eq(FrameMapper.compute_display_frame(8, 30, 4, true), 0, "loop wraps modulo frame_count")
	assert_eq(FrameMapper.compute_display_frame(10, 30, 4, true), 1)
