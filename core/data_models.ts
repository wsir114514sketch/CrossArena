/**
 * Data-driven schema interfaces matching docs/data_schema.md and asset_pipeline/validate.py.
 * Zero IP or character identifiers are hardcoded in engine types.
 */

import type { IntRect } from "./fixed_math";

export type GuardType = "mid" | "low" | "overhead" | "unblockable" | "throw";
export type SkillType =
  | "melee"
  | "projectile"
  | "area"
  | "dash"
  | "control"
  | "guard"
  | "invuln"
  | "multi_hit"
  | "ultimate"
  | "awaken";

export interface IPThemeStyle {
  primary_hex: string;
  secondary_hex: string;
  accent_hex: string;
  stage_sky_top?: string;
  stage_sky_bottom?: string;
  stage_floor_hex?: string;
  emblem_label?: string;
}

export interface IPDefinition {
  id: string;
  name_zh: string;
  name_en: string;
  cover: string;
  description: string;
  featured_characters: string[];
  status: "open" | "locked";
  test_only?: boolean;
  theme?: IPThemeStyle;
  stage_name_zh?: string;
}

export interface FighterStats {
  max_hp: number;
  walk_speed: number;
  jump_velocity: number;
  gravity: number;
  defense: number;
  max_gauge?: number;
  gauge_gain_on_hurt_pct?: number;
  gauge_gain_on_block_pct?: number;
  dash_speed?: number;
  dash_ticks?: number;
  backdash_speed?: number;
  backdash_ticks?: number;
}

export interface AIProfile {
  aggression?: number;
  anti_air?: number;
  defense?: number;
  zoning?: number;
  combo_focus?: number;
  meter_usage?: number;
  assist_usage?: number;
}

export interface ResourceMetadata {
  origin_repo: string;
  origin_pack?: string;
  completeness: "complete" | "partial" | "placeholder" | "missing" | "pending_adapt";
  authorization_status: "authorized" | "internal_placeholder" | "pending_authorization";
  sprite_scale?: number;
}

export interface FighterDefinition {
  id: string;
  ip_id: string;
  name_zh: string;
  name_en: string;
  portrait: string;
  splash: string;
  stats: FighterStats;
  height_scale: number;
  hurtboxes: string;
  skills: string[];
  unsupported_core_moves: string[];
  base_character_id?: string;
  forms?: string[];
  form_name_zh?: string;
  form_name_en?: string;
  resource_metadata?: ResourceMetadata;
  ai_profile?: AIProfile;
  bio?: string;
  victory_quote_zh?: string;
}

export interface PresentationEvent {
  frame: number;
  type: "sfx" | "vfx" | "voice" | "camera_shake" | "flash";
  id?: string;
}

export interface AnimationDefinition {
  animation_id: string;
  character_id: string;
  animation_type: "core" | "combat" | "skill" | "presentation" | "extra";
  source_frames: string;
  source_frames_left?: string;
  frame_count: number;
  animation_fps: number;
  loop: boolean;
  facing_mode: "flip" | "dual";
  canvas_size: [number, number];
  pivot: [number, number];
  ground_anchor: [number, number];
  presentation_events?: PresentationEvent[];
}

export interface SpriteAtlasFrame {
  frame: number;
  rect: [number, number, number, number];
  crop_offset: [number, number];
}

export interface SpriteSheetAtlas {
  animation_id: string;
  sheet: string;
  frames: SpriteAtlasFrame[];
}

export interface HitSpec {
  damage: number;
  knockback: [number, number];
  hitstun: number;
  blockstun: number;
  hitstop: number;
  block_hitstop?: number;
  air_hit: boolean;
  priority: number;
  guard_type?: GuardType;
  knockdown?: boolean;
  guard_break?: boolean;
  chip_damage?: number;
  meter_gain_on_hit?: number;
  meter_gain_on_block?: number;
}

export interface HitboxDef extends HitSpec {
  frames: [number, number];
  rect: IntRect;
  hit_index?: number;
}

export interface CancelWindow {
  frames: [number, number];
  into: string[];
}

export interface MoveVelocityWindow {
  frames: [number, number];
  vel: [number, number];
}

export interface HurtboxOverrideWindow {
  frames: [number, number];
  rects: IntRect[];
}

export interface ProjectileSpawnSpec {
  frame: number;
  offset: [number, number];
  rect: IntRect;
  hit: HitSpec;
}

export interface SuperFreezeSpec {
  frame: number;
  duration: number;
}

