class_name InputBits
extends RefCounted
## Per-frame per-player integer bitmask (spec part 3 section 6).
## Keyboard, gamepad, touch, AI, and future netcode all produce this single bitmask.

const NONE: int = 0
const UP: int = 1 << 0
const DOWN: int = 1 << 1
const LEFT: int = 1 << 2
const RIGHT: int = 1 << 3

const LIGHT: int = 1 << 4
const MEDIUM: int = 1 << 5
const HEAVY: int = 1 << 6
const SKILL_1: int = 1 << 7
const ULTIMATE: int = 1 << 8
const BLOCK: int = 1 << 9
const DASH: int = 1 << 10
const THROW: int = 1 << 11

const DIR_MASK: int = UP | DOWN | LEFT | RIGHT
const ACTION_BUTTONS: int = LIGHT | MEDIUM | HEAVY | SKILL_1 | ULTIMATE | DASH | THROW


static func sanitize(raw_mask: int) -> int:
	## Simultaneous Left + Right resolves to neutral; simultaneous Up + Down resolves to neutral.
	var m: int = raw_mask
	if (m & LEFT) != 0 and (m & RIGHT) != 0:
		m &= ~(LEFT | RIGHT)
	if (m & UP) != 0 and (m & DOWN) != 0:
		m &= ~(UP | DOWN)
	return m


static func horizontal_sign(mask: int) -> int:
	var m: int = sanitize(mask)
	if (m & RIGHT) != 0:
		return 1
	if (m & LEFT) != 0:
		return -1
	return 0


static func is_holding_back(mask: int, facing: int) -> bool:
	var hx: int = horizontal_sign(mask)
	return (facing >= 0 and hx < 0) or (facing < 0 and hx > 0)


static func is_holding_forward(mask: int, facing: int) -> bool:
	var hx: int = horizontal_sign(mask)
	return (facing >= 0 and hx > 0) or (facing < 0 and hx < 0)
