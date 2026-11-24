class_name NetSession
extends RefCounted
## Phase 6 Online Rollback Multiplayer interface reservation (spec part 3 sections 10 & 12).
## Only input masks and frame checksums cross the network; world positions are never synced.

enum SessionPhase {
	DISCONNECTED = 0,
	ROOM_LOBBY = 1,
	FIGHTER_SELECT = 2,
	IN_MATCH = 3,
	RESULT = 4,
}


func get_phase() -> int:
	return SessionPhase.DISCONNECTED


func submit_local_input(_tick: int, _player_slot: int, _input_mask: int) -> void:
	pass


func poll_synchronized_inputs(_tick: int) -> PackedInt64Array:
	return PackedInt64Array([0, 0])


func report_frame_checksum(_tick: int, _checksum: int) -> void:
	pass
