/**
 * Top-Level 60Hz Deterministic Battle Simulation (`BattleSimulation`).
 *
 * Orchestrates:
 * - Match & Round lifecycle (`INTRO` -> `FIGHT` -> `KO_FREEZE` -> `ROUND_END` -> `MATCH_OVER`).
 * - Super Freeze dramatic pause (pausing opponent & timer while owner initiates Ultimate/Awakening).
 * - Simultaneous Hit Priority & Trade resolution (`priority` comparison).
 * - Pushbox separation & compact arena boundary enforcement.
 * - Save/Load state & Checksum verification for Rollback Netcode & Training Mode.
 */

import { pushFighterInput } from "../combo_system/input_buffer";
import type { ContentRegistry } from "../core/data_models";
import { SIM_HZ } from "../core/fixed_math";
import { normalizeSeed } from "../core/sim_rng";
import {
  cloneSimState,
  computeSimChecksum,
  createFighterSimState,
  createInitialAssistState,
  type SimState,
} from "../core/sim_state";
import {
  collectFighterMeleeStrikes,
  stepFighterStateAndIntent,
} from "../fighter/fighter_fsm";
import {
  applyStrikeOutcome,
  getWorldHurtboxes,
  resolvePushboxesAndStageBounds,
} from "../hit_system/hit_resolver";
import { stepAssists, stepProjectiles } from "../skill_system/skill_executor";

export interface MatchSetupConfig {
  p1FighterId: string;
  p2FighterId: string;
  p1AssistId?: string | null;
  p2AssistId?: string | null;
  seed?: bigint | number;
  infiniteTime?: boolean;
  trainingMode?: boolean;
}

export class BattleSimulation {
  public readonly registry: ContentRegistry;
  public readonly setup: MatchSetupConfig;
  public state: SimState;

  constructor(registry: ContentRegistry, setup: MatchSetupConfig) {
    this.registry = registry;
    this.setup = setup;
    this.state = this.createMatchInitialState();
  }

  public createMatchInitialState(): SimState {
    const cfg = this.registry.combatConfig;
    const b0 = this.registry.fightersById[this.setup.p1FighterId];
    const b1 = this.registry.fightersById[this.setup.p2FighterId];
    if (!b0 || !b1) {
      throw new Error(
        `Unknown fighter id in MatchSetupConfig: ${this.setup.p1FighterId} vs ${this.setup.p2FighterId}`,
      );
    }

    const maxGauge0 = b0.fighter.stats.max_gauge ?? (cfg.default_gauge_cap ?? 3000);
    const maxGauge1 = b1.fighter.stats.max_gauge ?? (cfg.default_gauge_cap ?? 3000);
    const maxGuard = cfg.guard_gauge_max ?? 1000;

    const f0 = createFighterSimState(
      0,
      b0.fighter.id,
      this.setup.p1AssistId ?? null,
      cfg.p1_start_x,
      1,
      b0.fighter.stats.max_hp,
      maxGauge0,
      maxGuard,
    );
    const f1 = createFighterSimState(
      1,
      b1.fighter.id,
      this.setup.p2AssistId ?? null,
      cfg.p2_start_x,
      -1,
      b1.fighter.stats.max_hp,
      maxGauge1,
      maxGuard,
    );

    if (this.setup.trainingMode) {
      f0.gauge = maxGauge0;
      f1.gauge = maxGauge1;
    }

    return {
      tick: 0,
      roundNumber: 1,
      phase: this.setup.trainingMode ? "FIGHT" : "INTRO",
      phaseTicksRemaining: this.setup.trainingMode ? 0 : cfg.intro_ticks,
      timerTicksRemaining: cfg.round_time_seconds * SIM_HZ,
      superFreezeTicks: 0,
      superFreezeOwner: -1,
      wins: [0, 0],
      winnerSlot: -1,
      rngState: normalizeSeed(this.setup.seed ?? 0x2026c0de55aa11n),
      nextEntityId: 1,
      fighters: [f0, f1],
      projectiles: [],
      assists: [
        createInitialAssistState(0, this.setup.p1AssistId ?? null),
        createInitialAssistState(1, this.setup.p2AssistId ?? null),
      ],
      events: [],
    };
  }

  public saveState(): SimState {
    return cloneSimState(this.state);
  }

  public loadState(snapshot: SimState): void {
    this.state = cloneSimState(snapshot);
  }

  public getChecksum(): string {
    return computeSimChecksum(this.state);
  }

