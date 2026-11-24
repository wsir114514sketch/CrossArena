extends GutTest
## Phase 0 smoke test: GUT 9.7.1 runs on Godot 4.7.2, and records the integer
## semantics the deterministic simulation relies on (spec part 3 section 2).


func test_int_division_truncates_toward_zero() -> void:
	# GDScript int division truncates toward zero (C semantics), NOT floor.
	# Simulation code must use explicit helpers when floor division is wanted.
	assert_eq(7 / 2, 3)
	assert_eq(-7 / 2, -3)


func test_posmod_is_non_negative() -> void:
	assert_eq(-7 % 2, -1, "% keeps the dividend's sign")
	assert_eq(posmod(-7, 2), 1, "posmod is always >= 0")


func test_int_is_64_bit() -> void:
	var big: int = 1 << 62
	assert_gt(big, 0)
	assert_eq(big * 2, -9223372036854775808, "overflow wraps (two's complement)")


func test_frame_mapping_formula() -> void:
	# display_frame = (anim_tick * animation_fps) / 60   (spec part 3 section 9)
	var fps := 30
	var frames: Array[int] = []
	for tick in range(6):
		frames.append((tick * fps) / 60)
	assert_eq(frames, [0, 0, 1, 1, 2, 2] as Array[int])
