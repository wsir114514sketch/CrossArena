class_name FrameMapper
extends RefCounted
## Pure integer mapping from 60 Hz simulation anim_tick to animation frame index (spec part 3 section 9).
## display_frame = (anim_tick * animation_fps) / 60  (integer division, truncated toward zero for anim_tick >= 0).


static func compute_display_frame(anim_tick: int, animation_fps: int, frame_count: int, loop: bool) -> int:
	if frame_count <= 1 or anim_tick <= 0:
		return 0
	var raw_idx: int = FixedMath.div_trunc(anim_tick * animation_fps, FixedMath.SIM_HZ)
	if loop:
		return posmod(raw_idx, frame_count)
	return mini(raw_idx, frame_count - 1)
