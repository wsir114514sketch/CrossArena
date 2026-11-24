class_name InputCollector
extends RefCounted
## Adapter layer: samples local keyboard/gamepad input into the integer InputBits mask.
## P1: W/A/S/D + J (Light), K (Heavy), U (Skill), L (Block)
## P2: Arrow Keys + Numpad 1/2/4/3 (or M / , / . / / on compact keyboards)


static func poll_player_keyboard(slot: int) -> int:
	var m: int = 0
	if slot == 0:
		if Input.is_physical_key_pressed(KEY_W):
			m |= InputBits.UP
		if Input.is_physical_key_pressed(KEY_S):
			m |= InputBits.DOWN
		if Input.is_physical_key_pressed(KEY_A):
			m |= InputBits.LEFT
		if Input.is_physical_key_pressed(KEY_D):
			m |= InputBits.RIGHT
		if Input.is_physical_key_pressed(KEY_J):
			m |= InputBits.LIGHT
		if Input.is_physical_key_pressed(KEY_K):
			m |= InputBits.HEAVY
		if Input.is_physical_key_pressed(KEY_U):
			m |= InputBits.SKILL_1
		if Input.is_physical_key_pressed(KEY_I):
			m |= InputBits.ULTIMATE
		if Input.is_physical_key_pressed(KEY_L):
			m |= InputBits.BLOCK
	else:
		if Input.is_physical_key_pressed(KEY_UP):
			m |= InputBits.UP
		if Input.is_physical_key_pressed(KEY_DOWN):
			m |= InputBits.DOWN
		if Input.is_physical_key_pressed(KEY_LEFT):
			m |= InputBits.LEFT
		if Input.is_physical_key_pressed(KEY_RIGHT):
			m |= InputBits.RIGHT
		if Input.is_physical_key_pressed(KEY_KP_1) or Input.is_physical_key_pressed(KEY_M):
			m |= InputBits.LIGHT
		if Input.is_physical_key_pressed(KEY_KP_2) or Input.is_physical_key_pressed(KEY_COMMA):
			m |= InputBits.HEAVY
		if Input.is_physical_key_pressed(KEY_KP_4) or Input.is_physical_key_pressed(KEY_PERIOD):
			m |= InputBits.SKILL_1
		if Input.is_physical_key_pressed(KEY_KP_5):
			m |= InputBits.ULTIMATE
		if Input.is_physical_key_pressed(KEY_KP_3) or Input.is_physical_key_pressed(KEY_SLASH):
			m |= InputBits.BLOCK
	return InputBits.sanitize(m)
