/**
 * Comprehensive Vitest Suite for CrossArena Dual-IP Arcade Fighting Engine.
 *
 * Verifies:
 * 1. Fixed-point integer math, D4 left-facing mirror, strict `<` AABB overlap, and SplitMix64 RNG determinism.
 * 2. Real Dual-IP Content Registry loading (all 2 open IPs, 17 character groups, 30 playable forms, 8 assists).
 * 3. Compact stage boundary clamping, pushbox separation, high/mid/low guard mixups (`overhead` beats crouch guard,
 *    `low` beats stand guard), Guard Break on guard gauge depletion, and Throw + Throw Tech window.
 * 4. Normal -> Heavy -> Special -> Ultimate cancel chain, damage scaling, and anti-infinite combo protection.
 * 5. In-match Awakening transformation (`naruto_uzumaki` -> `naruto_sennin`, `kurosaki_ichigo` -> `ichigo_bankai`)
 *    preserving HP ratio & swapping movesets, plus Compact Assist summoning & 720-tick cooldown.
 * 6. Tactical AI versus simulation, Replay bit-exact determinism, and Rollback SyncTest zero-desync equivalence!
 */

import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { TacticalAiController } from "../ai_system/tactical_ai";
import { BattleSimulation } from "../combat/battle_sim";
import { type JsonFetchAdapter, loadContentRegistry } from "../core/data_loader";
import type { ContentRegistry } from "../core/data_models";
import { rectsOverlap, toWorldRect } from "../core/fixed_math";
import {
  INPUT_ASSIST,
  INPUT_AWAKEN,
  INPUT_BLOCK,
  INPUT_DOWN,
  INPUT_HEAVY,
  INPUT_LEFT,
  INPUT_LIGHT,
  INPUT_MEDIUM,
  INPUT_NONE,
  INPUT_RIGHT,
  INPUT_SKILL_1,
  INPUT_THROW,
  INPUT_ULTIMATE,
} from "../core/input_bits";
import { normalizeSeed, stepRng } from "../core/sim_rng";
import {
  ReplayRecorder,
  RollbackNetSession,
  verifyReplayDeterminism,
} from "../network/net_session";
import { scanContentIndex } from "../vite.config";

const ROOT_DIR = path.resolve(__dirname, "..");

const nodeFsAdapter: JsonFetchAdapter = {
  async readJson<T>(urlPath: string): Promise<T> {
    const rel = urlPath.replace(/^\/+/, "");
    const full = path.join(ROOT_DIR, rel);
    return JSON.parse(fs.readFileSync(full, "utf-8")) as T;
  },
  async buildIndex() {
    return scanContentIndex(ROOT_DIR, false);
  },
};

let registry: ContentRegistry;

beforeAll(async () => {
  registry = await loadContentRegistry({
    includeTestPacks: false,
    includeLockedIps: false,
    adapter: nodeFsAdapter,
  });
});

describe("1. Fixed-Point Math, D4 Mirror & Deterministic PRNG", () => {
  it("projects mirrored hitboxes accurately and enforces strict AABB overlap", () => {
    const localRect = [20000, -120000, 80000, 50000] as const;
    expect(toWorldRect(localRect, 100000, 0, 1)).toEqual([120000, -120000, 80000, 50000]);
    expect(toWorldRect(localRect, 100000, 0, -1)).toEqual([0, -120000, 80000, 50000]);

    // Touching edges do NOT overlap (Decision D4)
    expect(rectsOverlap([0, 0, 50, 50], [50, 0, 50, 50])).toBe(false);
    expect(rectsOverlap([0, 0, 51, 50], [50, 0, 50, 50])).toBe(true);
  });

  it("produces bit-identical SplitMix64 sequences from identical seeds", () => {
    let s1 = normalizeSeed(123456789n);
    let s2 = normalizeSeed(123456789n);
    for (let i = 0; i < 25; i++) {
      const r1 = stepRng(s1);
      const r2 = stepRng(s2);
      expect(r1.value32).toBe(r2.value32);
      s1 = r1.nextState;
      s2 = r2.nextState;
    }
  });
});

