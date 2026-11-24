/**
 * Deterministic Rollback SyncTest Session & Match Replay Manager.
 *
 * Reference architecture from Rugen Engine (`net/session.rs`, `RepeatLast` input prediction,
 * snapshot ring buffer, rollback & re-simulate on misprediction, FNV-1a checksum audit).
 */

import { BattleSimulation, type MatchSetupConfig } from "../combat/battle_sim";
import type { ContentRegistry } from "../core/data_models";
import { computeSimChecksum, type SimState } from "../core/sim_state";

export interface ReplayFramePair {
  tick: number;
  p1: number;
  p2: number;
}

export interface MatchReplayData {
  version: string;
  recordedAt: string;
  setup: MatchSetupConfig;
  frames: ReplayFramePair[];
  finalChecksum: string;
}

export class ReplayRecorder {
  private readonly setup: MatchSetupConfig;
  private readonly frames: ReplayFramePair[] = [];

  constructor(setup: MatchSetupConfig) {
    this.setup = { ...setup };
  }

  public recordTick(tick: number, p1: number, p2: number): void {
    this.frames.push({ tick, p1, p2 });
  }

  public finalize(finalChecksum: string): MatchReplayData {
    return {
      version: "2.0.0",
      recordedAt: new Date().toISOString(),
      setup: { ...this.setup },
      frames: this.frames.map((f) => ({ ...f })),
      finalChecksum,
    };
  }

  public getFrameCount(): number {
    return this.frames.length;
  }
}

/** Play back a `MatchReplayData` deterministically and verify checksum integrity. */
export function verifyReplayDeterminism(
  registry: ContentRegistry,
  replay: MatchReplayData,
): { matched: boolean; actualChecksum: string; finalState: SimState } {
  const sim = new BattleSimulation(registry, replay.setup);
  for (const fr of replay.frames) {
    sim.step(fr.p1, fr.p2);
  }
  const actualChecksum = sim.getChecksum();
  return {
    matched: actualChecksum === replay.finalChecksum,
    actualChecksum,
    finalState: sim.saveState(),
  };
}

interface SnapshotSlot {
  tick: number;
  state: SimState;
}

export interface RollbackStats {
  simulatedTicks: number;
  rollbackCount: number;
  totalResimulatedFrames: number;
  maxRollbackDepth: number;
  checksumMismatches: number;
  lastChecksum: string;
}

/**
 * Rollback Netcode Session with `RepeatLast` input prediction and configurable simulated remote delay.
 * Runs live in `Rollback Lab` mode or headless in Vitest to prove zero-desync determinism!
 */
export class RollbackNetSession {
  public readonly sim: BattleSimulation;
  public readonly maxRollbackWindow: number;
  private readonly snapshots: SnapshotSlot[] = [];
  private readonly confirmedP1 = new Map<number, number>();
  private readonly confirmedP2 = new Map<number, number>();
  private readonly predictedP2 = new Map<number, number>();
  private readonly pendingRemoteQueue: Array<{ deliverAtTick: number; targetTick: number; mask: number }> = [];

  public remoteDelayFrames: number;
  public stats: RollbackStats = {
    simulatedTicks: 0,
    rollbackCount: 0,
    totalResimulatedFrames: 0,
    maxRollbackDepth: 0,
    checksumMismatches: 0,
    lastChecksum: "",
  };

  constructor(registry: ContentRegistry, setup: MatchSetupConfig, remoteDelayFrames = 3, maxRollbackWindow = 12) {
    this.sim = new BattleSimulation(registry, setup);
    this.remoteDelayFrames = Math.max(0, Math.min(8, remoteDelayFrames));
    this.maxRollbackWindow = maxRollbackWindow;
    this.saveRingSnapshot(0, this.sim.saveState());
  }

