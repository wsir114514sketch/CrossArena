/**
 * Data-driven Skill, Ultimate, Super-Freeze, Awakening Transformation, and Compact Assist Executor.
 *
 * Implements:
 * - Multi-slot signature skills (`skill_01`, `skill_02`, `skill_03`), ultimates (`skill_ultimate`),
 *   and in-match Awakening transformations (`type === "awaken"` -> swaps `activeFighterId` to `target_form_id`).
 * - Super Freeze dramatic pause (`super_freeze: { frame, duration }`).
 * - Projectile spawning & per-tick physics.
 * - Compact-stage Assist summoning (`INPUT_ASSIST`, 720-tick cooldown, blocked during hitstun/knockdown,
 *   zero body pushbox collision, independent Hitbox resolution).
 */

import { canCancelCurrentMove } from "../combo_system/combo_rules";
import { bufferedButtonPress, isSkillInputTriggered } from "../combo_system/input_buffer";
import type {
  AssistBundle,
  ContentRegistry,
  FighterBundle,
  FrameData,
  SkillDefinition,
} from "../core/data_models";
import { clampInt, divTrunc, toWorldRect } from "../core/fixed_math";
import { INPUT_ASSIST } from "../core/input_bits";
import type { FighterSimState, SimState } from "../core/sim_state";
import { applyStrikeOutcome, getWorldHurtboxes } from "../hit_system/hit_resolver";

/** Try to activate an Awakening, Ultimate, or Special Skill from neutral or cancel window. */
export function tryExecuteFighterSkill(
  state: SimState,
  f: FighterSimState,
  bundle: FighterBundle,
  registry: ContentRegistry,
): boolean {
  const cfg = registry.combatConfig;
  const stateRule = registry.stateTransitions.states[f.state];
  const currentFd: FrameData | undefined = f.currentMoveId ? bundle.framedata[f.currentMoveId] : undefined;

  // Evaluate priority order: Awaken -> Ultimate -> Skill 3 -> Skill 2 -> Skill 1
  const orderedSkills = [...bundle.skills].sort((a, b) => skillPriority(b) - skillPriority(a));

  for (const sk of orderedSkills) {
    const cd = f.skillCooldowns[sk.skill_id] ?? 0;
    if (cd > 0 || f.gauge < sk.cost) {
      continue;
    }
    if (sk.type === "awaken") {
      if (!sk.target_form_id || !registry.fightersById[sk.target_form_id]) {
        continue;
      }
      if (f.activeFighterId === sk.target_form_id || f.posY < 0) {
        continue;
      }
    }

    const cat: "skill" | "ultimate" | "awaken" =
      sk.type === "awaken" ? "awaken" : sk.type === "ultimate" ? "ultimate" : "skill";

    const allowedFromState = stateRule?.can_skill ?? false;
    const allowedViaCancel =
      (f.state === "ATTACKING" || f.state === "SKILL") &&
      canCancelCurrentMove(f, currentFd, sk.move_id, cat);

    if (!allowedFromState && !allowedViaCancel) {
      continue;
    }

    if (
      !isSkillInputTriggered(
        f,
        sk.input,
        cfg.input_buffer_frames,
        cfg.motion_input_window_frames,
      )
    ) {
      continue;
    }

    // Activate skill!
    f.gauge = Math.max(0, f.gauge - sk.cost);
    if (sk.cooldown > 0) {
      f.skillCooldowns[sk.skill_id] = sk.cooldown;
    }

    const nextState =
      sk.type === "awaken" ? "AWAKENING" : sk.type === "ultimate" ? "ULTIMATE" : "SKILL";
    const wasCancel = allowedViaCancel;

    startMoveOnFighter(f, bundle, nextState, sk.move_id);

    if (wasCancel) {
      state.events.push({
        tick: state.tick,
        type: "callout",
        slot: f.slot,
        x: f.posX,
        y: f.posY - 125000,
        text: sk.type === "ultimate" ? "SUPER CANCEL!" : "SKILL CANCEL!",
      });
    }

    if (sk.type === "awaken" && sk.target_form_id) {
      // Perform Awakening Form Transformation while preserving HP percentage!
      const nextBundle = registry.fightersById[sk.target_form_id]!;
      const hpPermille = divTrunc(f.hp * 1000, Math.max(1, f.maxHp));
      f.activeFighterId = sk.target_form_id;
      f.maxHp = nextBundle.fighter.stats.max_hp;
      f.hp = Math.max(1, divTrunc(f.maxHp * hpPermille, 1000));
      f.maxGauge = nextBundle.fighter.stats.max_gauge ?? (cfg.default_gauge_cap ?? 3000);
      f.awakenTicksRemaining =
        sk.awaken_duration_ticks && sk.awaken_duration_ticks > 0
          ? sk.awaken_duration_ticks
          : -1;
      state.superFreezeTicks = Math.max(state.superFreezeTicks, 24);
      state.superFreezeOwner = f.slot;
      state.events.push({
        tick: state.tick,
        type: "awaken",
        slot: f.slot,
        x: f.posX,
        y: f.posY - 90000,
        text: sk.name_zh ?? "AWAKENING!",
      });
    } else {
      state.events.push({
        tick: state.tick,
        type: "swing",
        slot: f.slot,
        x: f.posX,
        y: f.posY - 80000,
        text: sk.type === "ultimate" ? (sk.name_zh ?? "ULTIMATE!") : undefined,
      });
    }

    return true;
  }

  return false;
}

