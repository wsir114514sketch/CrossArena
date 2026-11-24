/**
 * Deterministic Hitbox / Hurtbox / Pushbox & High-Mid-Low Guard / Throw / Guard-Break Resolver.
 *
 * Implements:
 * - Decision D4 integer AABB overlap (`<`) & left-facing mirror (`[posX - x - w, posY + y, w, h]`).
 * - Decision D6 4-state Hurtbox & Pushbox (`stand`, `crouch`, `air`, `down`).
 * - Street Fighter / KOF high-mid-low blocking (`overhead` beats crouch block, `low` beats stand block,
 *   `mid` blocked by both, `unblockable` & `throw` ignore block).
 * - Guard Gauge depletion -> Guard Break (`GUARD_BREAK` stun + callout).
 * - Same-tick Priority / Simultaneous Trade resolution.
 * - Proximity Throw + Throw Tech window (`7` frames).
 * - Corner pushback transfer (`corner_pushback_permille`) when defender is pinned at stage boundary.
 */

import {
  computeDecayedHitstun,
  computeScaledDamage,
  isComboProtected,
} from "../combo_system/combo_rules";
import type {
  CombatConfig,
  FighterBundle,
  FrameData,
  GuardType,
  HitSpec,
  HurtboxProfile,
} from "../core/data_models";
import {
  clampInt,
  divTrunc,
  type IntRect,
  PERMILLE_BASE,
  PERCENT_BASE,
  rectsOverlap,
  toWorldRect,
} from "../core/fixed_math";
import { INPUT_BLOCK, sanitizeSocd, toNumpadDirection } from "../core/input_bits";
import type { FighterSimState, SimState } from "../core/sim_state";

/** Return active local hurtbox rects for fighter `f` on its current tick. */
export function getActiveLocalHurtboxes(
  f: FighterSimState,
  hurtbox: HurtboxProfile,
  currentFd?: FrameData,
): IntRect[] {
  if (f.invulnTicks > 0 || f.state === "KNOCKDOWN" || f.state === "WAKEUP" || f.state === "BACKDASH" || f.state === "AWAKENING" || f.state === "DEAD") {
    return [];
  }
  if (currentFd) {
    if (currentFd.invuln_frames) {
      for (const [lo, hi] of currentFd.invuln_frames) {
        if (f.moveTick >= lo && f.moveTick <= hi) {
          return [];
        }
      }
    }
    if (currentFd.hurtbox_override) {
      for (const ov of currentFd.hurtbox_override) {
        if (f.moveTick >= ov.frames[0] && f.moveTick <= ov.frames[1]) {
          return ov.rects;
        }
      }
    }
  }
  if (f.posY < 0 || f.state === "JUMP" || f.state === "AIR_HITSTUN") {
    return hurtbox.air;
  }
  if (f.state === "CROUCH" || f.state === "CROUCH_BLOCK") {
    return hurtbox.crouch;
  }
  return hurtbox.stand;
}

/** Return active world-space hurtboxes for fighter `f`. */
export function getWorldHurtboxes(
  f: FighterSimState,
  hurtbox: HurtboxProfile,
  currentFd?: FrameData,
): IntRect[] {
  return getActiveLocalHurtboxes(f, hurtbox, currentFd).map((r) =>
    toWorldRect(r, f.posX, f.posY, f.facing),
  );
}

/** Return active world-space pushbox for fighter `f` (Decision D6). */
export function getWorldPushbox(f: FighterSimState, hurtbox: HurtboxProfile): IntRect {
  let local: IntRect;
  if (f.state === "KNOCKDOWN" || f.state === "DEAD") {
    local = hurtbox.pushbox.down;
  } else if (f.posY < 0 || f.state === "JUMP" || f.state === "AIR_HITSTUN") {
    local = hurtbox.pushbox.air;
  } else if (f.state === "CROUCH" || f.state === "CROUCH_BLOCK") {
    local = hurtbox.pushbox.crouch;
  } else {
    local = hurtbox.pushbox.stand;
  }
  return toWorldRect(local, f.posX, f.posY, f.facing);
}