  /** Advance one local frame with local P1 input and delayed/predicted remote P2 input. */
  public advanceFrame(localP1Input: number, actualRemoteP2Input: number): void {
    const nextTick = this.sim.state.tick + 1;
    this.confirmedP1.set(nextTick, localP1Input);

    // Enqueue remote P2 input to arrive after `remoteDelayFrames`
    this.pendingRemoteQueue.push({
      deliverAtTick: nextTick + this.remoteDelayFrames,
      targetTick: nextTick,
      mask: actualRemoteP2Input,
    });

    // Deliver any remote packets arriving on `nextTick` and detect mispredictions
    let earliestMispredictedTick: number | null = null;
    const remainingQueue: typeof this.pendingRemoteQueue = [];
    for (const pkt of this.pendingRemoteQueue) {
      if (pkt.deliverAtTick <= nextTick) {
        this.confirmedP2.set(pkt.targetTick, pkt.mask);
        if (pkt.targetTick < nextTick) {
          const pred = this.predictedP2.get(pkt.targetTick) ?? 0;
          if (pred !== pkt.mask) {
            if (earliestMispredictedTick === null || pkt.targetTick < earliestMispredictedTick) {
              earliestMispredictedTick = pkt.targetTick;
            }
          }
        }
      } else {
        remainingQueue.push(pkt);
      }
    }
    this.pendingRemoteQueue.length = 0;
    this.pendingRemoteQueue.push(...remainingQueue);

    // Perform Rollback & Re-simulation if a past prediction was wrong!
    if (earliestMispredictedTick !== null) {
      const restoreTick = earliestMispredictedTick - 1;
      const snap = this.findSnapshot(restoreTick);
      if (snap) {
        const depth = nextTick - earliestMispredictedTick;
        this.stats.rollbackCount += 1;
        this.stats.maxRollbackDepth = Math.max(this.stats.maxRollbackDepth, depth);
        this.sim.loadState(snap.state);

        for (let t = earliestMispredictedTick; t < nextTick; t++) {
          const p1 = this.confirmedP1.get(t) ?? 0;
          const p2 = this.resolveP2InputForTick(t);
          this.sim.step(p1, p2);
          this.saveRingSnapshot(t, this.sim.saveState());
          this.stats.totalResimulatedFrames += 1;
        }
      }
    }

    // Step `nextTick` using confirmed or `RepeatLast` predicted P2 input
    const p2Now = this.resolveP2InputForTick(nextTick);
    this.sim.step(localP1Input, p2Now);
    this.saveRingSnapshot(nextTick, this.sim.saveState());

    this.stats.simulatedTicks += 1;
    this.stats.lastChecksum = computeSimChecksum(this.sim.state);
  }

  /** Flush all remaining in-flight remote packets so final state matches zero-delay ground truth. */
  public flushPendingPackets(): void {
    if (this.pendingRemoteQueue.length === 0) return;
    let earliestMispredict: number | null = null;
    const currentTick = this.sim.state.tick;

    for (const pkt of this.pendingRemoteQueue) {
      this.confirmedP2.set(pkt.targetTick, pkt.mask);
      const pred = this.predictedP2.get(pkt.targetTick) ?? 0;
      if (pred !== pkt.mask) {
        if (earliestMispredict === null || pkt.targetTick < earliestMispredict) {
          earliestMispredict = pkt.targetTick;
        }
      }
    }
    this.pendingRemoteQueue.length = 0;

    if (earliestMispredict !== null) {
      const snap = this.findSnapshot(earliestMispredict - 1);
      if (snap) {
        this.stats.rollbackCount += 1;
        this.sim.loadState(snap.state);
        for (let t = earliestMispredict; t <= currentTick; t++) {
          const p1 = this.confirmedP1.get(t) ?? 0;
          const p2 = this.confirmedP2.get(t) ?? 0;
          this.sim.step(p1, p2);
          this.saveRingSnapshot(t, this.sim.saveState());
          this.stats.totalResimulatedFrames += 1;
        }
        this.stats.lastChecksum = computeSimChecksum(this.sim.state);
      }
    }
  }

  private resolveP2InputForTick(tick: number): number {
    if (this.confirmedP2.has(tick)) {
      const actual = this.confirmedP2.get(tick)!;
      this.predictedP2.set(tick, actual);
      return actual;
    }
    // RepeatLast prediction heuristic
    const prev = tick > 1 ? (this.predictedP2.get(tick - 1) ?? 0) : 0;
    this.predictedP2.set(tick, prev);
    return prev;
  }

  private saveRingSnapshot(tick: number, state: SimState): void {
    const existingIdx = this.snapshots.findIndex((s) => s.tick === tick);
    if (existingIdx >= 0) {
      this.snapshots[existingIdx] = { tick, state };
    } else {
      this.snapshots.push({ tick, state });
      while (this.snapshots.length > this.maxRollbackWindow + 4) {
        this.snapshots.shift();
      }
    }
  }

  private findSnapshot(tick: number): SnapshotSlot | undefined {
    return this.snapshots.find((s) => s.tick === tick);
  }
}