function skillPriority(sk: SkillDefinition): number {
  if (sk.type === "awaken") return 40;
  if (sk.type === "ultimate") return 30;
  if (sk.skill_id.includes("03")) return 22;
  if (sk.skill_id.includes("02")) return 21;
  return 20;
}

/** Initialize a move (`light_01`, `skill_01`, `throw`, etc.) on `f`. */
export function startMoveOnFighter(
  f: FighterSimState,
  bundle: FighterBundle,
  targetState: FighterSimState["state"],
  moveId: string,
): void {
  f.state = targetState;
  f.stateTick = 0;
  f.currentMoveId = moveId;
  f.moveTick = 0;
  f.moveInstanceId += 1;
  f.hitIndicesRegistered = [];
  f.spawnedProjectileIndices = [];
  f.velX = 0;

  const fd = bundle.framedata[moveId];
  if (fd) {
    f.lastMoveStartup = fd.startup;
    f.lastMoveActive = fd.active;
    f.lastMoveRecovery = fd.recovery;
    if (fd.meter_gain_on_whiff && fd.meter_gain_on_whiff > 0) {
      f.gauge = Math.min(f.maxGauge, f.gauge + fd.meter_gain_on_whiff);
    }
  }
}

/** Check and trigger Assist Summon (`INPUT_ASSIST`) if legal on compact stage. */
export function trySummonAssist(
  state: SimState,
  f: FighterSimState,
  registry: ContentRegistry,
): void {
  if (!f.assistId) return;
  const assistBundle = registry.assistsById[f.assistId];
  if (!assistBundle) return;

  const assistState = state.assists[f.slot];
  if (assistState.active || f.assistCooldownTicks > 0) {
    return;
  }

  const rule = registry.stateTransitions.states[f.state];
  if (rule && rule.can_assist === false) {
    return;
  }

  if (!bufferedButtonPress(f, INPUT_ASSIST, registry.combatConfig.input_buffer_frames)) {
    return;
  }

  const halfW = registry.combatConfig.stage_half_width - 50000;
  const [ox, oy] = assistBundle.assist.spawn_offset;
  assistState.assistId = assistBundle.assist.id;
  assistState.active = true;
  assistState.facing = f.facing;
  assistState.posX = clampInt(f.posX + f.facing * ox, -halfW, halfW);
  assistState.posY = Math.min(0, f.posY + oy);
  assistState.moveTick = 0;
  assistState.totalTicks =
    assistBundle.framedata.startup +
    assistBundle.framedata.active +
    assistBundle.framedata.recovery;
  assistState.hitConfirmedIndices = [];

  f.assistCooldownTicks =
    assistBundle.assist.cooldown_ticks ||
    (registry.combatConfig.assist_cooldown_default_ticks ?? 720);

  state.events.push({
    tick: state.tick,
    type: "assist_call",
    slot: f.slot,
    x: assistState.posX,
    y: assistState.posY - 90000,
    text: assistBundle.assist.skill_name_zh ?? assistBundle.assist.name_zh,
  });
}

