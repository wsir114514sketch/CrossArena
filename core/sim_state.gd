class_name SimState
extends RefCounted
## Pure deterministic simulation state (spec part 3 section 2).
## Zero Node references, zero float fields, ordered arrays only.
## Supports lightweight save_state(), load_state(), clone(), and 64-bit checksum().

enum RoundPhase {
	INTRO = 0,
	FIGHT = 1,
	KO = 2,
	ROUND_END = 3,
	MATCH_END = 4,
}

const FNV_OFFSET: int = -3750763034362895579 # 0xCBF29CE484222325 signed 64-bit
const FNV_PRIME: int = 1099511628211         # 0x00000100000001B3


class FighterSimState extends RefCounted:
	var slot: int = 0
	var pos_x: int = 0
	var pos_y: int = 0
	var vel_x: int = 0
	var vel_y: int = 0
	var facing: int = 1 # +1 right, -1 left
	var hp: int = 1000
	var max_hp: int = 1000
	var gauge: int = 0
	var max_gauge: int = 1000

	var state_name: String = "IDLE"
	var state_tick: int = 0
	var anim_id: String = "idle"
	var anim_tick: int = 0
	var current_move_id: String = ""
	var move_instance_id: int = 0

	var hitstop_ticks: int = 0
	var stun_ticks: int = 0
	var combo_count: int = 0
	var juggle_count: int = 0
	var landing_ticks: int = 0

	var prev_input: int = 0
	var current_input: int = 0
	# Ordered [button_bit, remaining_buffer_ticks] pairs
	var buffered_buttons: Array[PackedInt64Array] = []
	# Ordered [skill_index, remaining_cooldown_ticks] pairs
	var skill_cooldowns: PackedInt64Array = PackedInt64Array()
	# Ordered [move_id_index, count_in_current_combo]
	var combo_move_counts: PackedInt64Array = PackedInt64Array()

	func to_dict() -> Dictionary:
		var buf_copy: Array[PackedInt64Array] = []
		for item in buffered_buttons:
			buf_copy.append(PackedInt64Array([item[0], item[1]]))
		return {
			"slot": slot,
			"pos_x": pos_x,
			"pos_y": pos_y,
			"vel_x": vel_x,
			"vel_y": vel_y,
			"facing": facing,
			"hp": hp,
			"max_hp": max_hp,
			"gauge": gauge,
			"max_gauge": max_gauge,
			"state_name": state_name,
			"state_tick": state_tick,
			"anim_id": anim_id,
			"anim_tick": anim_tick,
			"current_move_id": current_move_id,
			"move_instance_id": move_instance_id,
			"hitstop_ticks": hitstop_ticks,
			"stun_ticks": stun_ticks,
			"combo_count": combo_count,
			"juggle_count": juggle_count,
			"landing_ticks": landing_ticks,
			"prev_input": prev_input,
			"current_input": current_input,
			"buffered_buttons": buf_copy,
			"skill_cooldowns": skill_cooldowns.duplicate(),
			"combo_move_counts": combo_move_counts.duplicate(),
		}

	func from_dict(d: Dictionary) -> void:
		slot = int(d["slot"])
		pos_x = int(d["pos_x"])
		pos_y = int(d["pos_y"])
		vel_x = int(d["vel_x"])
		vel_y = int(d["vel_y"])
		facing = int(d["facing"])
		hp = int(d["hp"])
		max_hp = int(d["max_hp"])
		gauge = int(d["gauge"])
		max_gauge = int(d["max_gauge"])
		state_name = String(d["state_name"])
		state_tick = int(d["state_tick"])
		anim_id = String(d["anim_id"])
		anim_tick = int(d["anim_tick"])
		current_move_id = String(d["current_move_id"])
		move_instance_id = int(d["move_instance_id"])
		hitstop_ticks = int(d["hitstop_ticks"])
		stun_ticks = int(d["stun_ticks"])
		combo_count = int(d["combo_count"])
		juggle_count = int(d["juggle_count"])
		landing_ticks = int(d["landing_ticks"])
		prev_input = int(d["prev_input"])
		current_input = int(d["current_input"])
		buffered_buttons.clear()
		for item in d["buffered_buttons"]:
			var p: PackedInt64Array = item as PackedInt64Array
			buffered_buttons.append(PackedInt64Array([p[0], p[1]]))
		skill_cooldowns = (d["skill_cooldowns"] as PackedInt64Array).duplicate()
		combo_move_counts = (d["combo_move_counts"] as PackedInt64Array).duplicate()