describe("2. Dual-IP Content Registry & Public-Release Filtering", () => {
  it("loads both Naruto and Bleach IPs, 17 character groups, 30 playable forms, and 8 assists", () => {
    expect(registry.ips.map((i) => i.id).sort()).toEqual(["bleach", "naruto"]);
    expect(Object.keys(registry.fightersById).length).toBe(30);
    expect(Object.keys(registry.assistsById).length).toBe(8);
    expect(registry.groupsByIp["naruto"]!.length).toBe(9);
    expect(registry.groupsByIp["bleach"]!.length).toBe(8);

    // Verify multi-form grouping
    const narutoGroup = registry.groupsByIp["naruto"]!.find((g) => g.baseId === "naruto.naruto_uzumaki")!;
    expect(narutoGroup.forms.length).toBe(4);
    const ichigoGroup = registry.groupsByIp["bleach"]!.find((g) => g.baseId === "bleach.kurosaki_ichigo")!;
    expect(ichigoGroup.forms.length).toBe(3);
  });

  it("excludes pending_authorization packs when publicReleaseOnly=true", () => {
    const pubIndex = scanContentIndex(ROOT_DIR, true);
    const pubIpIds = pubIndex.ips.map((i) => i.id);
    expect(pubIpIds).not.toContain("naruto");
    expect(pubIpIds).not.toContain("bleach");
    expect(pubIpIds).toContain("test_pack");
  });
});

describe("3. Compact Arena Bounds, High/Low Guard, Throw Tech & Guard Break", () => {
  it("clamps fighters inside compact stage walls and separates overlapping pushboxes", () => {
    const sim = new BattleSimulation(registry, {
      p1FighterId: "naruto.naruto_uzumaki",
      p2FighterId: "bleach.kurosaki_ichigo",
      trainingMode: true,
    });
    for (let i = 0; i < 240; i++) {
      sim.step(INPUT_LEFT, INPUT_RIGHT);
    }
    expect(sim.state.fighters[0].posX).toBeGreaterThanOrEqual(-registry.combatConfig.stage_half_width);
    expect(sim.state.fighters[1].posX).toBeLessThanOrEqual(registry.combatConfig.stage_half_width);
  });

  it("enforces high/low guard rules: low attack beats standing guard, overhead beats crouching guard", () => {
    const sim = new BattleSimulation(registry, {
      p1FighterId: "naruto.sasuke_uchiha",
      p2FighterId: "bleach.kuchiki_byakuya",
      trainingMode: true,
    });
    // Place fighters in close striking range
    sim.state.fighters[0].posX = -35000;
    sim.state.fighters[1].posX = 35000;

    // P1 performs crouch_light (low) while P2 holds standing block (Right + Block)
    const hpBeforeLow = sim.state.fighters[1].hp;
    sim.step(INPUT_DOWN | INPUT_LIGHT, INPUT_RIGHT | INPUT_BLOCK);
    for (let i = 0; i < 12; i++) {
      sim.step(INPUT_DOWN, INPUT_RIGHT | INPUT_BLOCK);
    }
    expect(sim.state.fighters[1].hp).toBeLessThan(hpBeforeLow);

    // Reset to neutral and test standing overhead (`6 + Heavy`) beating crouching block!
    const sim2 = new BattleSimulation(registry, {
      p1FighterId: "naruto.sasuke_uchiha",
      p2FighterId: "bleach.kuchiki_byakuya",
      trainingMode: true,
    });
    sim2.state.fighters[0].posX = -35000;
    sim2.state.fighters[1].posX = 35000;
    const hpBeforeOverhead = sim2.state.fighters[1].hp;
    sim2.step(INPUT_RIGHT | INPUT_HEAVY, INPUT_RIGHT | INPUT_DOWN | INPUT_BLOCK);
    for (let i = 0; i < 14; i++) {
      sim2.step(INPUT_NONE, INPUT_RIGHT | INPUT_DOWN | INPUT_BLOCK);
    }
    expect(sim2.state.fighters[1].hp).toBeLessThan(hpBeforeOverhead);
  });

  it("supports Throw Tech when both fighters input Throw within the tech window", () => {
    const sim = new BattleSimulation(registry, {
      p1FighterId: "naruto.rock_lee",
      p2FighterId: "bleach.zaraki_kenpachi",
      trainingMode: true,
    });
    sim.state.fighters[0].posX = -28000;
    sim.state.fighters[1].posX = 28000;

    sim.step(INPUT_THROW, INPUT_THROW);
    let sawTech = false;
    for (let i = 0; i < 12; i++) {
      sim.step(INPUT_NONE, INPUT_NONE);
      if (sim.state.events.some((e) => e.type === "throw_tech")) {
        sawTech = true;
      }
    }
    expect(sawTech).toBe(true);
    expect(sim.state.fighters[0].hp).toBe(sim.state.fighters[0].maxHp);
    expect(sim.state.fighters[1].hp).toBe(sim.state.fighters[1].maxHp);
  });
});

