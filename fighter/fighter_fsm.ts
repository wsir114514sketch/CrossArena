/**
 * Deterministic 60Hz Fighter Finite State Machine (`fighter_fsm.ts`).
 *
 * Implements KOF / Street Fighter compact arcade mechanics:
 * - Auto-facing on neutral ground states (locks facing during attacks, jumps, dashes, hitstun).
 * - Walk Forward / Backward, Forward Dash (`DASH`), Invulnerable Backdash (`BACKDASH`),
 *   Crouch (`CROUCH`), Neutral / Forward / Backward Jump (`JUMP`), Stand / Crouch Guard (`STAND_BLOCK` / `CROUCH_BLOCK`).
 * - Standing & Crouching Normals (`light_01` -> `light_02` -> `medium_01` -> `heavy_01`, crouch low kick/sweep via `2+light` / `2+heavy`, air normal `air_attack`, proximity `throw`).
 * - Move root velocity (`move_velocity`), active `projectile_spawn`, `super_freeze` triggers,
 *   Knockdown -> Wakeup invulnerability, and Timed Awakening expiration.
 */

import { canCancelCurrentMove, resetComboTracking } from "../combo_system/combo_rules";
import {
  bufferedButtonPress,
  detectDashCommand,
  isThrowInputTriggered,
} from "../combo_system/input_buffer";
import type { ContentRegistry, FighterBundle, FrameData } from "../core/data_models";
import { clampInt, divTrunc, toWorldRect } from "../core/fixed_math";
import {
  INPUT_BLOCK,
  INPUT_HEAVY,
  INPUT_LIGHT,
  INPUT_MEDIUM,
  sanitizeSocd,
  toNumpadDirection,
} from "../core/input_bits";
import type { FighterSimState, SimState } from "../core/sim_state";
import type { PendingStrike } from "../hit_system/hit_resolver";
import {
  startMoveOnFighter,
  tryExecuteFighterSkill,
  trySummonAssist,
} from "../skill_system/skill_executor";

export function updateFighterAutoFacing(f: FighterSimState, opp: FighterSimState, registry: ContentRegistry): void {
  const rule = registry.stateTransitions.states[f.state];
  if (rule && rule.locks_facing) {
    return;
  }
  if (f.posY < 0) {
    return;
  }
  if (opp.posX > f.posX) {
    f.facing = 1;
  } else if (opp.posX < f.posX) {
    f.facing = -1;
  }
}