/** Check whether fighter `f` has super armor on the current move tick. */
export function hasArmorAtTick(f: FighterSimState, currentFd?: FrameData): boolean {
  if (!currentFd || !currentFd.armor_frames) return false;
  for (const [lo, hi] of currentFd.armor_frames) {
    if (f.moveTick >= lo && f.moveTick <= hi) {
      return true;
    }
  }
  return false;
}

/** Determine whether `defender` is holding a valid guard against `guardType`. */
export function evaluateGuardSuccess(
  defender: FighterSimState,
  guardType: GuardType,
): { blocked: boolean; crouchGuard: boolean } {
  if (guardType === "unblockable" || guardType === "throw") {
    return { blocked: false, crouchGuard: false };
  }
  // Cannot block while airborne, attacking, stunned (except BLOCKSTUN / STAND_BLOCK / CROUCH_BLOCK), dashing, or broken
  const canGuardState =
    defender.state === "IDLE" ||
    defender.state === "WALK_BACKWARD" ||
    defender.state === "WALK_FORWARD" ||
    defender.state === "CROUCH" ||
    defender.state === "STAND_BLOCK" ||
    defender.state === "CROUCH_BLOCK" ||
    defender.state === "BLOCKSTUN";
  if (!canGuardState || defender.posY < 0) {
    return { blocked: false, crouchGuard: false };
  }

  const latestMask =
    defender.inputRing.length > 0
      ? sanitizeSocd(defender.inputRing[defender.inputRing.length - 1]!)
      : 0;
  const dir = toNumpadDirection(latestMask, defender.facing);
  const holdingBlockBtn = (latestMask & INPUT_BLOCK) !== 0;
  const holdingBack = dir === 4 || dir === 1;
  const isCrouching =
    dir === 1 ||
    dir === 2 ||
    dir === 3 ||
    defender.state === "CROUCH" ||
    defender.state === "CROUCH_BLOCK";

  if (!holdingBlockBtn && !holdingBack && defender.state !== "BLOCKSTUN") {
    return { blocked: false, crouchGuard: false };
  }

  // High/Mid/Low guard check (Street Fighter / KOF core mixup)
  if (guardType === "overhead" && isCrouching) {
    return { blocked: false, crouchGuard: true };
  }
  if (guardType === "low" && !isCrouching) {
    return { blocked: false, crouchGuard: false };
  }
  return { blocked: true, crouchGuard: isCrouching };
}

export interface PendingStrike {
  attackerSlot: 0 | 1;
  defenderSlot: 0 | 1;
  moveId: string;
  hitIndex: number;
  spec: HitSpec;
  contactX: number;
  contactY: number;
  fromProjectile: boolean;
  fromAssist: boolean;
}

/** Resolve pushbox separation and compact stage wall clamping (`[-stage_half_width, +stage_half_width]`). */
export function resolvePushboxesAndStageBounds(
  state: SimState,
  b0: FighterBundle,
  b1: FighterBundle,
  cfg: CombatConfig,
): void {
  const f0 = state.fighters[0];
  const f1 = state.fighters[1];
  const halfW = cfg.stage_half_width;

  const p0 = getWorldPushbox(f0, b0.hurtbox);
  const p1 = getWorldPushbox(f1, b1.hurtbox);

  if (rectsOverlap(p0, p1)) {
    const overlapLeft = p0[0] + p0[2] - p1[0];
    const overlapRight = p1[0] + p1[2] - p0[0];
    const overlapX = Math.min(overlapLeft, overlapRight);
    if (overlapX > 0) {
      const halfPush = divTrunc(overlapX + 1, 2);
      if (f0.posX < f1.posX || (f0.posX === f1.posX && f0.facing >= 0)) {
        f0.posX -= halfPush;
        f1.posX += overlapX - halfPush;
      } else {
        f0.posX += halfPush;
        f1.posX -= overlapX - halfPush;
      }
    }
  }

  // Clamp fighter anchors within compact stage walls (leaving pushbox half-width margin inside wall)
  const margin0 = divTrunc(b0.hurtbox.pushbox.stand[2], 2);
  const margin1 = divTrunc(b1.hurtbox.pushbox.stand[2], 2);
  f0.posX = clampInt(f0.posX, -halfW + margin0, halfW - margin0);
  f1.posX = clampInt(f1.posX, -halfW + margin1, halfW - margin1);

  // Re-check overlap if one fighter was pinned against a corner wall
  const q0 = getWorldPushbox(f0, b0.hurtbox);
  const q1 = getWorldPushbox(f1, b1.hurtbox);
  if (rectsOverlap(q0, q1)) {
    if (f0.posX <= -halfW + margin0 + 1) {
      f1.posX = clampInt(q0[0] + q0[2] + margin1, -halfW + margin1, halfW - margin1);
    } else if (f0.posX >= halfW - margin0 - 1) {
      f1.posX = clampInt(q0[0] - margin1, -halfW + margin1, halfW - margin1);
    } else if (f1.posX <= -halfW + margin1 + 1) {
      f0.posX = clampInt(q1[0] + q1[2] + margin0, -halfW + margin0, halfW - margin0);
    } else if (f1.posX >= halfW - margin1 - 1) {
      f0.posX = clampInt(q1[0] - margin0, -halfW + margin0, halfW - margin0);
    }
  }
}

