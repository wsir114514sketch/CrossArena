/**
 * Serializable, clonable, checksum-verifiable 60Hz Simulation State.
 * Supports saveState() / loadState() for Rollback Netcode (SyncTest) and Training Mode resets.
 */

import type { HitSpec } from "./data_models";
import type { IntRect } from "./fixed_math";
import { normalizeSeed } from "./sim_rng";

export type FighterStateId =
  | "IDLE"
  | "WALK_FORWARD"
  | "WALK_BACKWARD"
  | "DASH"
  | "BACKDASH"
  | "CROUCH"
  | "JUMP"
  | "ATTACKING"
  | "STAND_BLOCK"
  | "CROUCH_BLOCK"
  | "HITSTUN"
  | "AIR_HITSTUN"
  | "BLOCKSTUN"
  | "GUARD_BREAK"
  | "KNOCKDOWN"
  | "WAKEUP"
  | "THROWING"
  | "THROWN"
  | "SKILL"
  | "ULTIMATE"
  | "AWAKENING"
  | "VICTORY"
  | "DEAD";

export type RoundPhase = "INTRO" | "FIGHT" | "KO_FREEZE" | "ROUND_END" | "MATCH_OVER";

export interface SimEvent {
  tick: number;
  type:
    | "swing"
    | "hit"
    | "heavy_hit"
    | "block"
    | "guard_break"
    | "throw_tech"
    | "throw_hit"
    | "super_freeze"
    | "awaken"
    | "assist_call"
    | "ko"
    | "callout";
  slot: 0 | 1;
  x: number;
  y: number;
  text?: string;
}

export interface ProjectileSimState {
  id: number;
  ownerSlot: 0 | 1;
  effectPath: string;
  ipId: string;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  gravity: number;
  facing: 1 | -1;
  rect: IntRect;
  hit: HitSpec;
  remainingTicks: number;
  active: boolean;
}

export interface AssistSimState {
  ownerSlot: 0 | 1;
  assistId: string;
  active: boolean;
  posX: number;
  posY: number;
  facing: 1 | -1;
  moveTick: number;
  totalTicks: number;
  hitConfirmedIndices: number[];
}

export interface FighterSimState {
  slot: 0 | 1;
  baseFighterId: string;
  activeFighterId: string;
  assistId: string | null;

  posX: number;
  posY: number;
  velX: number;
  velY: number;
  facing: 1 | -1;

  hp: number;
  maxHp: number;
  gauge: number;
  maxGauge: number;
  guardGauge: number;
  maxGuardGauge: number;

  state: FighterStateId;
  stateTick: number;
  currentMoveId: string | null;
  moveTick: number;
  moveInstanceId: number;
  hitIndicesRegistered: number[];
  spawnedProjectileIndices: number[];

  hitstopTicks: number;
  stunTicks: number;
  invulnTicks: number;

  comboCounter: number;
  comboDamage: number;
  juggleHitsTaken: number;
  moveHitCountsInCombo: Record<string, number>;

  skillCooldowns: Record<string, number>;
  assistCooldownTicks: number;
  awakenTicksRemaining: number; // 0 = not timed / base form; >0 = active timed awakening; -1 = permanent awakening

  prevInputMask: number;
  inputRing: number[]; // circular history of sanitized masks (most recent last, max 30 ticks)
  lastTapDir: 4 | 6 | 0;
  lastTapAge: number;
  dashWindowAge: number;

  lastMoveStartup: number;
  lastMoveActive: number;
  lastMoveRecovery: number;
  frameAdvantage: number;
}

export interface SimState {
  tick: number;
  roundNumber: number;
  phase: RoundPhase;
  phaseTicksRemaining: number;
  timerTicksRemaining: number;
  superFreezeTicks: number;
  superFreezeOwner: 0 | 1 | -1;

  wins: [number, number];
  winnerSlot: 0 | 1 | -1; // -1 = draw / undecided

  rngState: bigint;
  nextEntityId: number;

  fighters: [FighterSimState, FighterSimState];
  projectiles: ProjectileSimState[];
  assists: [AssistSimState, AssistSimState];
  events: SimEvent[];
}

export function createFighterSimState(
  slot: 0 | 1,
  fighterId: string,
  assistId: string | null,
  startX: number,
  facing: 1 | -1,
  maxHp: number,
  maxGauge: number,
  maxGuardGauge: number,
): FighterSimState {
  return {
    slot,
    baseFighterId: fighterId,
    activeFighterId: fighterId,
    assistId,
    posX: startX,
    posY: 0,
    velX: 0,
    velY: 0,
    facing,
    hp: maxHp,
    maxHp,
    gauge: 1000, // Start with 1 stock for immediate tactical options (KOF arcade style)
    maxGauge,
    guardGauge: maxGuardGauge,
    maxGuardGauge,
    state: "IDLE",
    stateTick: 0,
    currentMoveId: null,
    moveTick: 0,
    moveInstanceId: 0,
    hitIndicesRegistered: [],
    spawnedProjectileIndices: [],
    hitstopTicks: 0,
    stunTicks: 0,
    invulnTicks: 0,
    comboCounter: 0,
    comboDamage: 0,
    juggleHitsTaken: 0,
    moveHitCountsInCombo: {},
    skillCooldowns: {},
    assistCooldownTicks: 0,
    awakenTicksRemaining: 0,
    prevInputMask: 0,
    inputRing: [],
    lastTapDir: 0,
    lastTapAge: 999,
    dashWindowAge: 999,
    lastMoveStartup: 0,
    lastMoveActive: 0,
    lastMoveRecovery: 0,
    frameAdvantage: 0,
  };
}