export function stepFighterStateAndIntent(
  state: SimState,
  f: FighterSimState,
  opp: FighterSimState,
  registry: ContentRegistry,
): void {
  const cfg = registry.combatConfig;
  let bundle: FighterBundle = registry.fightersById[f.activeFighterId]!;

  // Tick down cooldowns & guard regen
  for (const skId of Object.keys(f.skillCooldowns)) {
    const cur = f.skillCooldowns[skId]!;
    if (cur > 0) {
      f.skillCooldowns[skId] = cur - 1;
    }
  }
  if (f.assistCooldownTicks > 0) {
    f.assistCooldownTicks -= 1;
  }
  if (f.invulnTicks > 0) {
    f.invulnTicks -= 1;
  }
  if (
    f.state !== "BLOCKSTUN" &&
    f.state !== "STAND_BLOCK" &&
    f.state !== "CROUCH_BLOCK" &&
    f.state !== "GUARD_BREAK"
  ) {
    f.guardGauge = Math.min(f.maxGuardGauge, f.guardGauge + (cfg.guard_regen_per_tick ?? 2));
  }

  // Timed awakening countdown (reverts cleanly to baseFighterId when neutral on ground)
  if (f.awakenTicksRemaining > 0) {
    f.awakenTicksRemaining -= 1;
    if (
      f.awakenTicksRemaining === 0 &&
      f.activeFighterId !== f.baseFighterId &&
      (f.state === "IDLE" || f.state === "WALK_FORWARD" || f.state === "WALK_BACKWARD" || f.state === "CROUCH")
    ) {
      const baseBundle = registry.fightersById[f.baseFighterId]!;
      const hpPermille = divTrunc(f.hp * 1000, Math.max(1, f.maxHp));
      f.activeFighterId = f.baseFighterId;
      f.maxHp = baseBundle.fighter.stats.max_hp;
      f.hp = Math.max(1, divTrunc(f.maxHp * hpPermille, 1000));
      bundle = baseBundle;
    } else if (f.awakenTicksRemaining === 0) {
      f.awakenTicksRemaining = 1; // defer revert until neutral
    }
  }

  // Hitstop freezes fighter's local state & physics
  if (f.hitstopTicks > 0) {
    f.hitstopTicks -= 1;
    return;
  }

  if (state.phase !== "FIGHT") {
    stepNonFightState(f, bundle);
    return;
  }

  // Summon Assist if available & legal
  trySummonAssist(state, f, registry);

  // Handle Stun / Knockdown / Wakeup / Dead states first
  if (f.state === "DEAD") {
    applyAirGravityAndFloor(f, bundle, cfg.stage_half_width);
    f.stateTick += 1;
    return;
  }

  if (f.state === "HITSTUN" || f.state === "BLOCKSTUN" || f.state === "GUARD_BREAK") {
    f.stunTicks -= 1;
    f.stateTick += 1;
    if (f.stunTicks <= 0) {
      f.state = "IDLE";
      f.stateTick = 0;
      resetComboTracking(f);
    }
    return;
  }

  if (f.state === "AIR_HITSTUN") {
    f.stunTicks -= 1;
    f.stateTick += 1;
    applyAirGravityAndFloor(f, bundle, cfg.stage_half_width);
    if (f.posY >= 0) {
      f.posY = 0;
      f.velX = 0;
      f.velY = 0;
      f.state = "KNOCKDOWN";
      f.stateTick = 0;
      f.stunTicks = 24;
    }
    return;
  }

  if (f.state === "KNOCKDOWN") {
    f.stunTicks -= 1;
    f.stateTick += 1;
    if (f.stunTicks <= 0) {
      f.state = "WAKEUP";
      f.stateTick = 0;
      f.invulnTicks = 12;
      resetComboTracking(f);
    }
    return;
  }

  if (f.state === "WAKEUP") {
    f.stateTick += 1;
    const wakeupLen = bundle.animations["wakeup"]
      ? Math.min(18, bundle.animations["wakeup"].frame_count * 2)
      : 12;
    if (f.stateTick >= wakeupLen) {
      f.state = "IDLE";
      f.stateTick = 0;
    }
    return;
  }

  updateFighterAutoFacing(f, opp, registry);

  // 1. Check Awaken / Ultimate / Special Skills (including Cancel Windows!)
  if (tryExecuteFighterSkill(state, f, bundle, registry)) {
    bundle = registry.fightersById[f.activeFighterId]!;
    stepActiveMoveTick(state, f, bundle, cfg.stage_half_width);
    return;
  }

  // 2. Check Normal Attacks & Throws (from Neutral or Normal Cancel Chain)
  if (tryExecuteNormalOrThrow(state, f, opp, bundle, registry)) {
    stepActiveMoveTick(state, f, bundle, cfg.stage_half_width);
    return;
  }

  // 3. Advance ongoing Attack / Skill / Ultimate / Awakening / Throw
  if (
    f.state === "ATTACKING" ||
    f.state === "SKILL" ||
    f.state === "ULTIMATE" ||
    f.state === "AWAKENING" ||
    f.state === "THROWING"
  ) {
    stepActiveMoveTick(state, f, bundle, cfg.stage_half_width);
    return;
  }

  // 4. Advance Dash / Backdash
  if (f.state === "DASH" || f.state === "BACKDASH") {
    const dashSpeed =
      f.state === "DASH"
        ? (bundle.fighter.stats.dash_speed ?? bundle.fighter.stats.walk_speed * 2 + 2500)
        : -(bundle.fighter.stats.backdash_speed ?? bundle.fighter.stats.walk_speed * 2 + 1500);
    const maxTicks =
      f.state === "DASH"
        ? (bundle.fighter.stats.dash_ticks ?? 14)
        : (bundle.fighter.stats.backdash_ticks ?? 14);
    f.posX = clampInt(
      f.posX + f.facing * dashSpeed,
      -cfg.stage_half_width + 36000,
      cfg.stage_half_width - 36000,
    );
    f.stateTick += 1;
    // Allow jump-cancel out of forward dash (KOF run-jump momentum!)
    if (f.state === "DASH") {
      const latest = latestInput(f);
      const dir = toNumpadDirection(latest, f.facing);
      if (dir === 7 || dir === 8 || dir === 9) {
        initiateJump(f, bundle, dir, true);
        return;
      }
    }
    if (f.stateTick >= maxTicks) {
      f.state = "IDLE";
      f.stateTick = 0;
      f.velX = 0;
    }
    return;
  }

  // 5. Airborne Jump Physics
  if (f.state === "JUMP" || f.posY < 0) {
    applyAirGravityAndFloor(f, bundle, cfg.stage_half_width);
    f.stateTick += 1;
    if (f.posY >= 0) {
      f.posY = 0;
      f.velX = 0;
      f.velY = 0;
      f.state = "IDLE";
      f.stateTick = 0;
    }
    return;
  }

  // 6. Ground Neutral Movement, Blocking, Crouch, Dash, Jump
  const mask = latestInput(f);
  const dir = toNumpadDirection(mask, f.facing);

  // Dash / Backdash command
  const dashCmd = detectDashCommand(f, 12);
  if (dashCmd === "forward" && !bundle.fighter.unsupported_core_moves.includes("dash")) {
    f.state = "DASH";
    f.stateTick = 0;
    return;
  }
  if (dashCmd === "backward") {
    f.state = "BACKDASH";
    f.stateTick = 0;
    f.invulnTicks = 8;
    return;
  }

  // Jump (7 = back jump, 8 = neutral jump, 9 = forward jump)
  if (dir === 7 || dir === 8 || dir === 9) {
    initiateJump(f, bundle, dir, false);
    return;
  }

  // Explicit Block button or Back-Block when opponent is attacking / projectile active
  const oppThreat =
    opp.state === "ATTACKING" ||
    opp.state === "SKILL" ||
    opp.state === "ULTIMATE" ||
    state.projectiles.some((p) => p.active && p.ownerSlot !== f.slot);

  if ((mask & INPUT_BLOCK) !== 0) {
    const nextBlock = dir === 1 || dir === 2 || dir === 3 ? "CROUCH_BLOCK" : "STAND_BLOCK";
    setGroundPosture(f, nextBlock);
    return;
  }

  if (dir === 1 && oppThreat) {
    setGroundPosture(f, "CROUCH_BLOCK");
    return;
  }
  if (dir === 4 && oppThreat) {
    setGroundPosture(f, "STAND_BLOCK");
    return;
  }

  if (dir === 1 || dir === 2 || dir === 3) {
    setGroundPosture(f, "CROUCH");
    return;
  }

  if (dir === 6) {
    setGroundPosture(f, "WALK_FORWARD");
    f.posX = clampInt(
      f.posX + f.facing * bundle.fighter.stats.walk_speed,
      -cfg.stage_half_width + 36000,
      cfg.stage_half_width - 36000,
    );
    return;
  }

  if (dir === 4) {
    setGroundPosture(f, "WALK_BACKWARD");
    f.posX = clampInt(
      f.posX - f.facing * divTrunc(bundle.fighter.stats.walk_speed * 82, 100),
      -cfg.stage_half_width + 36000,
      cfg.stage_half_width - 36000,
    );
    return;
  }

  setGroundPosture(f, "IDLE");
}