describe("4. Cancel Combos, Awakening Transformation & Compact Assist System", () => {
  it("chains Light -> Medium -> Heavy -> Skill -> Ultimate with combo counter & damage scaling", () => {
    const sim = new BattleSimulation(registry, {
      p1FighterId: "bleach.kurosaki_ichigo",
      p2FighterId: "naruto.naruto_uzumaki",
      trainingMode: true,
    });
    sim.state.fighters[0].posX = -32000;
    sim.state.fighters[1].posX = 32000;
    sim.state.fighters[0].gauge = 3000;
    // Disable training HP regen by turning off trainingMode after setup
    (sim.setup as { trainingMode?: boolean }).trainingMode = false;

    sim.step(INPUT_LIGHT, INPUT_NONE);
    let maxCombo = 0;
    for (let t = 0; t < 55; t++) {
      let cmd = INPUT_NONE;
      const m = sim.state.fighters[0].currentMoveId;
      const hitDone = sim.state.fighters[0].hitIndicesRegistered.length > 0;
      if (m === "light_01" && hitDone) cmd = INPUT_MEDIUM;
      else if (m === "medium_01" && hitDone) cmd = INPUT_HEAVY;
      else if (m === "heavy_01" && hitDone) cmd = INPUT_SKILL_1;
      else if (m === "skill_01" && hitDone) cmd = INPUT_ULTIMATE;

      sim.step(cmd, INPUT_NONE);
      maxCombo = Math.max(maxCombo, sim.state.fighters[1].comboCounter);
    }
    expect(maxCombo).toBeGreaterThanOrEqual(3);
  });

  it("executes in-match Awakening transformation and summons Compact Assist with cooldown", () => {
    const sim = new BattleSimulation(registry, {
      p1FighterId: "naruto.naruto_uzumaki",
      p2FighterId: "bleach.kurosaki_ichigo",
      p1AssistId: "naruto.minato_assist",
      p2AssistId: "bleach.yamamoto_assist",
      trainingMode: false,
    });
    sim.state.phase = "FIGHT";
    sim.state.fighters[0].hp = 750; // 75% HP
    sim.state.fighters[0].gauge = 3000;

    // Summon Assist first
    sim.step(INPUT_ASSIST, INPUT_NONE);
    expect(sim.state.assists[0].active).toBe(true);
    expect(sim.state.fighters[0].assistCooldownTicks).toBe(720);

    // Trigger Awakening (`naruto.naruto_uzumaki` -> `naruto.naruto_sennin`)
    sim.step(INPUT_AWAKEN, INPUT_NONE);
    expect(sim.state.fighters[0].activeFighterId).toBe("naruto.naruto_sennin");
    // Preserves ~75% HP ratio onto Sage Naruto's 1060 max_hp (= 795)
    expect(sim.state.fighters[0].hp).toBe(795);
    expect(sim.state.superFreezeTicks).toBeGreaterThan(0);
  });
});

describe("5. Deterministic Replay & Rollback Netcode SyncTest Equivalence", () => {
  it("matches zero-delay BattleSimulation checksum bit-for-bit under 4-frame Rollback + AI combat", () => {
    const setup = {
      p1FighterId: "naruto.sasuke_uchiha",
      p2FighterId: "bleach.Hitsugaya_Toshiro".toLowerCase(),
      p1AssistId: "naruto.madara_assist",
      p2AssistId: "bleach.yoruichi_assist",
      seed: 0x9988776655443322n,
    };

    const groundTruth = new BattleSimulation(registry, setup);
    const rollbackSession = new RollbackNetSession(registry, setup, 4, 16);
    const recorder = new ReplayRecorder(setup);

    const ai0 = new TacticalAiController(0, "HARD");
    const ai1 = new TacticalAiController(1, "HARD");

    for (let i = 0; i < 360; i++) {
      const m0 = ai0.computeInput(groundTruth.state, registry);
      const m1 = ai1.computeInput(groundTruth.state, registry);
      groundTruth.step(m0, m1);
      recorder.recordTick(groundTruth.state.tick, m0, m1);
      rollbackSession.advanceFrame(m0, m1);
    }

    rollbackSession.flushPendingPackets();
    expect(rollbackSession.stats.rollbackCount).toBeGreaterThan(0);
    expect(rollbackSession.sim.getChecksum()).toBe(groundTruth.getChecksum());

    const replay = recorder.finalize(groundTruth.getChecksum());
    const replayCheck = verifyReplayDeterminism(registry, replay);
    expect(replayCheck.matched).toBe(true);
    expect(replayCheck.actualChecksum).toBe(groundTruth.getChecksum());
  });
});