/** Advance active Assist entities (zero body pushbox, compact hitbox check). */
export function stepAssists(state: SimState, registry: ContentRegistry): void {
  const cfg = registry.combatConfig;
  for (const slot of [0, 1] as const) {
    const aState = state.assists[slot];
    if (!aState.active) continue;
    const ab: AssistBundle | undefined = registry.assistsById[aState.assistId];
    if (!ab) {
      aState.active = false;
      continue;
    }

    const fd = ab.framedata;
    // Apply optional move_velocity on assist
    if (fd.move_velocity) {
      for (const mv of fd.move_velocity) {
        if (aState.moveTick >= mv.frames[0] && aState.moveTick <= mv.frames[1]) {
          aState.posX = clampInt(
            aState.posX + aState.facing * mv.vel[0],
            -cfg.stage_half_width + 30000,
            cfg.stage_half_width - 30000,
          );
          aState.posY = Math.min(0, aState.posY + mv.vel[1]);
        }
      }
    }

    // Spawn assist projectile if configured
    if (fd.projectile_spawn && ab.assist.projectile) {
      for (let i = 0; i < fd.projectile_spawn.length; i++) {
        const ps = fd.projectile_spawn[i]!;
        if (aState.moveTick === ps.frame) {
          state.projectiles.push({
            id: state.nextEntityId++,
            ownerSlot: slot,
            effectPath: ab.assist.projectile.effect,
            ipId: ab.ip.id,
            posX: aState.posX + aState.facing * ps.offset[0],
            posY: aState.posY + ps.offset[1],
            velX: aState.facing * ab.assist.projectile.speed,
            velY: ab.assist.projectile.velocity_y ?? 0,
            gravity: ab.assist.projectile.projectile_gravity ?? 0,
            facing: aState.facing,
            rect: ps.rect,
            hit: ps.hit,
            remainingTicks: ab.assist.projectile.lifetime,
            active: true,
          });
        }
      }
    }

    // Check assist hitboxes against opponent
    const oppSlot: 0 | 1 = slot === 0 ? 1 : 0;
    const owner = state.fighters[slot];
    const opp = state.fighters[oppSlot];
    const ownerBundle = registry.fightersById[owner.activeFighterId]!;
    const oppBundle = registry.fightersById[opp.activeFighterId]!;
    const oppFd = opp.currentMoveId ? oppBundle.framedata[opp.currentMoveId] : undefined;
    const oppHurtboxes = getWorldHurtboxes(opp, oppBundle.hurtbox, oppFd);

    if (fd.hitboxes && oppHurtboxes.length > 0) {
      for (const hb of fd.hitboxes) {
        const hIdx = hb.hit_index ?? 0;
        if (aState.hitConfirmedIndices.includes(hIdx)) continue;
        if (aState.moveTick < hb.frames[0] || aState.moveTick > hb.frames[1]) continue;
        const wRect = toWorldRect(hb.rect, aState.posX, aState.posY, aState.facing);
        if (oppHurtboxes.some((uh) => rectsOverlapInline(wRect, uh))) {
          aState.hitConfirmedIndices.push(hIdx);
          applyStrikeOutcome(
            state,
            {
              attackerSlot: slot,
              defenderSlot: oppSlot,
              moveId: `assist_${ab.assist.id}`,
              hitIndex: hIdx,
              spec: hb,
              contactX: divTrunc(wRect[0] * 2 + wRect[2], 2),
              contactY: divTrunc(wRect[1] * 2 + wRect[3], 2),
              fromProjectile: false,
              fromAssist: true,
            },
            ownerBundle,
            oppBundle,
            cfg,
          );
        }
      }
    }

    aState.moveTick += 1;
    if (aState.moveTick >= aState.totalTicks) {
      aState.active = false;
    }
  }
}

/** Spawn & step active projectiles across compact stage. */
export function stepProjectiles(state: SimState, registry: ContentRegistry): void {
  const cfg = registry.combatConfig;
  const maxStage = cfg.stage_half_width + 140000;

  // Projectile vs Projectile clashing
  for (let i = 0; i < state.projectiles.length; i++) {
    const pA = state.projectiles[i]!;
    if (!pA.active) continue;
    for (let j = i + 1; j < state.projectiles.length; j++) {
      const pB = state.projectiles[j]!;
      if (!pB.active || pA.ownerSlot === pB.ownerSlot) continue;
      const rA = toWorldRect(pA.rect, pA.posX, pA.posY, pA.facing);
      const rB = toWorldRect(pB.rect, pB.posX, pB.posY, pB.facing);
      if (rectsOverlapInline(rA, rB)) {
        if (pA.hit.priority >= pB.hit.priority) pB.active = false;
        if (pB.hit.priority >= pA.hit.priority) pA.active = false;
      }
    }
  }

  for (const p of state.projectiles) {
    if (!p.active) continue;
    p.posX += p.velX;
    p.posY += p.velY;
    p.velY += p.gravity;
    p.remainingTicks -= 1;

    if (p.remainingTicks <= 0 || Math.abs(p.posX) > maxStage || p.posY > 20000) {
      p.active = false;
      continue;
    }

    const oppSlot: 0 | 1 = p.ownerSlot === 0 ? 1 : 0;
    const owner = state.fighters[p.ownerSlot];
    const opp = state.fighters[oppSlot];
    const ownerBundle = registry.fightersById[owner.activeFighterId]!;
    const oppBundle = registry.fightersById[opp.activeFighterId]!;
    const oppFd = opp.currentMoveId ? oppBundle.framedata[opp.currentMoveId] : undefined;
    const oppHurt = getWorldHurtboxes(opp, oppBundle.hurtbox, oppFd);
    const wRect = toWorldRect(p.rect, p.posX, p.posY, p.facing);

    if (oppHurt.some((uh) => rectsOverlapInline(wRect, uh))) {
      p.active = false;
      applyStrikeOutcome(
        state,
        {
          attackerSlot: p.ownerSlot,
          defenderSlot: oppSlot,
          moveId: `proj_${p.effectPath}`,
          hitIndex: 0,
          spec: p.hit,
          contactX: p.posX,
          contactY: p.posY,
          fromProjectile: true,
          fromAssist: false,
        },
        ownerBundle,
        oppBundle,
        cfg,
      );
    }
  }

  if (state.projectiles.length > 0) {
    state.projectiles = state.projectiles.filter((p) => p.active);
  }
}

function rectsOverlapInline(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean {
  return (
    a[0] < b[0] + b[2] &&
    b[0] < a[0] + a[2] &&
    a[1] < b[1] + b[3] &&
    b[1] < a[1] + a[3]
  );
}