export interface FrameData {
  move_id: string;
  animation_id: string;
  startup: number;
  active: number;
  recovery: number;
  hitboxes?: HitboxDef[];
  cancel_windows?: CancelWindow[];
  invuln_frames?: [number, number][];
  armor_frames?: [number, number][];
  hurtbox_override?: HurtboxOverrideWindow[];
  projectile_spawn?: ProjectileSpawnSpec[];
  super_freeze?: SuperFreezeSpec;
  move_velocity?: MoveVelocityWindow[];
  meter_gain_on_whiff?: number;
}

export interface HurtboxProfile {
  stand: IntRect[];
  crouch: IntRect[];
  air: IntRect[];
  down: IntRect[];
  pushbox: {
    stand: IntRect;
    crouch: IntRect;
    air: IntRect;
    down: IntRect;
  };
}

export interface ProjectileSkillConfig {
  effect: string;
  speed: number;
  lifetime: number;
  velocity_y?: number;
  projectile_gravity?: number;
}

export interface SkillDefinition {
  skill_id: string;
  type: SkillType;
  input: string;
  cost: number;
  cooldown: number;
  move_id: string;
  name_zh?: string;
  name_en?: string;
  description_zh?: string;
  target_form_id?: string;
  awaken_duration_ticks?: number;
  projectile?: ProjectileSkillConfig;
}

export interface AssistDefinition {
  id: string;
  ip_id: string;
  name_zh: string;
  name_en: string;
  portrait: string;
  cooldown_ticks: number;
  spawn_offset: [number, number];
  move_id: string;
  skill_name_zh?: string;
  description_zh?: string;
  projectile?: ProjectileSkillConfig;
}

export interface RosterManifestEntry {
  id: string;
  original_id: string;
  name_zh: string;
  name_en: string;
  ip_id: string;
  category: "playable" | "form" | "awakening_form" | "assist";
  base_character_id?: string;
  source_repo: string;
  has_xfl_source: boolean;
  implemented_in_engine: boolean;
  completeness: "complete" | "partial" | "placeholder" | "missing" | "pending_adapt";
  authorization_status: "authorized" | "internal_placeholder" | "pending_authorization";
  notes?: string;
}

export interface RosterManifest {
  ip_id: string;
  entries: RosterManifestEntry[];
}

export interface CombatConfig {
  stage_half_width: number;
  corner_pushback_permille: number;
  input_buffer_frames: number;
  motion_input_window_frames: number;
  juggle_max_hits: number;
  same_move_combo_limit: number;
  damage_scaling_pct: number[];
  min_damage_scaling_pct: number;
  round_time_seconds: number;
  rounds_to_win: number;
  intro_ticks: number;
  ko_ticks: number;
  round_end_ticks: number;
  p1_start_x: number;
  p2_start_x: number;
  default_gauge_cap?: number;
  gauge_per_stock?: number;
  guard_gauge_max?: number;
  guard_regen_per_tick?: number;
  guard_break_stun_ticks?: number;
  throw_range_x?: number;
  throw_tech_window_frames?: number;
  assist_cooldown_default_ticks?: number;
}

export interface StateRule {
  airborne: boolean;
  locks_facing: boolean;
  can_walk: boolean;
  can_crouch: boolean;
  can_jump: boolean;
  can_dash: boolean;
  can_block: boolean;
  can_normal_attack: boolean;
  can_skill: boolean;
  can_throw: boolean;
  can_assist?: boolean;
  invulnerable: boolean;
}

export interface StateTransitionsTable {
  states: Record<string, StateRule>;
}

/** Fully loaded runtime bundle for one playable character or form. */
export interface FighterBundle {
  ip: IPDefinition;
  fighter: FighterDefinition;
  charDirUrl: string;
  hurtbox: HurtboxProfile;
  animations: Record<string, AnimationDefinition>;
  spriteAtlases: Record<string, SpriteSheetAtlas>;
  framedata: Record<string, FrameData>;
  skills: SkillDefinition[];
}

/** Fully loaded runtime bundle for one assist character. */
export interface AssistBundle {
  ip: IPDefinition;
  assist: AssistDefinition;
  assistDirUrl: string;
  animation: AnimationDefinition;
  spriteAtlas?: SpriteSheetAtlas;
  framedata: FrameData;
}

/** Grouped character family for Layer 2 & Layer 3 of Character Select. */
export interface CharacterGroup {
  baseId: string;
  baseBundle: FighterBundle;
  forms: FighterBundle[]; // index 0 is baseBundle, followed by unlocked/selectable forms
}

export interface ContentRegistry {
  combatConfig: CombatConfig;
  stateTransitions: StateTransitionsTable;
  ips: IPDefinition[];
  fightersById: Record<string, FighterBundle>;
  assistsById: Record<string, AssistBundle>;
  groupsByIp: Record<string, CharacterGroup[]>;
  assistsByIp: Record<string, AssistBundle[]>;
  manifestsByIp: Record<string, RosterManifest>;
}
