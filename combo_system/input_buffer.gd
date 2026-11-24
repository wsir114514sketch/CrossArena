class_name InputBuffer
extends RefCounted
## Deterministic per-player button input buffer (spec part 3 section 6).
## Newly pressed action buttons remain buffered for `buffer_frames` simulation ticks.


static func update_fighter_input(f: SimState.FighterSimState, raw_mask: int, buffer_frames: int) -> void:
	var clean: int = InputBits.sanitize(raw_mask)
	var just_pressed: int = clean & (~f.current_input) & InputBits.ACTION_BUTTONS
	f.prev_input = f.current_input
	f.current_input = clean

	# Decrement existing buffered entries and keep those still > 0
	var next_buf: Array[PackedInt64Array] = []
	for entry in f.buffered_buttons:
		var rem: int = entry[1] - 1
		if rem > 0:
			next_buf.append(PackedInt64Array([entry[0], rem]))
	f.buffered_buttons = next_buf

	# Enqueue newly pressed buttons in deterministic bit order
	if just_pressed != 0:
		var ttl: int = maxi(1, buffer_frames)
		for bit_shift in range(4, 12):
			var bit: int = 1 << bit_shift
			if (just_pressed & bit) != 0:
				_set_or_refresh(f, bit, ttl)


static func has_buffered(f: SimState.FighterSimState, button_bit: int) -> bool:
	for entry in f.buffered_buttons:
		if entry[0] == button_bit and entry[1] > 0:
			return true
	return false


static func consume_buffered(f: SimState.FighterSimState, button_bit: int) -> bool:
	for i in range(f.buffered_buttons.size()):
		if f.buffered_buttons[i][0] == button_bit:
			f.buffered_buttons.remove_at(i)
			return true
	return false


static func clear_all(f: SimState.FighterSimState) -> void:
	f.buffered_buttons.clear()


static func _set_or_refresh(f: SimState.FighterSimState, button_bit: int, ttl: int) -> void:
	for i in range(f.buffered_buttons.size()):
		if f.buffered_buttons[i][0] == button_bit:
			f.buffered_buttons[i][1] = ttl
			return
	f.buffered_buttons.append(PackedInt64Array([button_bit, ttl]))