class ProjectileSimState extends RefCounted:
	var entity_id: int = 0
	var owner_slot: int = 0
	var facing: int = 1
	var pos_x: int = 0
	var pos_y: int = 0
	var vel_x: int = 0
	var vel_y: int = 0
	var gravity: int = 0
	var remaining_ticks: int = 0
	var effect_path: String = ""
	var rect: PackedInt64Array = PackedInt64Array([0, 0, 1, 1])
	var damage: int = 0
	var knockback_x: int = 0
	var knockback_y: int = 0
	var hitstun: int = 0
	var blockstun: int = 0
	var hitstop: int = 0
	var block_hitstop: int = 0
	var air_hit: bool = true
	var priority: int = 1
	var meter_gain_on_hit: int = 20
	var meter_gain_on_block: int = 10
	var active: bool = true

	func to_dict() -> Dictionary:
		return {
			"entity_id": entity_id,
			"owner_slot": owner_slot,
			"facing": facing,
			"pos_x": pos_x,
			"pos_y": pos_y,
			"vel_x": vel_x,
			"vel_y": vel_y,
			"gravity": gravity,
			"remaining_ticks": remaining_ticks,
			"effect_path": effect_path,
			"rect": rect.duplicate(),
			"damage": damage,
			"knockback_x": knockback_x,
			"knockback_y": knockback_y,
			"hitstun": hitstun,
			"blockstun": blockstun,
			"hitstop": hitstop,
			"block_hitstop": block_hitstop,
			"air_hit": air_hit,
			"priority": priority,
			"meter_gain_on_hit": meter_gain_on_hit,
			"meter_gain_on_block": meter_gain_on_block,
			"active": active,
		}

	static func create_from_dict(d: Dictionary) -> ProjectileSimState:
		var p := ProjectileSimState.new()
		p.entity_id = int(d["entity_id"])
		p.owner_slot = int(d["owner_slot"])
		p.facing = int(d["facing"])
		p.pos_x = int(d["pos_x"])
		p.pos_y = int(d["pos_y"])
		p.vel_x = int(d["vel_x"])
		p.vel_y = int(d["vel_y"])
		p.gravity = int(d["gravity"])
		p.remaining_ticks = int(d["remaining_ticks"])
		p.effect_path = String(d["effect_path"])
		p.rect = (d["rect"] as PackedInt64Array).duplicate()
		p.damage = int(d["damage"])
		p.knockback_x = int(d["knockback_x"])
		p.knockback_y = int(d["knockback_y"])
		p.hitstun = int(d["hitstun"])
		p.blockstun = int(d["blockstun"])
		p.hitstop = int(d["hitstop"])
		p.block_hitstop = int(d["block_hitstop"])
		p.air_hit = bool(d["air_hit"])
		p.priority = int(d["priority"])
		p.meter_gain_on_hit = int(d["meter_gain_on_hit"])
		p.meter_gain_on_block = int(d["meter_gain_on_block"])
		p.active = bool(d["active"])
		return p


var tick: int = 0
var rng_state: int = 1
var round_phase: int = RoundPhase.INTRO
var phase_timer: int = 60
var round_number: int = 1
var round_timer_ticks: int = 99 * 60
var rounds_won: PackedInt64Array = PackedInt64Array([0, 0])
var round_winner: int = -1 # -1 none, 0 P1, 1 P2, 2 draw
var match_winner: int = -1 # -1 none, 0 P1, 1 P2, 2 draw
var super_freeze_ticks: int = 0
var next_entity_id: int = 1
var next_event_seq: int = 1

var fighters: Array[FighterSimState] = [FighterSimState.new(), FighterSimState.new()]
var projectiles: Array[ProjectileSimState] = []
# Ordered [source_kind (0=fighter,1=proj), source_id, move_instance_id, hit_index, target_slot]
var hit_registry: Array[PackedInt64Array] = []
# Presentation-only event queue emitted during step(); never affects simulation logic.
var events: Array[Dictionary] = []


func push_event(ev_type: String, slot: int, ev_id: String, wx: int = 0, wy: int = 0, val: int = 0) -> void:
	events.append({
		"tick": tick,
		"seq": next_event_seq,
		"type": ev_type,
		"slot": slot,
		"id": ev_id,
		"x": wx,
		"y": wy,
		"value": val,
	})
	next_event_seq += 1


func save_state() -> Dictionary:
	var projs: Array[Dictionary] = []
	for p in projectiles:
		projs.append(p.to_dict())
	var hreg: Array[PackedInt64Array] = []
	for h in hit_registry:
		hreg.append(h.duplicate())
	return {
		"tick": tick,
		"rng_state": rng_state,
		"round_phase": round_phase,
		"phase_timer": phase_timer,
		"round_number": round_number,
		"round_timer_ticks": round_timer_ticks,
		"rounds_won": rounds_won.duplicate(),
		"round_winner": round_winner,
		"match_winner": match_winner,
		"super_freeze_ticks": super_freeze_ticks,
		"next_entity_id": next_entity_id,
		"next_event_seq": next_event_seq,
		"fighters": [fighters[0].to_dict(), fighters[1].to_dict()],
		"projectiles": projs,
		"hit_registry": hreg,
	}