export function createInitialAssistState(ownerSlot: 0 | 1, assistId: string | null): AssistSimState {
  return {
    ownerSlot,
    assistId: assistId ?? "",
    active: false,
    posX: 0,
    posY: 0,
    facing: ownerSlot === 0 ? 1 : -1,
    moveTick: 0,
    totalTicks: 0,
    hitConfirmedIndices: [],
  };
}

export function cloneSimState(s: SimState): SimState {
  return {
    tick: s.tick,
    roundNumber: s.roundNumber,
    phase: s.phase,
    phaseTicksRemaining: s.phaseTicksRemaining,
    timerTicksRemaining: s.timerTicksRemaining,
    superFreezeTicks: s.superFreezeTicks,
    superFreezeOwner: s.superFreezeOwner,
    wins: [s.wins[0], s.wins[1]],
    winnerSlot: s.winnerSlot,
    rngState: normalizeSeed(s.rngState),
    nextEntityId: s.nextEntityId,
    fighters: [cloneFighter(s.fighters[0]), cloneFighter(s.fighters[1])],
    projectiles: s.projectiles.map((p) => ({
      ...p,
      rect: [p.rect[0], p.rect[1], p.rect[2], p.rect[3]],
      hit: {
        ...p.hit,
        knockback: [p.hit.knockback[0], p.hit.knockback[1]],
      },
    })),
    assists: [cloneAssist(s.assists[0]), cloneAssist(s.assists[1])],
    events: s.events.map((e) => ({ ...e })),
  };
}

function cloneFighter(f: FighterSimState): FighterSimState {
  return {
    ...f,
    hitIndicesRegistered: [...f.hitIndicesRegistered],
    spawnedProjectileIndices: [...f.spawnedProjectileIndices],
    moveHitCountsInCombo: { ...f.moveHitCountsInCombo },
    skillCooldowns: { ...f.skillCooldowns },
    inputRing: [...f.inputRing],
  };
}

function cloneAssist(a: AssistSimState): AssistSimState {
  return {
    ...a,
    hitConfirmedIndices: [...a.hitConfirmedIndices],
  };
}

/**
 * Deterministic 64-bit FNV-1a checksum over all gameplay-critical simulation fields.
 * Used by Rollback SyncTest and Replay verification tests.
 */
export function computeSimChecksum(s: SimState): string {
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK_64 = 0xffffffffffffffffn;

  let hash = FNV_OFFSET;
  const mixInt = (n: number) => {
    const v = BigInt(Math.trunc(n)) & MASK_64;
    for (let i = 0n; i < 8n; i++) {
      const byte = (v >> (i * 8n)) & 0xffn;
      hash = ((hash ^ byte) * FNV_PRIME) & MASK_64;
    }
  };
  const mixStr = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      const code = BigInt(str.charCodeAt(i) & 0xffff);
      hash = ((hash ^ (code & 0xffn)) * FNV_PRIME) & MASK_64;
      hash = ((hash ^ ((code >> 8n) & 0xffn)) * FNV_PRIME) & MASK_64;
    }
  };

  mixInt(s.tick);
  mixInt(s.roundNumber);
  mixStr(s.phase);
  mixInt(s.phaseTicksRemaining);
  mixInt(s.timerTicksRemaining);
  mixInt(s.superFreezeTicks);
  mixInt(s.wins[0]);
  mixInt(s.wins[1]);
  hash = ((hash ^ (s.rngState & MASK_64)) * FNV_PRIME) & MASK_64;

  for (const f of s.fighters) {
    mixStr(f.activeFighterId);
    mixInt(f.posX);
    mixInt(f.posY);
    mixInt(f.velX);
    mixInt(f.velY);
    mixInt(f.facing);
    mixInt(f.hp);
    mixInt(f.gauge);
    mixInt(f.guardGauge);
    mixStr(f.state);
    mixInt(f.stateTick);
    mixStr(f.currentMoveId ?? "");
    mixInt(f.moveTick);
    mixInt(f.hitstopTicks);
    mixInt(f.stunTicks);
    mixInt(f.invulnTicks);
    mixInt(f.comboCounter);
    mixInt(f.juggleHitsTaken);
    mixInt(f.assistCooldownTicks);
    mixInt(f.awakenTicksRemaining);
  }

  for (const p of s.projectiles) {
    if (!p.active) continue;
    mixInt(p.id);
    mixInt(p.posX);
    mixInt(p.posY);
    mixInt(p.remainingTicks);
  }

  for (const a of s.assists) {
    mixInt(a.active ? 1 : 0);
    mixInt(a.posX);
    mixInt(a.moveTick);
  }

  return hash.toString(16).padStart(16, "0");
}