function setGroundPosture(f: FighterSimState, target: FighterSimState["state"]): void {
  if (f.state !== target) {
    f.state = target;
    f.stateTick = 0;
  } else {
    f.stateTick += 1;
  }
  f.velX = 0;
  f.velY = 0;
}

function initiateJump(
  f: FighterSimState,
  bundle: FighterBundle,
  dir: 7 | 8 | 9,
  dashMomentum: boolean,
): void {
  f.state = "JUMP";
  f.stateTick = 0;
  f.currentMoveId = null;
  f.velY = -bundle.fighter.stats.jump_velocity;
  const baseHoriz = dashMomentum
    ? divTrunc(bundle.fighter.stats.walk_speed * 145, 100)
    : bundle.fighter.stats.walk_speed;
  if (dir === 9) {
    f.velX = f.facing * baseHoriz;
  } else if (dir === 7) {
    f.velX = -f.facing * baseHoriz;
  } else {
    f.velX = 0;
  }
  // Apply initial vertical lift so fighter leaves ground immediately on jump start
  f.posY += f.velY;
  f.posX += f.velX;
}

function applyAirGravityAndFloor(f: FighterSimState, bundle: FighterBundle, stageHalfWidth: number): void {
  f.posX = clampInt(f.posX + f.velX, -stageHalfWidth + 36000, stageHalfWidth - 36000);
  f.posY += f.velY;
  f.velY += bundle.fighter.stats.gravity;
  if (f.posY > 0) {
    f.posY = 0;
  }
}

