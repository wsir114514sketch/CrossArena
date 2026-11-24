class_name FixedMath
extends RefCounted
## Integer / fixed-point helpers for the 60 Hz deterministic simulation (Decisions D4, D13).
## Units: 1 pixel = 1000 simulation units; +X right, +Y down (ground_y = 0, airborne y < 0).

const UNITS_PER_PX: int = 1000
const SIM_HZ: int = 60


@warning_ignore("integer_division")
static func div_trunc(a: int, b: int) -> int:
	assert(b != 0, "FixedMath.div_trunc: division by zero")
	return a / b


@warning_ignore("integer_division")
static func div_floor(a: int, b: int) -> int:
	assert(b > 0, "FixedMath.div_floor: divisor must be > 0")
	return (a - posmod(a, b)) / b


static func units_to_px(units: int) -> int:
	return div_floor(units, UNITS_PER_PX)


static func mirror_rect(pos_x: int, pos_y: int, facing: int, local_rect: PackedInt64Array) -> PackedInt64Array:
	## Decision D4: facing >= 0 -> [pos_x + x, pos_y + y, w, h];
	## facing < 0 -> [pos_x - x - w, pos_y + y, w, h].
	var lx: int = local_rect[0]
	var ly: int = local_rect[1]
	var lw: int = local_rect[2]
	var lh: int = local_rect[3]
	var wx: int = (pos_x + lx) if facing >= 0 else (pos_x - lx - lw)
	var wy: int = pos_y + ly
	return PackedInt64Array([wx, wy, lw, lh])


static func rects_overlap(a: PackedInt64Array, b: PackedInt64Array) -> bool:
	## Decision D4: strict inequality (<) so flush edges (a.x + a.w == b.x) do not overlap.
	return (
		a[0] < b[0] + b[2]
		and b[0] < a[0] + a[2]
		and a[1] < b[1] + b[3]
		and b[1] < a[1] + a[3]
	)


static func clamp_int(val: int, lo: int, hi: int) -> int:
	if val < lo:
		return lo
	if val > hi:
		return hi
	return val