func load_state(snap: Dictionary) -> void:
	tick = int(snap["tick"])
	rng_state = int(snap["rng_state"])
	round_phase = int(snap["round_phase"])
	phase_timer = int(snap["phase_timer"])
	round_number = int(snap["round_number"])
	round_timer_ticks = int(snap["round_timer_ticks"])
	rounds_won = (snap["rounds_won"] as PackedInt64Array).duplicate()
	round_winner = int(snap["round_winner"])
	match_winner = int(snap["match_winner"])
	super_freeze_ticks = int(snap["super_freeze_ticks"])
	next_entity_id = int(snap["next_entity_id"])
	next_event_seq = int(snap["next_event_seq"])
	var farr: Array = snap["fighters"] as Array
	fighters[0].from_dict(farr[0] as Dictionary)
	fighters[1].from_dict(farr[1] as Dictionary)
	projectiles.clear()
	for pd in snap["projectiles"]:
		projectiles.append(ProjectileSimState.create_from_dict(pd as Dictionary))
	hit_registry.clear()
	for hr in snap["hit_registry"]:
		hit_registry.append((hr as PackedInt64Array).duplicate())
	events.clear()


func clone() -> SimState:
	var copy := SimState.new()
	copy.load_state(save_state())
	return copy


func compute_checksum() -> int:
	## Deterministic 64-bit FNV-1a hash over every authoritative simulation field in fixed order.
	var h: int = FNV_OFFSET
	h = _hash_int(h, tick)
	h = _hash_int(h, rng_state)
	h = _hash_int(h, round_phase)
	h = _hash_int(h, phase_timer)
	h = _hash_int(h, round_number)
	h = _hash_int(h, round_timer_ticks)
	h = _hash_int(h, rounds_won[0])
	h = _hash_int(h, rounds_won[1])
	h = _hash_int(h, round_winner)
	h = _hash_int(h, match_winner)
	h = _hash_int(h, super_freeze_ticks)
	h = _hash_int(h, next_entity_id)

	for i in range(2):
		var f: FighterSimState = fighters[i]
		h = _hash_int(h, f.slot)
		h = _hash_int(h, f.pos_x)
		h = _hash_int(h, f.pos_y)
		h = _hash_int(h, f.vel_x)
		h = _hash_int(h, f.vel_y)
		h = _hash_int(h, f.facing)
		h = _hash_int(h, f.hp)
		h = _hash_int(h, f.gauge)
		h = _hash_str(h, f.state_name)
		h = _hash_int(h, f.state_tick)
		h = _hash_str(h, f.anim_id)
		h = _hash_int(h, f.anim_tick)
		h = _hash_str(h, f.current_move_id)
		h = _hash_int(h, f.move_instance_id)
		h = _hash_int(h, f.hitstop_ticks)
		h = _hash_int(h, f.stun_ticks)
		h = _hash_int(h, f.combo_count)
		h = _hash_int(h, f.juggle_count)
		h = _hash_int(h, f.landing_ticks)
		h = _hash_int(h, f.prev_input)
		h = _hash_int(h, f.current_input)
		h = _hash_int(h, f.buffered_buttons.size())
		for bb in f.buffered_buttons:
			h = _hash_int(h, bb[0])
			h = _hash_int(h, bb[1])
		for cd in f.skill_cooldowns:
			h = _hash_int(h, cd)
		for mc in f.combo_move_counts:
			h = _hash_int(h, mc)

	h = _hash_int(h, projectiles.size())
	for p in projectiles:
		h = _hash_int(h, p.entity_id)
		h = _hash_int(h, p.owner_slot)
		h = _hash_int(h, p.facing)
		h = _hash_int(h, p.pos_x)
		h = _hash_int(h, p.pos_y)
		h = _hash_int(h, p.vel_x)
		h = _hash_int(h, p.vel_y)
		h = _hash_int(h, p.remaining_ticks)
		h = _hash_int(h, 1 if p.active else 0)

	h = _hash_int(h, hit_registry.size())
	for hr in hit_registry:
		for v in hr:
			h = _hash_int(h, v)
	return h


static func _hash_int(h: int, val: int) -> int:
	var acc: int = h
	for shift in range(0, 64, 8):
		var byte_val: int = (val >> shift) & 0xFF
		acc = (acc ^ byte_val) * FNV_PRIME
	return acc


static func _hash_str(h: int, s: String) -> int:
	var acc: int = _hash_int(h, s.length())
	var utf8: PackedByteArray = s.to_utf8_buffer()
	for b in utf8:
		acc = (acc ^ int(b)) * FNV_PRIME
	return acc