function tryExecuteNormalOrThrow(
  state: SimState,
  f: FighterSimState,
  opp: FighterSimState,
  bundle: FighterBundle,
  registry: ContentRegistry,
): boolean {
  const cfg = registry.combatConfig;
  const buf = cfg.input_buffer_frames;
  const rule = registry.stateTransitions.states[f.state];
  const currentFd = f.currentMoveId ? bundle.framedata[f.currentMoveId] : undefined;
  const airborne = f.posY < 0 || f.state === "JUMP";

  // Proximity Throw (`INPUT_THROW` or L+M)
  if (!airborne && (rule?.can_throw ?? false) && bundle.framedata["throw"]) {
    if (isThrowInputTriggered(f, buf)) {
      const dist = Math.abs(f.posX - opp.posX);
      const range = cfg.throw_range_x ?? 82000;
      startMoveOnFighter(f, bundle, "THROWING", "throw");
      if (dist > range + 25000) {
        // Whiff throw animation plays out cleanly
      }
      state.events.push({
        tick: state.tick,
        type: "swing",
        slot: f.slot,
        x: f.posX,
        y: f.posY - 80000,
      });
      return true;
    }
  }

  // Air Normal (`air_attack`)
  if (airborne) {
    if (
      (rule?.can_normal_attack ?? false) &&
      f.currentMoveId === null &&
      bundle.framedata["air_attack"] &&
      bufferedButtonPress(f, INPUT_LIGHT | INPUT_MEDIUM | INPUT_HEAVY, buf)
    ) {
      f.currentMoveId = "air_attack";
      f.moveTick = 0;
      f.moveInstanceId += 1;
      f.hitIndicesRegistered = [];
      state.events.push({
        tick: state.tick,
        type: "swing",
        slot: f.slot,
        x: f.posX,
        y: f.posY - 70000,
      });
      return true;
    }
    return false;
  }

  const mask = latestInput(f);
  const dir = toNumpadDirection(mask, f.facing);
  const crouching = dir === 1 || dir === 2 || dir === 3 || f.state === "CROUCH";

  // Candidate normals ordered heaviest -> lightest for clean cancel chaining
  const candidates: Array<{ btn: number; moveIds: string[] }> = [
    {
      btn: INPUT_HEAVY,
      moveIds: crouching
        ? ["crouch_heavy", "heavy_01"]
        : dir === 6
          ? ["overhead_01", "heavy_01"]
          : ["heavy_01"],
    },
    {
      btn: INPUT_MEDIUM,
      moveIds: crouching ? ["crouch_light", "medium_01", "light_02", "heavy_01"] : ["medium_01", "light_02", "heavy_01"],
    },
    {
      btn: INPUT_LIGHT,
      moveIds:
        f.state === "ATTACKING" && f.currentMoveId === "light_01" && bundle.framedata["light_02"]
          ? ["light_02", "medium_01"]
          : crouching
            ? ["crouch_light", "light_01"]
            : ["light_01"],
    },
  ];

  for (const cand of candidates) {
    if (!bufferedButtonPress(f, cand.btn, buf)) {
      continue;
    }
    const chosenMove = cand.moveIds.find((m) => Boolean(bundle.framedata[m]));
    if (!chosenMove) continue;

    const canStartNeutral = rule?.can_normal_attack ?? false;
    const canChain =
      f.state === "ATTACKING" &&
      f.currentMoveId !== chosenMove &&
      canCancelCurrentMove(f, currentFd, chosenMove, "normal");

    if (!canStartNeutral && !canChain) {
      continue;
    }

    startMoveOnFighter(f, bundle, "ATTACKING", chosenMove);
    if (canChain) {
      // Micro-step forward on chain cancel so pushback doesn't drop Light -> Medium -> Heavy strings
      f.posX = clampInt(
        f.posX + f.facing * 22000,
        -cfg.stage_half_width + 36000,
        cfg.stage_half_width - 36000,
      );
    }
    state.events.push({
      tick: state.tick,
      type: "swing",
      slot: f.slot,
      x: f.posX,
      y: f.posY - 80000,
    });
    return true;
  }

  return false;
}