  /** Reset positions & HP for next round while preserving round wins & meter carry-over. */
  public startNextRound(): void {
    const s = this.state;
    const cfg = this.registry.combatConfig;
    s.roundNumber += 1;
    s.phase = "INTRO";
    s.phaseTicksRemaining = cfg.intro_ticks;
    s.timerTicksRemaining = cfg.round_time_seconds * SIM_HZ;
    s.superFreezeTicks = 0;
    s.superFreezeOwner = -1;
    s.winnerSlot = -1;
    s.projectiles = [];

    for (const slot of [0, 1] as const) {
      const f = s.fighters[slot];
      // Revert to starting form on new round
      f.activeFighterId = f.baseFighterId;
      const b = this.registry.fightersById[f.activeFighterId]!;
      f.maxHp = b.fighter.stats.max_hp;
      f.hp = f.maxHp;
      f.guardGauge = f.maxGuardGauge;
      f.posX = slot === 0 ? cfg.p1_start_x : cfg.p2_start_x;
      f.posY = 0;
      f.velX = 0;
      f.velY = 0;
      f.facing = slot === 0 ? 1 : -1;
      f.state = "IDLE";
      f.stateTick = 0;
      f.currentMoveId = null;
      f.moveTick = 0;
      f.hitstopTicks = 0;
      f.stunTicks = 0;
      f.invulnTicks = 0;
      f.comboCounter = 0;
      f.comboDamage = 0;
      f.juggleHitsTaken = 0;
      f.moveHitCountsInCombo = {};
      f.skillCooldowns = {};
      f.assistCooldownTicks = 0;
      f.awakenTicksRemaining = 0;
      // Grant +500 bonus gauge between rounds (KOF style)
      f.gauge = Math.min(f.maxGauge, f.gauge + 500);
      s.assists[slot] = createInitialAssistState(slot, f.assistId);
    }
  }

