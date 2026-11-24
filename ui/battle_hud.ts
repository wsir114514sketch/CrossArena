/**
 * Classic Arcade Top Battle HUD, Training Dojo Inspector, Rollback Lab Strip & Settlement Overlay.
 *
 * Strictly implements Section 6 (Battle UI & HUD):
 * - Top Arcade Bar: P1 & P2 Portraits, Angled HP Bars + Delayed White/Red Damage Trail,
 *   Guard Gauge sub-bar, Character + Form Name, IP Badge, Round Win Diamonds,
 *   Top Multi-Stock Super / Awakening Gauge Bars, Assist Portrait + Cooldown Indicator,
 *   and Center 99s Countdown Timer + Round Counter.
 * - Mid-Screen: P1/P2 Combo Hit & Total Damage Counter + Technical Callouts (`COUNTER!`,
 *   `GUARD BREAK!`, `SUPER CANCEL!`, `AWAKENING!`, `THROW TECH!`).
 * - Training Mode Bar: Live Startup/Active/Recovery, Frame Advantage (`+/-`), Dummy Posture switcher,
 *   Hitbox Box toggle, Position Reset, Meter Refill.
 * - Match Settlement Overlay: Winner Standee + Victory Quote + `REMATCH / CHARACTER SELECT / SAVE REPLAY / MAIN MENU`.
 */

import type { SpriteAssetCache } from "../animation/fighter_renderer";
import { VIEWPORT_H, VIEWPORT_W } from "../combat/stage_renderer";
import type { ContentRegistry } from "../core/data_models";
import { SIM_HZ } from "../core/fixed_math";
import type { FighterSimState, SimEvent, SimState } from "../core/sim_state";
import type { RollbackStats } from "../network/net_session";
import type { ClickHotspot, GameMode } from "./select_screen";

export type TrainingDummyMode = "STAND" | "CROUCH" | "JUMP" | "AUTO_GUARD" | "CPU";

export interface SettlementActions {
  onRematch: () => void;
  onCharSelect: () => void;
  onExportReplay: () => void;
  onMainMenu: () => void;
}

interface ActiveCallout {
  text: string;
  slot: 0 | 1;
  age: number;
  maxAge: number;
}

export class BattleHud {
  private readonly cache: SpriteAssetCache;
  private trailHp: [number, number] = [1000, 1000];
  private readonly callouts: ActiveCallout[] = [];
  private lastEventTick = -1;
  private hotspots: ClickHotspot[] = [];
  public replayBannerText = "";
  private replayBannerTimer = 0;

  constructor(cache: SpriteAssetCache) {
    this.cache = cache;
  }

  public resetForMatch(p1MaxHp: number, p2MaxHp: number): void {
    this.trailHp = [p1MaxHp, p2MaxHp];
    this.callouts.length = 0;
    this.lastEventTick = -1;
    this.replayBannerTimer = 0;
  }

  public showToast(msg: string): void {
    this.replayBannerText = msg;
    this.replayBannerTimer = 180;
  }