function stepActiveMoveTick(
  state: SimState,
  f: FighterSimState,
  bundle: FighterBundle,
  stageHalfWidth: number,
): void {
  const moveId = f.currentMoveId;
  if (!moveId) {
    f.state = f.posY < 0 ? "JUMP" : "IDLE";
    f.stateTick = 0;
    return;
  }
  const fd: FrameData | undefined = bundle.framedata[moveId];
  if (!fd) {
    f.currentMoveId = null;
    f.state = f.posY < 0 ? "JUMP" : "IDLE";
    f.stateTick = 0;
    return;
  }

  // Trigger Super Freeze on exact frame
  if (fd.super_freeze && f.moveTick === fd.super_freeze.frame) {
    state.superFreezeTicks = Math.max(state.superFreezeTicks, fd.super_freeze.duration);
    state.superFreezeOwner = f.slot;
    state.events.push({
      tick: state.tick,
      type: "super_freeze",
      slot: f.slot,
      x: f.posX,
      y: f.posY - 95000,
    });
  }

  // Apply root motion velocity if defined
  if (fd.move_velocity) {
    for (const mv of fd.move_velocity) {
      if (f.moveTick >= mv.frames[0] && f.moveTick <= mv.frames[1]) {
        f.posX = clampInt(
          f.posX + f.facing * mv.vel[0],
          -stageHalfWidth + 36000,
          stageHalfWidth - 36000,
        );
        f.posY = Math.min(0, f.posY + mv.vel[1]);
      }
    }
  }

  // Spawn projectiles at configured moveTick
  if (fd.projectile_spawn) {
    const matchingSkill = bundle.skills.find((s) => s.move_id === moveId && s.projectile);
    if (matchingSkill && matchingSkill.projectile) {
      for (let i = 0; i < fd.projectile_spawn.length; i++) {
        if (f.spawnedProjectileIndices.includes(i)) continue;
        const ps = fd.projectile_spawn[i]!;
        if (f.moveTick === ps.frame) {
          f.spawnedProjectileIndices.push(i);
          state.projectiles.push({
            id: state.nextEntityId++,
            ownerSlot: f.slot,
            effectPath: matchingSkill.projectile.effect,
            ipId: bundle.ip.id,
            posX: f.posX + f.facing * ps.offset[0],
            posY: f.posY + ps.offset[1],
            velX: f.facing * matchingSkill.projectile.speed,
            velY: matchingSkill.projectile.velocity_y ?? 0,
            gravity: matchingSkill.projectile.projectile_gravity ?? 0,
            facing: f.facing,
            rect: ps.rect,
            hit: ps.hit,
            remainingTicks: matchingSkill.projectile.lifetime,
            active: true,
          });
        }
      }
    }
  }

  // Airborne attacks continue falling under gravity
  if (f.posY < 0 || f.state === "JUMP") {
    applyAirGravityAndFloor(f, bundle, stageHalfWidth);
    if (f.posY >= 0) {
      f.posY = 0;
      f.velX = 0;
      f.velY = 0;
      f.currentMoveId = null;
      f.state = "IDLE";
      f.stateTick = 0;
      return;
    }
  }

  f.moveTick += 1;
  f.stateTick += 1;

  const total = fd.startup + fd.active + fd.recovery;
  if (f.moveTick >= total) {
    f.currentMoveId = null;
    f.state = f.posY < 0 ? "JUMP" : "IDLE";
    f.stateTick = 0;
  }
}