  /** Advance the deterministic simulation by exactly 1 tick (1/60s) given P1 and P2 16-bit input masks. */
  public step(p1InputMask: number, p2InputMask: number): void {
    const s = this.state;
    const cfg = this.registry.combatConfig;
    s.events = [];
    s.tick += 1;

    const f0 = s.fighters[0];
    const f1 = s.fighters[1];
    pushFighterInput(f0, p1InputMask, f0.hitstopTicks > 0 || s.superFreezeTicks > 0);
    pushFighterInput(f1, p2InputMask, f1.hitstopTicks > 0 || s.superFreezeTicks > 0);

    // Super Freeze pauses opponent, timer, and projectiles while cinematic flash runs
    if (s.superFreezeTicks > 0) {
      s.superFreezeTicks -= 1;
      if (s.superFreezeTicks === 0) {
        s.superFreezeOwner = -1;
      }
      f0.prevInputMask = p1InputMask;
      f1.prevInputMask = p2InputMask;
      return;
    }

    // Round Phase management
    if (s.phase === "INTRO") {
      stepFighterStateAndIntent(s, f0, f1, this.registry);
      stepFighterStateAndIntent(s, f1, f0, this.registry);
      s.phaseTicksRemaining -= 1;
      if (s.phaseTicksRemaining <= 0) {
        s.phase = "FIGHT";
        s.events.push({
          tick: s.tick,
          type: "callout",
          slot: 0,
          x: 0,
          y: -150000,
          text: "FIGHT!",
        });
      }
      f0.prevInputMask = p1InputMask;
      f1.prevInputMask = p2InputMask;
      return;
    }

    if (s.phase === "KO_FREEZE") {
      stepFighterStateAndIntent(s, f0, f1, this.registry);
      stepFighterStateAndIntent(s, f1, f0, this.registry);
      s.phaseTicksRemaining -= 1;
      if (s.phaseTicksRemaining <= 0) {
        s.phase = "ROUND_END";
        s.phaseTicksRemaining = cfg.round_end_ticks;
        if (s.winnerSlot === 0 || s.winnerSlot === 1) {
          const w = s.fighters[s.winnerSlot];
          if (w.hp > 0) {
            w.state = "VICTORY";
            w.stateTick = 0;
          }
        }
      }
      f0.prevInputMask = p1InputMask;
      f1.prevInputMask = p2InputMask;
      return;
    }

    if (s.phase === "ROUND_END") {
      s.fighters[0].stateTick += 1;
      s.fighters[1].stateTick += 1;
      s.phaseTicksRemaining -= 1;
      if (s.phaseTicksRemaining <= 0) {
        if (s.wins[0] >= cfg.rounds_to_win || s.wins[1] >= cfg.rounds_to_win) {
          s.phase = "MATCH_OVER";
        } else {
          this.startNextRound();
        }
      }
      f0.prevInputMask = p1InputMask;
      f1.prevInputMask = p2InputMask;
      return;
    }

    if (s.phase === "MATCH_OVER") {
      s.fighters[0].stateTick += 1;
      s.fighters[1].stateTick += 1;
      f0.prevInputMask = p1InputMask;
      f1.prevInputMask = p2InputMask;
      return;
    }

    // === ACTIVE FIGHT PHASE ===
    stepFighterStateAndIntent(s, f0, f1, this.registry);
    stepFighterStateAndIntent(s, f1, f0, this.registry);

    let b0 = this.registry.fightersById[f0.activeFighterId]!;
    let b1 = this.registry.fightersById[f1.activeFighterId]!;

    // Pushbox & Stage Wall separation
    resolvePushboxesAndStageBounds(s, b0, b1, cfg);

    // Collect melee/skill Hitbox strikes simultaneously so P1/P2 order never biases trades!
    const fd0 = f0.currentMoveId ? b0.framedata[f0.currentMoveId] : undefined;
    const fd1 = f1.currentMoveId ? b1.framedata[f1.currentMoveId] : undefined;
    const hurt0 = getWorldHurtboxes(f0, b0.hurtbox, fd0);
    const hurt1 = getWorldHurtboxes(f1, b1.hurtbox, fd1);

    const strikes0 = collectFighterMeleeStrikes(f0, f1, b0, hurt1);
    const strikes1 = collectFighterMeleeStrikes(f1, f0, b1, hurt0);

    // Simultaneous Priority / Trade resolution (Decision D4 & Ikemen/SF priority rules)
    if (strikes0.length > 0 && strikes1.length > 0) {
      const top0 = Math.max(...strikes0.map((x) => x.spec.priority));
      const top1 = Math.max(...strikes1.map((x) => x.spec.priority));
      if (top0 > top1) {
        for (const st of strikes0) applyStrikeOutcome(s, st, b0, b1, cfg);
      } else if (top1 > top0) {
        for (const st of strikes1) applyStrikeOutcome(s, st, b1, b0, cfg);
      } else {
        // Equal priority -> Simultaneous Trade (unless both are throws -> single Throw Tech!)
        const bothThrows =
          strikes0.some((x) => x.spec.guard_type === "throw") &&
          strikes1.some((x) => x.spec.guard_type === "throw");
        if (bothThrows) {
          applyStrikeOutcome(s, strikes0[0]!, b0, b1, cfg);
        } else {
          for (const st of strikes0) applyStrikeOutcome(s, st, b0, b1, cfg);
          for (const st of strikes1) applyStrikeOutcome(s, st, b1, b0, cfg);
        }
      }
    } else {
      for (const st of strikes0) applyStrikeOutcome(s, st, b0, b1, cfg);
      for (const st of strikes1) applyStrikeOutcome(s, st, b1, b0, cfg);
    }

    // Step Projectiles & Assists
    b0 = this.registry.fightersById[f0.activeFighterId]!;
    b1 = this.registry.fightersById[f1.activeFighterId]!;
    stepProjectiles(s, this.registry);
    stepAssists(s, this.registry);

    // Training Mode regeneration if enabled
    if (this.setup.trainingMode) {
      if (f0.hp <= 0) f0.hp = f0.maxHp;
      if (f1.hp <= 0) f1.hp = f1.maxHp;
      if (f0.state === "IDLE" && f0.hp < f0.maxHp) f0.hp = Math.min(f0.maxHp, f0.hp + 15);
      if (f1.state === "IDLE" && f1.hp < f1.maxHp && f1.comboCounter === 0) {
        f1.hp = Math.min(f1.maxHp, f1.hp + 15);
      }
    } else {
      // Check K.O. or Time Over
      if (!this.setup.infiniteTime && s.timerTicksRemaining > 0) {
        s.timerTicksRemaining -= 1;
      }

      if (f0.hp <= 0 || f1.hp <= 0 || (!this.setup.infiniteTime && s.timerTicksRemaining <= 0)) {
        this.concludeRound();
      }
    }

    f0.prevInputMask = p1InputMask;
    f1.prevInputMask = p2InputMask;
  }

  private concludeRound(): void {
    const s = this.state;
    const cfg = this.registry.combatConfig;
    const f0 = s.fighters[0];
    const f1 = s.fighters[1];

    s.phase = "KO_FREEZE";
    s.phaseTicksRemaining = cfg.ko_ticks;

    // Compare remaining HP permille (fair across forms with different max_hp)
    const p0Permille = Math.trunc((f0.hp * 1000) / Math.max(1, f0.maxHp));
    const p1Permille = Math.trunc((f1.hp * 1000) / Math.max(1, f1.maxHp));

    if (f0.hp <= 0 && f1.hp <= 0) {
      // Double K.O.: award round to both unless both sit at match point
      s.winnerSlot = -1;
      if (s.wins[0] + 1 < cfg.rounds_to_win || s.wins[1] + 1 < cfg.rounds_to_win) {
        s.wins[0] += 1;
        s.wins[1] += 1;
      }
    } else if (p0Permille > p1Permille) {
      s.winnerSlot = 0;
      s.wins[0] += 1;
    } else if (p1Permille > p0Permille) {
      s.winnerSlot = 1;
      s.wins[1] += 1;
    } else {
      s.winnerSlot = -1;
    }
  }
}