  public handlePointerClick(x: number, y: number): boolean {
    for (let i = this.hotspots.length - 1; i >= 0; i--) {
      const h = this.hotspots[i]!;
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        h.onClick();
        return true;
      }
    }
    return false;
  }

  public ingestEvents(events: readonly SimEvent[], tick: number): void {
    if (tick !== this.lastEventTick) {
      for (const c of this.callouts) c.age += 1;
      for (let i = this.callouts.length - 1; i >= 0; i--) {
        if (this.callouts[i]!.age >= this.callouts[i]!.maxAge) {
          this.callouts.splice(i, 1);
        }
      }
      if (this.replayBannerTimer > 0) this.replayBannerTimer -= 1;
      this.lastEventTick = tick;
    }

    for (const ev of events) {
      if (ev.text) {
        this.callouts.push({
          text: ev.text,
          slot: ev.slot,
          age: 0,
          maxAge: 52,
        });
      }
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    registry: ContentRegistry,
    mode: GameMode,
    options: {
      dummyMode: TrainingDummyMode;
      onCycleDummy: () => void;
      showBoxes: boolean;
      onToggleBoxes: () => void;
      onResetTraining: () => void;
      rollbackStats?: RollbackStats;
      paused: boolean;
      settlement: SettlementActions;
    },
  ): void {
    this.hotspots = [];
    ctx.imageSmoothingEnabled = false;

    const f0 = state.fighters[0];
    const f1 = state.fighters[1];

    // Smoothly decay white/red damage trail when fighter leaves hitstun
    for (const slot of [0, 1] as const) {
      const f = state.fighters[slot];
      if (f.hp > this.trailHp[slot]) {
        this.trailHp[slot] = f.hp;
      } else if (f.comboCounter === 0 && this.trailHp[slot] > f.hp) {
        this.trailHp[slot] = Math.max(f.hp, this.trailHp[slot] - 8);
      }
    }

    // 1. Top Arcade Header Backdrop
    const topGrad = ctx.createLinearGradient(0, 0, 0, 128);
    topGrad.addColorStop(0, "rgba(6, 9, 18, 0.88)");
    topGrad.addColorStop(1, "rgba(6, 9, 18, 0.0)");
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, VIEWPORT_W, 128);

    // 2. P1 (Left) & P2 (Right) Fighter Status Clusters
    this.renderFighterTopCluster(ctx, state, registry, f0, true);
    this.renderFighterTopCluster(ctx, state, registry, f1, false);

    // 3. Center Arcade Timer & Round Indicator
    this.renderCenterTimer(ctx, state, mode === "TRAINING");

    // 4. Mid-screen Combo Hit Counters & Technical Callouts
    this.renderComboAndCallouts(ctx, state);

    // 5. Mode-specific Inspector Strips (Training Dojo or Rollback Lab)
    if (mode === "TRAINING") {
      this.renderTrainingStrip(ctx, state, options);
    } else if (mode === "ROLLBACK_LAB" && options.rollbackStats) {
      this.renderRollbackStrip(ctx, options.rollbackStats);
    }

    // 6. Round Banner (`ROUND N` / `K.O.!`)
    if (state.phase === "INTRO") {
      this.renderCenterSplashText(ctx, `ROUND ${state.roundNumber}`, "READY...", "#fbbf24");
    } else if (state.phase === "KO_FREEZE") {
      const koTitle =
        state.fighters[0].hp <= 0 || state.fighters[1].hp <= 0 ? "K. O. !" : "TIME OVER";
      this.renderCenterSplashText(ctx, koTitle, "", "#f43f5e");
    }

    // 7. Toast notification (Replay saved/verified)
    if (this.replayBannerTimer > 0 && this.replayBannerText) {
      ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
      ctx.strokeStyle = "#4ade80";
      ctx.lineWidth = 2;
      ctx.fillRect(VIEWPORT_W * 0.5 - 240, 124, 480, 36);
      ctx.strokeRect(VIEWPORT_W * 0.5 - 240, 124, 480, 36);
      ctx.fillStyle = "#4ade80";
      ctx.font = "bold 14px 'Microsoft YaHei UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(this.replayBannerText, VIEWPORT_W * 0.5, 147);
    }

    // 8. Pause or Match Settlement Overlay
    if (state.phase === "MATCH_OVER") {
      this.renderMatchSettlementOverlay(ctx, state, registry, options.settlement);
    } else if (options.paused) {
      this.renderPauseOverlay(ctx, options.settlement);
    }
  }

  private renderFighterTopCluster(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    registry: ContentRegistry,
    f: FighterSimState,
    isLeft: boolean,
  ): void {
    const b = registry.fightersById[f.activeFighterId]!;
    const accent = b.ip.theme?.primary_hex ?? (isLeft ? "#38bdf8" : "#f43f5e");
    const portraitSize = 68;
    const px = isLeft ? 20 : VIEWPORT_W - 20 - portraitSize;
    const py = 16;

    // Portrait frame
    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.fillRect(px, py, portraitSize, portraitSize);
    const pImg = this.cache.get(`${b.charDirUrl}/${b.fighter.portrait}`);
    if (pImg) {
      ctx.drawImage(pImg, px + 2, py + 2, portraitSize - 4, portraitSize - 4);
    }
    ctx.strokeRect(px, py, portraitSize, portraitSize);

    // HP Bar Geometry (`width = 456`, inner edge near center timer, outer edge near portrait)
    const barW = 456;
    const barH = 22;
    const barX = isLeft ? px + portraitSize + 10 : px - 10 - barW;
    const barY = 22;

    // HP Background
    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.fillRect(barX, barY, barW, barH);

    // Delayed Trail Bar
    const trailRatio = Math.max(0, Math.min(1, this.trailHp[f.slot] / Math.max(1, f.maxHp)));
    const hpRatio = Math.max(0, Math.min(1, f.hp / Math.max(1, f.maxHp)));
    const trailW = Math.round(barW * trailRatio);
    const hpW = Math.round(barW * hpRatio);

    ctx.fillStyle = "#ef4444";
    if (isLeft) {
      ctx.fillRect(barX + (barW - trailW), barY + 2, trailW, barH - 4);
    } else {
      ctx.fillRect(barX, barY + 2, trailW, barH - 4);
    }

    // Active HP Gradient (Drains toward center arcade timer like classic KOF/SF!)
    const hpColor = hpRatio > 0.35 ? "#22c55e" : "#f59e0b";
    ctx.fillStyle = hpColor;
    if (isLeft) {
      ctx.fillRect(barX + (barW - hpW), barY + 2, hpW, barH - 4);
    } else {
      ctx.fillRect(barX, barY + 2, hpW, barH - 4);
    }

    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);

    // Guard Gauge Sub-Bar directly beneath HP Bar (`height = 5`)
    const guardRatio = Math.max(0, Math.min(1, f.guardGauge / Math.max(1, f.maxGuardGauge)));
    const guardW = Math.round(barW * guardRatio);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(barX, barY + barH + 3, barW, 5);
    ctx.fillStyle = guardRatio < 0.3 ? "#f43f5e" : "#38bdf8";
    if (isLeft) {
      ctx.fillRect(barX + (barW - guardW), barY + barH + 3, guardW, 5);
    } else {
      ctx.fillRect(barX, barY + barH + 3, guardW, 5);
    }

    // Top Multi-Stock Super / Qi / Awakening Meter (3 Stocks right under Guard Bar!)
    const stockCount = 3;
    const stockGap = 6;
    const singleStockW = Math.floor((barW - stockGap * (stockCount - 1)) / stockCount);
    const meterY = barY + barH + 12;
    const meterH = 11;
    const perStock = registry.combatConfig.gauge_per_stock ?? 1000;

    for (let sIdx = 0; sIdx < stockCount; sIdx++) {
      const sx = isLeft
        ? barX + sIdx * (singleStockW + stockGap)
        : barX + barW - (sIdx + 1) * singleStockW - sIdx * stockGap;
      const stockFill = Math.max(
        0,
        Math.min(1, (f.gauge - sIdx * perStock) / perStock),
      );
      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.fillRect(sx, meterY, singleStockW, meterH);

      if (stockFill > 0) {
        const full = stockFill >= 1;
        ctx.fillStyle = f.gauge >= 2000 ? "#fbbf24" : full ? "#38bdf8" : "#0ea5e9";
        const fw = Math.round(singleStockW * stockFill);
        if (isLeft) {
          ctx.fillRect(sx, meterY + 1, fw, meterH - 2);
        } else {
          ctx.fillRect(sx + singleStockW - fw, meterY + 1, fw, meterH - 2);
        }
      }
      ctx.strokeStyle = stockFill >= 1 ? "#fde047" : "#475569";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, meterY, singleStockW, meterH);
    }

    // Nameplate, Form Tag, IP Badge & Round Win Diamonds
    const nameY = meterY + 27;
    ctx.font = "bold 14px 'Microsoft YaHei UI', sans-serif";
    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = isLeft ? "left" : "right";
    const nameText = `${b.fighter.name_zh} · ${b.fighter.form_name_zh ?? "常态"} [${b.ip.name_zh}]`;
    ctx.fillText(nameText, isLeft ? barX : barX + barW, nameY);

    // Round Win Diamonds near center
    const roundsNeed = registry.combatConfig.rounds_to_win;
    const wins = state.wins[f.slot];
    for (let r = 0; r < roundsNeed; r++) {
      const dx = isLeft ? barX + barW - 10 - r * 18 : barX + 10 + r * 18;
      const dy = nameY - 5;
      ctx.fillStyle = r < wins ? "#fbbf24" : "#334155";
      ctx.beginPath();
      ctx.moveTo(dx, dy - 6);
      ctx.lineTo(dx + 6, dy);
      ctx.lineTo(dx, dy + 6);
      ctx.lineTo(dx - 6, dy);
      ctx.closePath();
      ctx.fill();
    }

    // Assist Badge + Cooldown Indicator under Portrait
    if (f.assistId) {
      const ab = registry.assistsById[f.assistId];
      if (ab) {
        const ax = px;
        const ay = py + portraitSize + 6;
        ctx.fillStyle = "#0f172a";
        ctx.strokeStyle = f.assistCooldownTicks === 0 ? "#4ade80" : "#64748b";
        ctx.lineWidth = 1.5;
        ctx.fillRect(ax, ay, 38, 38);
        const apImg = this.cache.get(`${ab.assistDirUrl}/${ab.assist.portrait}`);
        if (apImg) {
          ctx.drawImage(apImg, ax + 1, ay + 1, 36, 36);
        }
        if (f.assistCooldownTicks > 0) {
          ctx.fillStyle = "rgba(3, 7, 18, 0.76)";
          ctx.fillRect(ax, ay, 38, 38);
          ctx.fillStyle = "#f8fafc";
          ctx.font = "bold 13px 'Segoe UI', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            `${Math.ceil(f.assistCooldownTicks / SIM_HZ)}s`,
            ax + 19,
            ay + 24,
          );
        } else {
          ctx.fillStyle = "#4ade80";
          ctx.font = "bold 10px 'Segoe UI', sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(isLeft ? "M 援助就绪" : "= 援助就绪", isLeft ? ax + 44 : ax - 58, ay + 23);
        }
        ctx.strokeRect(ax, ay, 38, 38);
      }
    }
  }

  private renderCenterTimer(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    infinite: boolean,
  ): void {
    const cx = VIEWPORT_W * 0.5;
    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2.5;
    ctx.fillRect(cx - 46, 14, 92, 64);
    ctx.strokeRect(cx - 46, 14, 92, 64);

    const secs = infinite ? "∞" : String(Math.max(0, Math.ceil(state.timerTicksRemaining / SIM_HZ))).padStart(2, "0");
    ctx.fillStyle = !infinite && state.timerTicksRemaining <= 15 * SIM_HZ ? "#f43f5e" : "#fde047";
    ctx.font = "bold 36px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(secs, cx, 55);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 11px 'Segoe UI', sans-serif";
    ctx.fillText(`ROUND ${state.roundNumber}`, cx, 72);
  }

  private renderComboAndCallouts(ctx: CanvasRenderingContext2D, state: SimState): void {
    // When defender[1] is in a combo >= 2 hits, P1 (left) landed it!
    const p1ComboOnP2 = state.fighters[1].comboCounter;
    const p2ComboOnP1 = state.fighters[0].comboCounter;

    if (p1ComboOnP2 >= 2) {
      this.drawComboBadge(ctx, 36, 186, p1ComboOnP2, state.fighters[1].comboDamage, true);
    }
    if (p2ComboOnP1 >= 2) {
      this.drawComboBadge(ctx, VIEWPORT_W - 36, 186, p2ComboOnP1, state.fighters[0].comboDamage, false);
    }

    // Technical Callouts
    this.callouts.slice(-3).forEach((c, idx) => {
      const alpha = Math.max(0, 1 - c.age / c.maxAge);
      ctx.save();
      ctx.globalAlpha = alpha;
      const x = c.slot === 0 ? 156 : VIEWPORT_W - 156;
      const y = 248 + idx * 30 - c.age * 0.25;
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(x - 110, y - 20, 220, 26);
      ctx.fillStyle = "#fde047";
      ctx.font = "italic bold 16px 'Microsoft YaHei UI', 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(c.text, x, y - 2);
      ctx.restore();
    });
  }

  private drawComboBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    hits: number,
    dmg: number,
    alignLeft: boolean,
  ): void {
    ctx.save();
    ctx.textAlign = alignLeft ? "left" : "right";
    ctx.fillStyle = "#fbbf24";
    ctx.font = "italic bold 42px 'Segoe UI', sans-serif";
    ctx.fillText(`${hits} HITS!`, x, y);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 15px 'Segoe UI', sans-serif";
    ctx.fillText(`TOTAL DAMAGE: ${dmg}`, x, y + 22);
    ctx.restore();
  }

  private renderTrainingStrip(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    options: {
      dummyMode: TrainingDummyMode;
      onCycleDummy: () => void;
      showBoxes: boolean;
      onToggleBoxes: () => void;
      onResetTraining: () => void;
    },
  ): void {
    const f0 = state.fighters[0];
    const y = VIEWPORT_H - 44;
    ctx.fillStyle = "rgba(9, 13, 24, 0.90)";
    ctx.fillRect(0, y, VIEWPORT_W, 44);
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(VIEWPORT_W, y);
    ctx.stroke();

    const advSign = f0.frameAdvantage > 0 ? `+${f0.frameAdvantage}` : `${f0.frameAdvantage}`;
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "13px 'Consolas', 'Microsoft YaHei UI', monospace";
    ctx.textAlign = "left";
    ctx.fillText(
      `[训练模式] P1状态:${f0.state} | 招式帧(前摇/持续/后摇): ${f0.lastMoveStartup}/${f0.lastMoveActive}/${f0.lastMoveRecovery}f | 帧差有利度: ${advSign}f`,
      18,
      y + 27,
    );

    this.drawHudMiniBtn(ctx, 742, y + 7, 178, 30, `木桩:${options.dummyMode} [F3]`, "#2563eb", options.onCycleDummy);
    this.drawHudMiniBtn(
      ctx,
      928,
      y + 7,
      172,
      30,
      `判定框:${options.showBoxes ? "开 ON" : "关 OFF"} [F2]`,
      options.showBoxes ? "#16a34a" : "#475569",
      options.onToggleBoxes,
    );
    this.drawHudMiniBtn(ctx, 1108, y + 7, 152, 30, "重置位置/满气 [R]", "#d97706", options.onResetTraining);
  }

  private renderRollbackStrip(ctx: CanvasRenderingContext2D, rb: RollbackStats): void {
    const y = VIEWPORT_H - 38;
    ctx.fillStyle = "rgba(9, 13, 24, 0.90)";
    ctx.fillRect(0, y, VIEWPORT_W, 38);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "13px 'Consolas', monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      `[ROLLBACK SYNCTEST LAB] Tick: ${rb.simulatedTicks} | Rollbacks: ${rb.rollbackCount} | Resimulated Frames: ${rb.totalResimulatedFrames} | Max Depth: ${rb.maxRollbackDepth}f | Checksum: 0x${rb.lastChecksum} | [F2] Hitboxes`,
      VIEWPORT_W * 0.5,
      y + 24,
    );
  }

  private renderCenterSplashText(
    ctx: CanvasRenderingContext2D,
    mainText: string,
    subText: string,
    color: string,
  ): void {
    ctx.save();
    ctx.fillStyle = "rgba(6, 9, 18, 0.52)";
    ctx.fillRect(0, VIEWPORT_H * 0.5 - 64, VIEWPORT_W, 118);
    ctx.fillStyle = color;
    ctx.font = "italic bold 64px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(mainText, VIEWPORT_W * 0.5, VIEWPORT_H * 0.5 + 12);
    if (subText) {
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 20px 'Segoe UI', sans-serif";
      ctx.fillText(subText, VIEWPORT_W * 0.5, VIEWPORT_H * 0.5 + 44);
    }
    ctx.restore();
  }

  private renderMatchSettlementOverlay(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    registry: ContentRegistry,
    actions: SettlementActions,
  ): void {
    ctx.fillStyle = "rgba(4, 7, 16, 0.84)";
    ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);

    const winSlot: 0 | 1 = state.wins[0] >= state.wins[1] ? 0 : 1;
    const winFighter = state.fighters[winSlot];
    const b = registry.fightersById[winFighter.activeFighterId]!;
    const accent = b.ip.theme?.primary_hex ?? "#fbbf24";

    const cardX = 210;
    const cardY = 120;
    const cardW = VIEWPORT_W - 420;
    const cardH = 470;
    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.fillRect(cardX, cardY, cardW, cardH);
    ctx.strokeRect(cardX, cardY, cardW, cardH);

    const splashImg = this.cache.get(`${b.charDirUrl}/${b.fighter.splash}`);
    if (splashImg) {
      ctx.drawImage(splashImg, cardX + 32, cardY + 54, 256, 336);
    }

    const rx = cardX + 320;
    ctx.textAlign = "left";
    ctx.fillStyle = accent;
    ctx.font = "bold 18px 'Microsoft YaHei UI', sans-serif";
    ctx.fillText(`PLAYER ${winSlot + 1} VICTORY · 比分 ${state.wins[0]} - ${state.wins[1]}`, rx, cardY + 76);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 34px 'Microsoft YaHei UI', sans-serif";
    ctx.fillText(`${b.fighter.name_zh}（${b.fighter.form_name_zh ?? "常态"}）`, rx, cardY + 124);

    ctx.fillStyle = "#fde047";
    ctx.font = "italic 16px 'Microsoft YaHei UI', sans-serif";
    ctx.fillText(`“${b.fighter.victory_quote_zh ?? "胜负已分！"}”`, rx, cardY + 168);

    // Settlement Menu Buttons
    this.drawHudMiniBtn(ctx, rx, cardY + 216, 240, 44, "再来一局 REMATCH [Enter]", "#16a34a", actions.onRematch);
    this.drawHudMiniBtn(ctx, rx + 256, cardY + 216, 240, 44, "重新选人 SELECT [C]", "#2563eb", actions.onCharSelect);
    this.drawHudMiniBtn(ctx, rx, cardY + 276, 240, 44, "校验并导出录像 REPLAY [V]", "#7c3aed", actions.onExportReplay);
    this.drawHudMiniBtn(ctx, rx + 256, cardY + 276, 240, 44, "返回主菜单 MENU [Esc]", "#475569", actions.onMainMenu);
  }

  private renderPauseOverlay(ctx: CanvasRenderingContext2D, actions: SettlementActions): void {
    ctx.fillStyle = "rgba(4, 7, 16, 0.78)";
    ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);
    const cx = VIEWPORT_W * 0.5;
    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.fillRect(cx - 210, 200, 420, 300);
    ctx.strokeRect(cx - 210, 200, 420, 300);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 26px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("战斗暂停 PAUSED", cx, 250);

    this.drawHudMiniBtn(ctx, cx - 140, 282, 280, 42, "重开本局 REMATCH", "#16a34a", actions.onRematch);
    this.drawHudMiniBtn(ctx, cx - 140, 336, 280, 42, "返回选人 CHARACTER SELECT", "#2563eb", actions.onCharSelect);
    this.drawHudMiniBtn(ctx, cx - 140, 390, 280, 42, "返回标题画面 MAIN MENU", "#475569", actions.onMainMenu);
  }

  private drawHudMiniBtn(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    bg: string,
    onClick: () => void,
  ): void {
    ctx.fillStyle = bg;
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 5);
    this.hotspots.push({ x, y, w, h, onClick });
  }
}