function stepNonFightState(f: FighterSimState, bundle: FighterBundle): void {
  if (f.posY < 0) {
    f.posY = Math.min(0, f.posY + bundle.fighter.stats.gravity);
  }
  f.stateTick += 1;
}

/** Collect active melee/skill Hitbox strikes produced by `attacker` on the current tick. */
export function collectFighterMeleeStrikes(
  attacker: FighterSimState,
  defender: FighterSimState,
  attackerBundle: FighterBundle,
  defenderHurtboxes: readonly (readonly [number, number, number, number])[],
): PendingStrike[] {
  const out: PendingStrike[] = [];
  if (!attacker.currentMoveId || attacker.hitstopTicks > 0) {
    return out;
  }
  const fd = attackerBundle.framedata[attacker.currentMoveId];
  if (!fd || !fd.hitboxes) {
    return out;
  }

  // Note: stepActiveMoveTick incremented moveTick at end of step, so evaluate active frame index = Math.max(0, moveTick - 1)
  const evalTick = Math.max(0, attacker.moveTick - 1);

  for (const hb of fd.hitboxes) {
    const hIdx = hb.hit_index ?? 0;
    if (attacker.hitIndicesRegistered.includes(hIdx)) {
      continue;
    }
    if (evalTick < hb.frames[0] || evalTick > hb.frames[1]) {
      continue;
    }
    const wHb = toWorldRect(hb.rect, attacker.posX, attacker.posY, attacker.facing);
    for (const uh of defenderHurtboxes) {
      if (
        wHb[0] < uh[0] + uh[2] &&
        uh[0] < wHb[0] + wHb[2] &&
        wHb[1] < uh[1] + uh[3] &&
        uh[1] < wHb[1] + wHb[3]
      ) {
        attacker.hitIndicesRegistered.push(hIdx);
        out.push({
          attackerSlot: attacker.slot,
          defenderSlot: defender.slot,
          moveId: attacker.currentMoveId,
          hitIndex: hIdx,
          spec: hb,
          contactX: divTrunc(Math.max(wHb[0], uh[0]) + Math.min(wHb[0] + wHb[2], uh[0] + uh[2]), 2),
          contactY: divTrunc(Math.max(wHb[1], uh[1]) + Math.min(wHb[1] + wHb[3], uh[1] + uh[3]), 2),
          fromProjectile: false,
          fromAssist: false,
        });
        break;
      }
    }
  }
  return out;
}

function latestInput(f: FighterSimState): number {
  if (f.inputRing.length === 0) return 0;
  return sanitizeSocd(f.inputRing[f.inputRing.length - 1]!);
}