/** Apply a confirmed strike (normal, skill, projectile, or assist) onto `defender`. */
export function applyStrikeOutcome(
  state: SimState,
  strike: PendingStrike,
  attackerBundle: FighterBundle,
  defenderBundle: FighterBundle,
  cfg: CombatConfig,
): void {
  const attacker = state.fighters[strike.attackerSlot];
  const defender = state.fighters[strike.defenderSlot];
  const spec = strike.spec;
  const defenderAirborne = defender.posY < 0 || defender.state === "JUMP" || defender.state === "AIR_HITSTUN";

  if (!spec.air_hit && defenderAirborne) {
    return;
  }
  if (isComboProtected(defender, strike.moveId, defenderAirborne, cfg)) {
    return;
  }

  const guardType: GuardType = spec.guard_type ?? "mid";

  // Check proximity throw range & tech window if guardType === 'throw'
  if (guardType === "throw") {
    if (defenderAirborne || defender.state === "HITSTUN" || defender.state === "BLOCKSTUN" || defender.state === "KNOCKDOWN") {
      return;
    }
    const techWindow = cfg.throw_tech_window_frames ?? 7;
    if (defender.state === "THROWING" && defender.moveTick <= techWindow) {
      // Throw Tech! Push both fighters back to neutral footsies
      const push = 95000;
      attacker.posX = clampInt(attacker.posX - attacker.facing * push, -cfg.stage_half_width + 40000, cfg.stage_half_width - 40000);
      defender.posX = clampInt(defender.posX - defender.facing * push, -cfg.stage_half_width + 40000, cfg.stage_half_width - 40000);
      attacker.state = "IDLE";
      attacker.currentMoveId = null;
      defender.state = "IDLE";
      defender.currentMoveId = null;
      attacker.hitstopTicks = 8;
      defender.hitstopTicks = 8;
      state.events.push({
        tick: state.tick,
        type: "throw_tech",
        slot: defender.slot,
        x: strike.contactX,
        y: strike.contactY,
        text: "THROW TECH!",
      });
      return;
    }
  }

  const { blocked, crouchGuard } = evaluateGuardSuccess(defender, guardType);

  if (blocked) {
    const guardCost = Math.max(120, spec.damage * 2);
    defender.guardGauge = Math.max(0, defender.guardGauge - guardCost);
    const chip = spec.chip_damage ?? (spec.damage >= 140 ? Math.max(2, divTrunc(spec.damage, 12)) : 0);
    if (chip > 0 && defender.hp > 1) {
      defender.hp = Math.max(1, defender.hp - chip);
    }

    const bHitstop = spec.block_hitstop ?? spec.hitstop;
    if (!strike.fromProjectile && !strike.fromAssist) {
      attacker.hitstopTicks = Math.max(attacker.hitstopTicks, bHitstop);
    }
    defender.hitstopTicks = Math.max(defender.hitstopTicks, bHitstop);

    // Meter gain on block
    const atkGain = spec.meter_gain_on_block ?? Math.max(15, divTrunc(spec.damage, 3));
    const defPct = defenderBundle.fighter.stats.gauge_gain_on_block_pct ?? 100;
    const defGain = divTrunc(Math.max(10, divTrunc(spec.damage, 4)) * defPct, PERCENT_BASE);
    attacker.gauge = Math.min(attacker.maxGauge, attacker.gauge + atkGain);
    defender.gauge = Math.min(defender.maxGauge, defender.gauge + defGain);

    // Pushback & corner transfer
    applyHorizontalKnockback(attacker, defender, divTrunc(spec.knockback[0] * 7, 10), strike.fromProjectile || strike.fromAssist, cfg);

    if (spec.guard_break || defender.guardGauge <= 0) {
      defender.guardGauge = defender.maxGuardGauge;
      defender.state = "GUARD_BREAK";
      defender.stateTick = 0;
      defender.currentMoveId = null;
      defender.stunTicks = cfg.guard_break_stun_ticks ?? 54;
      state.events.push({
        tick: state.tick,
        type: "guard_break",
        slot: attacker.slot,
        x: strike.contactX,
        y: strike.contactY,
        text: "GUARD BREAK!",
      });
    } else {
      defender.state = "BLOCKSTUN";
      defender.stateTick = 0;
      defender.currentMoveId = null;
      defender.stunTicks = Math.max(1, spec.blockstun);
      if (crouchGuard) {
        // Remember crouch posture via input / Hurtbox check
      }
      state.events.push({
        tick: state.tick,
        type: "block",
        slot: defender.slot,
        x: strike.contactX,
        y: strike.contactY,
      });
    }
    updateFrameAdvantage(attacker, attackerBundle, defender.stunTicks);
    return;
  }

  // Unblocked Hit! Check Counter Hit & Super Armor
  const isCounterHit =
    defender.state === "ATTACKING" ||
    defender.state === "SKILL" ||
    defender.state === "THROWING";
  const defFd = defender.currentMoveId ? defenderBundle.framedata[defender.currentMoveId] : undefined;
  const armored = guardType !== "throw" && hasArmorAtTick(defender, defFd);

  const rawDmg = isCounterHit ? divTrunc(spec.damage * 115, 100) : spec.damage;
  const finalDmg = computeScaledDamage(
    rawDmg,
    defender.comboCounter,
    defenderBundle.fighter.stats.defense,
    cfg,
  );
  defender.hp = Math.max(0, defender.hp - finalDmg);

  // Update combo & protection counters
  defender.comboCounter += 1;
  defender.comboDamage += finalDmg;
  defender.moveHitCountsInCombo[strike.moveId] =
    (defender.moveHitCountsInCombo[strike.moveId] ?? 0) + 1;
  if (defenderAirborne || spec.knockback[1] < 0) {
    defender.juggleHitsTaken += 1;
  }

  // Hitstop
  if (!strike.fromProjectile && !strike.fromAssist) {
    attacker.hitstopTicks = Math.max(attacker.hitstopTicks, spec.hitstop);
  }
  defender.hitstopTicks = Math.max(defender.hitstopTicks, spec.hitstop);

  // Meter gain on hit / hurt
  const atkGain = spec.meter_gain_on_hit ?? Math.max(30, divTrunc(spec.damage * 3, 4));
  const hurtPct = defenderBundle.fighter.stats.gauge_gain_on_hurt_pct ?? 100;
  const defGain = divTrunc(Math.max(20, divTrunc(spec.damage, 2)) * hurtPct, PERCENT_BASE);
  attacker.gauge = Math.min(attacker.maxGauge, attacker.gauge + atkGain);
  defender.gauge = Math.min(defender.maxGauge, defender.gauge + defGain);

  if (defender.hp <= 0) {
    defender.state = "DEAD";
    defender.stateTick = 0;
    defender.currentMoveId = null;
    defender.velX = -attacker.facing * Math.max(12000, divTrunc(spec.knockback[0], 4));
    defender.velY = Math.min(-18000, spec.knockback[1]);
    state.events.push({
      tick: state.tick,
      type: "ko",
      slot: attacker.slot,
      x: strike.contactX,
      y: strike.contactY,
      text: "K.O.!",
    });
    return;
  }

  if (armored) {
    state.events.push({
      tick: state.tick,
      type: "callout",
      slot: defender.slot,
      x: defender.posX,
      y: defender.posY - 110000,
      text: "ARMOR!",
    });
    return;
  }

  if (isCounterHit) {
    state.events.push({
      tick: state.tick,
      type: "callout",
      slot: attacker.slot,
      x: strike.contactX,
      y: strike.contactY - 25000,
      text: "COUNTER!",
    });
  }

  applyHorizontalKnockback(
    attacker,
    defender,
    spec.knockback[0],
    strike.fromProjectile || strike.fromAssist,
    cfg,
  );

  const decayedStun = computeDecayedHitstun(
    isCounterHit ? spec.hitstun + 4 : spec.hitstun,
    defender.comboCounter - 1,
  );

  if (guardType === "throw" || spec.knockdown) {
    defender.state = spec.knockback[1] < 0 ? "AIR_HITSTUN" : "KNOCKDOWN";
    defender.stateTick = 0;
    defender.currentMoveId = null;
    defender.stunTicks = Math.max(26, decayedStun);
    if (spec.knockback[1] < 0) {
      defender.velY = spec.knockback[1];
      defender.velX = attacker.facing * divTrunc(spec.knockback[0], 6);
    }
    state.events.push({
      tick: state.tick,
      type: guardType === "throw" ? "throw_hit" : "heavy_hit",
      slot: attacker.slot,
      x: strike.contactX,
      y: strike.contactY,
    });
  } else if (defenderAirborne || spec.knockback[1] < 0) {
    defender.state = "AIR_HITSTUN";
    defender.stateTick = 0;
    defender.currentMoveId = null;
    defender.stunTicks = decayedStun;
    defender.velY = spec.knockback[1] < 0 ? spec.knockback[1] : -14000;
    defender.velX = attacker.facing * divTrunc(spec.knockback[0], 8);
    state.events.push({
      tick: state.tick,
      type: spec.damage >= 90 ? "heavy_hit" : "hit",
      slot: attacker.slot,
      x: strike.contactX,
      y: strike.contactY,
    });
  } else {
    defender.state = "HITSTUN";
    defender.stateTick = 0;
    defender.currentMoveId = null;
    defender.stunTicks = decayedStun;
    state.events.push({
      tick: state.tick,
      type: spec.damage >= 90 ? "heavy_hit" : "hit",
      slot: attacker.slot,
      x: strike.contactX,
      y: strike.contactY,
    });
  }

  updateFrameAdvantage(attacker, attackerBundle, defender.stunTicks);
}

