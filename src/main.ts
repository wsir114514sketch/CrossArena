/**
 * CrossArena Main Application Entry (`src/main.ts`).
 *
 * Connects:
 * - ContentRegistry Loader (`/content_index.json` + `/ip_content/<ip>/`)
 * - Arcade Title Screen (`ARCADE VS CPU`, `LOCAL 2P VERSUS`, `TRAINING DOJO`, `ROLLBACK & REPLAY LAB`)
 * - 4-Layer Dual-IP Select Screen (`SelectScreen`)
 * - 60Hz Fixed-Timestep Deterministic `BattleSimulation` / `RollbackNetSession` + `ReplayRecorder`
 * - Nearest-Neighbor `BattleEntityRenderer` + `StageRenderer` + `BattleHud` + `AudioEngine`
 */

import { TacticalAiController } from "../ai_system/tactical_ai";
import { BattleEntityRenderer, SpriteAssetCache } from "../animation/fighter_renderer";
import { BattleSimulation, type MatchSetupConfig } from "../combat/battle_sim";
import { STAGE_FLOOR_Y, StageRenderer, VIEWPORT_H, VIEWPORT_W } from "../combat/stage_renderer";
import { loadContentRegistry } from "../core/data_loader";
import type { ContentRegistry } from "../core/data_models";
import { SIM_HZ } from "../core/fixed_math";
import {
  INPUT_BLOCK,
  INPUT_DOWN,
  INPUT_LEFT,
  INPUT_NONE,
  INPUT_RIGHT,
  INPUT_UP,
} from "../core/input_bits";
import {
  type MatchReplayData,
  ReplayRecorder,
  RollbackNetSession,
  verifyReplayDeterminism,
} from "../network/net_session";
import { AudioEngine } from "../ui/audio_engine";
import { BattleHud, type TrainingDummyMode } from "../ui/battle_hud";
import { InputCollector } from "../ui/input_collector";
import {
  type ClickHotspot,
  type ConfirmedMatchParticipants,
  type GameMode,
  SelectScreen,
} from "../ui/select_screen";

type AppScreen = "LOADING" | "TITLE" | "SELECT" | "BATTLE" | "ERROR";

class CrossArenaApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly input = new InputCollector();
  private readonly audio = new AudioEngine();
  private readonly cache = new SpriteAssetCache();
  private readonly stageRenderer = new StageRenderer();
  private readonly entityRenderer = new BattleEntityRenderer(this.cache);
  private readonly hud = new BattleHud(this.cache);

  public screen: AppScreen = "LOADING";
  public registry: ContentRegistry | null = null;
  public selectScreen: SelectScreen | null = null;
  public mode: GameMode = "VERSUS_CPU";
  public sim: BattleSimulation | null = null;
  public rollbackSession: RollbackNetSession | null = null;
  public replayRecorder: ReplayRecorder | null = null;
  public lastReplay: MatchReplayData | null = null;
  public aiP2 = new TacticalAiController(1, "NORMAL");

  public dummyMode: TrainingDummyMode = "STAND";
  public paused = false;
  private currentParticipants: ConfirmedMatchParticipants | null = null;
  private titleCursor = 0;
  private titleHotspots: ClickHotspot[] = [];
  private errorMessage = "";

  private lastRafMs = 0;
  private accumulatorSec = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context unavailable");
    }
    this.ctx = context;
    this.ctx.imageSmoothingEnabled = false;
  }

  public async init(): Promise<void> {
    this.input.attach();
    this.canvas.addEventListener("pointerdown", (ev) => {
      this.audio.unlock();
      const rect = this.canvas.getBoundingClientRect();
      const cx = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * VIEWPORT_W;
      const cy = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * VIEWPORT_H;
      this.onCanvasClick(cx, cy);
    });

    try {
      this.registry = await loadContentRegistry({ includeTestPacks: false, includeLockedIps: false });
      for (const ip of this.registry.ips) {
        this.cache.get(`/ip_content/${ip.id}/${ip.cover}`);
      }
      this.selectScreen = new SelectScreen(this.registry, this.cache, this.audio);
      this.screen = "TITLE";
    } catch (err) {
      this.screen = "ERROR";
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }

    this.lastRafMs = performance.now();
    requestAnimationFrame((t) => this.frameLoop(t));
  }

  public startMatch(participants: ConfirmedMatchParticipants): void {
    if (!this.registry) return;
    this.currentParticipants = participants;
    this.aiP2 = new TacticalAiController(1, participants.aiDifficulty);
    this.paused = false;
    this.dummyMode = "STAND";
    this.audio.resetMatchAudioHistory();
    this.entityRenderer.resetVfx();
    this.stageRenderer.resetCamera();

    const setup: MatchSetupConfig = {
      p1FighterId: participants.p1FighterId,
      p2FighterId: participants.p2FighterId,
      p1AssistId: participants.p1AssistId,
      p2AssistId: participants.p2AssistId,
      trainingMode: this.mode === "TRAINING",
      infiniteTime: this.mode === "TRAINING",
      seed: 0x2026cafe8899n,
    };

    if (this.mode === "ROLLBACK_LAB") {
      this.rollbackSession = new RollbackNetSession(this.registry, setup, 3, 14);
      this.sim = this.rollbackSession.sim;
    } else {
      this.rollbackSession = null;
      this.sim = new BattleSimulation(this.registry, setup);
    }

    this.replayRecorder = new ReplayRecorder(setup);
    const f0 = this.sim.state.fighters[0];
    const f1 = this.sim.state.fighters[1];
    // Preload base, active, and any reachable awakening form sprite sheets so transformations have zero async decode flash
    for (const fid of [f0.activeFighterId, f1.activeFighterId]) {
      const b = this.registry.fightersById[fid];
      if (!b) continue;
      this.cache.preloadFighterBundle(b);
      for (const sk of b.skills) {
        if (sk.target_form_id && this.registry.fightersById[sk.target_form_id]) {
          this.cache.preloadFighterBundle(this.registry.fightersById[sk.target_form_id]!);
        }
      }
    }
    for (const aid of [f0.assistId, f1.assistId]) {
      if (aid && this.registry.assistsById[aid]) {
        this.cache.preloadAssistBundle(this.registry.assistsById[aid]!);
      }
    }
    this.hud.resetForMatch(f0.maxHp, f1.maxHp);
    this.screen = "BATTLE";
  }

  private onCanvasClick(x: number, y: number): void {
    if (this.screen === "TITLE") {
      for (const h of this.titleHotspots) {
        if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
          this.audio.playUiBlip(660, 0.06);
          h.onClick();
          return;
        }
      }
    } else if (this.screen === "SELECT") {
      this.selectScreen?.handlePointerClick(x, y);
    } else if (this.screen === "BATTLE") {
      this.hud.handlePointerClick(x, y);
    }
  }

  private frameLoop(nowMs: number): void {
    const dt = Math.min(0.1, Math.max(0, (nowMs - this.lastRafMs) / 1000));
    this.lastRafMs = nowMs;

    if (this.screen === "TITLE") {
      this.updateTitleKeyboard();
      this.renderTitleScreen();
    } else if (this.screen === "SELECT") {
      this.selectScreen?.updateKeyboard(this.input);
      this.selectScreen?.render(this.ctx);
    } else if (this.screen === "BATTLE") {
      this.updateBattleGlobalHotkeys();
      if (!this.paused) {
        this.accumulatorSec += dt;
        const fixedStep = 1 / SIM_HZ;
        let safetySteps = 0;
        while (this.accumulatorSec >= fixedStep && safetySteps < 4) {
          this.stepBattleTick();
          this.accumulatorSec -= fixedStep;
          safetySteps += 1;
        }
      }
      this.renderBattleScreen();
    } else {
      this.renderLoadingOrError();
    }

    requestAnimationFrame((t) => this.frameLoop(t));
  }

  private updateTitleKeyboard(): void {
    const modes: GameMode[] = ["VERSUS_CPU", "VERSUS_2P", "TRAINING", "ROLLBACK_LAB"];
    if (this.input.consumeJustPressed("KeyW") || this.input.consumeJustPressed("ArrowUp")) {
      this.titleCursor = (this.titleCursor + modes.length - 1) % modes.length;
      this.audio.playUiBlip(520, 0.04);
    }
    if (this.input.consumeJustPressed("KeyS") || this.input.consumeJustPressed("ArrowDown")) {
      this.titleCursor = (this.titleCursor + 1) % modes.length;
      this.audio.playUiBlip(520, 0.04);
    }
    if (
      this.input.consumeJustPressed("KeyJ") ||
      this.input.consumeJustPressed("Enter") ||
      this.input.consumeJustPressed("Space")
    ) {
      this.audio.playUiBlip(720, 0.06);
      this.enterCharacterSelect(modes[this.titleCursor]!);
    }
  }

  private enterCharacterSelect(mode: GameMode): void {
    if (!this.selectScreen) return;
    this.mode = mode;
    this.input.clearUiJustPressed();
    this.selectScreen.open(
      mode,
      (confirmed) => this.startMatch(confirmed),
      () => {
        this.screen = "TITLE";
      },
    );
    this.screen = "SELECT";
  }

  private updateBattleGlobalHotkeys(): void {
    if (this.input.consumeJustPressed("F2")) {
      this.entityRenderer.showDebugBoxes = !this.entityRenderer.showDebugBoxes;
    }
    if (this.mode === "TRAINING" && this.input.consumeJustPressed("F3")) {
      this.cycleTrainingDummy();
    }
    if (this.mode === "TRAINING" && this.input.consumeJustPressed("KeyR")) {
      this.resetTrainingState();
    }
    if (this.sim?.state.phase === "MATCH_OVER") {
      if (this.input.consumeJustPressed("Enter")) {
        if (this.currentParticipants) this.startMatch(this.currentParticipants);
      } else if (this.input.consumeJustPressed("KeyC")) {
        this.enterCharacterSelect(this.mode);
      } else if (this.input.consumeJustPressed("KeyV")) {
        this.verifyAndExportReplay();
      } else if (this.input.consumeJustPressed("Escape")) {
        this.screen = "TITLE";
      }
      return;
    }

    if (this.input.consumeJustPressed("Escape")) {
      this.paused = !this.paused;
    }
  }

  private stepBattleTick(): void {
    if (!this.sim || !this.registry) return;
    const state = this.sim.state;
    const p1Mask = this.input.readPlayerMask(0);
    let p2Mask = INPUT_NONE;

    if (this.mode === "VERSUS_2P") {
      p2Mask = this.input.readPlayerMask(1);
    } else if (this.mode === "TRAINING") {
      p2Mask = this.computeTrainingDummyMask();
    } else {
      p2Mask = this.aiP2.computeInput(state, this.registry);
    }

    if (this.rollbackSession) {
      this.rollbackSession.advanceFrame(p1Mask, p2Mask);
    } else {
      this.sim.step(p1Mask, p2Mask);
    }

    if (this.replayRecorder && state.phase !== "MATCH_OVER") {
      this.replayRecorder.recordTick(this.sim.state.tick, p1Mask, p2Mask);
    }

    this.audio.consumeSimEvents(this.sim.state.events);
    this.entityRenderer.ingestEvents(this.sim.state.events, this.sim.state.tick);
    this.hud.ingestEvents(this.sim.state.events, this.sim.state.tick);
  }

  private computeTrainingDummyMask(): number {
    if (!this.sim || !this.registry) return INPUT_NONE;
    const s = this.sim.state;
    const p2 = s.fighters[1];
    const p1 = s.fighters[0];
    const backBit = p2.facing > 0 ? INPUT_LEFT : INPUT_RIGHT;

    switch (this.dummyMode) {
      case "STAND":
        return INPUT_NONE;
      case "CROUCH":
        return INPUT_DOWN;
      case "JUMP":
        return s.tick % 45 === 0 ? INPUT_UP : INPUT_NONE;
      case "AUTO_GUARD": {
        const p1Bundle = this.registry.fightersById[p1.activeFighterId]!;
        const p1Fd = p1.currentMoveId ? p1Bundle.framedata[p1.currentMoveId] : undefined;
        const lowAtk = p1Fd?.hitboxes?.some((h) => h.guard_type === "low") ?? false;
        return lowAtk ? backBit | INPUT_DOWN | INPUT_BLOCK : backBit | INPUT_BLOCK;
      }
      case "CPU":
        return this.aiP2.computeInput(s, this.registry);
    }
  }

  private cycleTrainingDummy(): void {
    const order: TrainingDummyMode[] = ["STAND", "CROUCH", "JUMP", "AUTO_GUARD", "CPU"];
    const idx = order.indexOf(this.dummyMode);
    this.dummyMode = order[(idx + 1) % order.length]!;
  }

  private resetTrainingState(): void {
    if (this.currentParticipants) {
      this.startMatch(this.currentParticipants);
    }
  }

  private verifyAndExportReplay(): void {
    if (!this.sim || !this.registry || !this.replayRecorder) return;
    if (this.rollbackSession) {
      this.rollbackSession.flushPendingPackets();
    }
    const replay = this.replayRecorder.finalize(this.sim.getChecksum());
    this.lastReplay = replay;
    const check = verifyReplayDeterminism(this.registry, replay);
    this.hud.showToast(
      check.matched
        ? `录像回放校验 100% 一致 (${replay.frames.length} 帧 · Checksum 0x${check.actualChecksum})`
        : `校验异常: ${check.actualChecksum}`,
    );
  }

  private renderBattleScreen(): void {
    if (!this.sim || !this.registry || !this.currentParticipants) return;
    const state = this.sim.state;
    const stageIp =
      this.registry.ips.find((ip) => ip.id === this.currentParticipants!.stageIpId) ??
      this.registry.ips[0]!;

    const cam = this.stageRenderer.computeCamera(state, this.registry.combatConfig);
    this.stageRenderer.renderBackdropAndFloor(
      this.ctx,
      state,
      stageIp,
      this.registry.combatConfig,
      cam,
    );

    this.ctx.save();
    this.stageRenderer.applyWorldTransform(this.ctx, cam);
    this.entityRenderer.renderEntities(this.ctx, state, this.registry, STAGE_FLOOR_Y);
    this.ctx.restore();

    this.hud.render(this.ctx, state, this.registry, this.mode, {
      dummyMode: this.dummyMode,
      onCycleDummy: () => this.cycleTrainingDummy(),
      showBoxes: this.entityRenderer.showDebugBoxes,
      onToggleBoxes: () => {
        this.entityRenderer.showDebugBoxes = !this.entityRenderer.showDebugBoxes;
      },
      onResetTraining: () => this.resetTrainingState(),
      rollbackStats: this.rollbackSession?.stats,
      paused: this.paused,
      settlement: {
        onRematch: () => {
          if (this.currentParticipants) this.startMatch(this.currentParticipants);
        },
        onCharSelect: () => this.enterCharacterSelect(this.mode),
        onExportReplay: () => this.verifyAndExportReplay(),
        onMainMenu: () => {
          this.paused = false;
          this.screen = "TITLE";
        },
      },
    });
  }

  private renderTitleScreen(): void {
    const ctx = this.ctx;
    this.titleHotspots = [];
    ctx.imageSmoothingEnabled = false;

    const grad = ctx.createLinearGradient(0, 0, VIEWPORT_W, VIEWPORT_H);
    grad.addColorStop(0, "#070b14");
    grad.addColorStop(0.5, "#131c31");
    grad.addColorStop(1, "#090d16");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);

    // Dual-IP Cover Showcase Cards in background wings
    if (this.registry && this.registry.ips.length >= 2) {
      const ipLeft = this.registry.ips[0]!;
      const ipRight = this.registry.ips[1]!;
      const cLeft = this.cache.get(`/ip_content/${ipLeft.id}/${ipLeft.cover}`);
      const cRight = this.cache.get(`/ip_content/${ipRight.id}/${ipRight.cover}`);
      ctx.save();
      ctx.globalAlpha = 0.42;
      if (cLeft) ctx.drawImage(cLeft, 48, 160, 380, 220);
      if (cRight) ctx.drawImage(cRight, VIEWPORT_W - 428, 160, 380, 220);
      ctx.restore();
    }

    // Main Arcade Emblem
    ctx.textAlign = "center";
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 16px 'Segoe UI', sans-serif";
    ctx.fillText("COMPACT 2D DUAL-IP ANIME ARCADE FIGHTER · 60HZ DETERMINISTIC ENGINE", VIEWPORT_W * 0.5, 112);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "italic bold 74px 'Segoe UI', sans-serif";
    ctx.fillText("CROSS ARENA", VIEWPORT_W * 0.5, 192);

    if (this.registry) {
      const ipNames = this.registry.ips.map((i) => i.name_zh).join("  ×  ");
      ctx.fillStyle = "#38bdf8";
      ctx.font = "bold 24px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(`${ipNames}  —  紧凑街机格斗正式版`, VIEWPORT_W * 0.5, 238);
    }

    const menuItems: Array<{ mode: GameMode; title: string; desc: string }> = [
      { mode: "VERSUS_CPU", title: "街机对战 ARCADE VS CPU", desc: "单人挑战战术 AI（支持三档难度、局内觉醒变身与援助召唤）" },
      { mode: "VERSUS_2P", title: "本地双人 LOCAL 2P VERSUS", desc: "同屏键盘 / 双手柄零延迟街机立回与连段博弈" },
      { mode: "TRAINING", title: "格斗训练房 TRAINING DOJO", desc: "实时帧数据 / 有利帧差 / 碰撞框可视化（F2）与木桩防御演练" },
      { mode: "ROLLBACK_LAB", title: "回滚同步实验室 ROLLBACK LAB", desc: "模拟远程网络延迟 + RepeatLast 输入预测 + 帧快照回滚校验" },
    ];

    menuItems.forEach((item, idx) => {
      const bx = VIEWPORT_W * 0.5 - 270;
      const by = 286 + idx * 82;
      const bw = 540;
      const bh = 68;
      const active = this.titleCursor === idx;

      ctx.fillStyle = active ? "rgba(30, 41, 59, 0.96)" : "rgba(15, 23, 42, 0.84)";
      ctx.strokeStyle = active ? "#fbbf24" : "#334155";
      ctx.lineWidth = active ? 3 : 1.5;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);

      ctx.fillStyle = active ? "#fbbf24" : "#f8fafc";
      ctx.font = "bold 20px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(item.title, VIEWPORT_W * 0.5, by + 30);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(item.desc, VIEWPORT_W * 0.5, by + 54);

      this.titleHotspots.push({
        x: bx,
        y: by,
        w: bw,
        h: bh,
        onClick: () => {
          this.titleCursor = idx;
          this.enterCharacterSelect(item.mode);
        },
      });
    });

    // Bottom Keybinding Summary
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "13px 'Microsoft YaHei UI', sans-serif";
    ctx.fillText(
      "P1 键位: WASD 移动/跳/蹲 · J轻 K中 U重 · I/O/P 招牌技 · H 必杀 · N 觉醒 · M 援助 · L 冲刺 · ; 防御 · Y 投技  |  F2 判定框调试",
      VIEWPORT_W * 0.5,
      VIEWPORT_H - 26,
    );
  }

  private renderLoadingOrError(): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);
    ctx.textAlign = "center";
    ctx.fillStyle = this.screen === "ERROR" ? "#f43f5e" : "#38bdf8";
    ctx.font = "bold 22px 'Microsoft YaHei UI', sans-serif";
    ctx.fillText(
      this.screen === "ERROR"
        ? `加载失败: ${this.errorMessage}`
        : "正在加载双 IP 角色图集与确定性战斗引擎...",
      VIEWPORT_W * 0.5,
      VIEWPORT_H * 0.5,
    );
  }
}

declare global {
  interface Window {
    __CROSS_ARENA__?: CrossArenaApp;
  }
}

const canvasEl = document.getElementById("game-canvas") as HTMLCanvasElement | null;
if (canvasEl) {
  const app = new CrossArenaApp(canvasEl);
  window.__CROSS_ARENA__ = app;
  void app.init();
}