function applyHorizontalKnockback(
  attacker: FighterSimState,
  defender: FighterSimState,
  kx: number,
  remoteSource: boolean,
  cfg: CombatConfig,
): void {
  if (kx <= 0) return;
  const halfW = cfg.stage_half_width - 36000;
  const pushDir: 1 | -1 = attacker.posX <= defender.posX ? 1 : -1;
  const targetX = defender.posX + pushDir * kx;
  const clampedX = clampInt(targetX, -halfW, halfW);
  const absorbedByWall = Math.abs(targetX - clampedX);
  defender.posX = clampedX;

  if (absorbedByWall > 0 && !remoteSource && attacker.posY === 0) {
    const recoil = divTrunc(absorbedByWall * cfg.corner_pushback_permille, PERMILLE_BASE);
    attacker.posX = clampInt(attacker.posX - pushDir * recoil, -halfW, halfW);
  }
}

function updateFrameAdvantage(
  attacker: FighterSimState,
  attackerBundle: FighterBundle,
  defenderStun: number,
): void {
  if (!attacker.currentMoveId) return;
  const fd = attackerBundle.framedata[attacker.currentMoveId];
  if (!fd) return;
  const total = fd.startup + fd.active + fd.recovery;
  const attackerRemaining = Math.max(0, total - attacker.moveTick - 1);
  attacker.frameAdvantage = defenderStun - attackerRemaining;
}
