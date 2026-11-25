/**
 * Single-screen selection: every IP is shown at once as its own bordered panel.
 * - Single tap/click = pre-select (outline). Double tap/click (<= 300ms) = confirm (filled).
 * - After a character is confirmed, assists of that character's IP appear on the same screen
 *   and must also be double-tapped to confirm. P1 then P2; the match starts after P2's assist.
 */

import type { AiDifficulty } from "../ai_system/tactical_ai";
import type { SpriteAssetCache } from "../animation/fighter_renderer";
import { VIEWPORT_H, VIEWPORT_W } from "../combat/stage_renderer";
import type { AssistBundle, CharacterGroup, ContentRegistry } from "../core/data_models";
import { placeholderColor } from "../core/placeholder_color";
import type { AudioEngine } from "./audio_engine";
import { DoubleTapDetector } from "./double_tap";
import type { InputCollector } from "./input_collector";

export type GameMode = "VERSUS_CPU" | "VERSUS_2P" | "TRAINING" | "ROLLBACK_LAB";

export interface ClickHotspot {
  x: number;
  y: number;
  w: number;
  h: number;
  onClick: () => void;
}

export interface ConfirmedMatchParticipants {
  p1FighterId: string;
  p2FighterId: string;
  p1AssistId: string | null;
  p2AssistId: string | null;
  stageIpId: string;
  aiDifficulty: AiDifficulty;
}

interface SlotPick {
  charId: string | null;
  assistId: string | null;
}

const FONT = "'Microsoft YaHei UI', 'PingFang SC', sans-serif";

export class SelectScreen {
  private readonly registry: ContentRegistry;
  private readonly cache: SpriteAssetCache;
  private readonly audio: AudioEngine;
  public mode: GameMode = "VERSUS_CPU";
  public aiDifficulty: AiDifficulty = "NORMAL";

  private slot: 0 | 1 = 0;
  private stage: "char" | "assist" = "char";
  private picks: [SlotPick, SlotPick] = [
    { charId: null, assistId: null },
    { charId: null, assistId: null },
  ];
  private preChar: string | null = null;
  private preAssist: string | null = null;
  private readonly tap = new DoubleTapDetector(300);

  private hotspots: ClickHotspot[] = [];
  private onMatchConfirmed: ((res: ConfirmedMatchParticipants) => void) | null = null;
  private onBackToTitle: (() => void) | null = null;

  constructor(registry: ContentRegistry, cache: SpriteAssetCache, audio: AudioEngine) {
    this.registry = registry;
    this.cache = cache;
    this.audio = audio;
  }

  public open(
    mode: GameMode,
    onConfirm: (res: ConfirmedMatchParticipants) => void,
    onBack: () => void,
  ): void {
    this.mode = mode;
    this.onMatchConfirmed = onConfirm;
    this.onBackToTitle = onBack;
    this.resetAll();
  }

  private resetAll(): void {
    this.slot = 0;
    this.stage = "char";
    this.picks = [
      { charId: null, assistId: null },
      { charId: null, assistId: null },
    ];
    this.preChar = null;
    this.preAssist = null;
    this.tap.reset();
  }

  public handlePointerClick(x: number, y: number): void {
    for (let i = this.hotspots.length - 1; i >= 0; i--) {
      const h = this.hotspots[i]!;
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        h.onClick();
        return;
      }
    }
  }

  public updateKeyboard(input: InputCollector): void {
    if (input.consumeJustPressed("Escape")) {
      this.goBack();
    }
  }

  private goBack(): void {
    this.tap.reset();
    if (this.stage === "assist") {
      this.stage = "char";
      this.picks[this.slot].charId = null;
      this.preAssist = null;
    } else if (this.slot === 1) {
      this.slot = 0;
      this.stage = "assist";
      this.picks[0].assistId = null;
      this.preChar = null;
    } else {
      this.onBackToTitle?.();
    }
  }

  private groupById(charId: string | null): CharacterGroup | undefined {
    if (!charId) return undefined;
    for (const groups of Object.values(this.registry.groupsByIp)) {
      const g = groups.find((x) => x.baseBundle.fighter.id === charId);
      if (g) return g;
    }
    return undefined;
  }

  private assistsForCurrentChar(): AssistBundle[] {
    const g = this.groupById(this.picks[this.slot].charId);
    return g ? (this.registry.assistsByIp[g.baseBundle.fighter.ip_id] ?? []) : [];
  }

  private onCharTap(charId: string): void {
    if (this.stage !== "char") return;
    const result = this.tap.tap(`c:${charId}`, performance.now());
    this.preChar = charId;
    this.audio.playUiBlip(result === "confirm" ? 760 : 560, 0.04);
    if (result === "confirm") {
      this.picks[this.slot].charId = charId;
      this.stage = "assist";
      this.preAssist = null;
    }
  }

  private onAssistTap(assistId: string): void {
    if (this.stage !== "assist") return;
    const result = this.tap.tap(`a:${assistId}`, performance.now());
    this.preAssist = assistId;
    this.audio.playUiBlip(result === "confirm" ? 760 : 560, 0.04);
    if (result !== "confirm") return;

    this.picks[this.slot].assistId = assistId;
    if (this.slot === 0) {
      this.slot = 1;
      this.stage = "char";
      this.preChar = null;
      this.preAssist = null;
      this.tap.reset();
    } else {
      this.launch();
    }
  }

  private launch(): void {
    const g0 = this.groupById(this.picks[0].charId);
    const g1 = this.groupById(this.picks[1].charId);
    if (!g0 || !g1) return;
    this.cache.preloadFighterBundle(g0.baseBundle);
    this.cache.preloadFighterBundle(g1.baseBundle);
    this.onMatchConfirmed?.({
      p1FighterId: g0.baseBundle.fighter.id,
      p2FighterId: g1.baseBundle.fighter.id,
      p1AssistId: this.picks[0].assistId,
      p2AssistId: this.picks[1].assistId,
      stageIpId: g0.baseBundle.fighter.ip_id,
      aiDifficulty: this.aiDifficulty,
    });
  }

  public render(ctx: CanvasRenderingContext2D): void {
    this.hotspots = [];
    ctx.fillStyle = "#0b0f19";
    ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);

    // Header: back button + current player label (only necessary info)
    this.drawButton(ctx, 24, 18, 90, 36, "返回", () => this.goBack());
    ctx.textAlign = "center";
    ctx.fillStyle = this.slot === 0 ? "#60a5fa" : "#f87171";
    ctx.font = `bold 28px ${FONT}`;
    ctx.fillText(this.slot === 0 ? "P1" : "P2", VIEWPORT_W * 0.5, 46);

    // IP panels, all visible at once
    const ips = this.registry.ips;
    const gap = 24;
    const margin = 40;
    const panelW = Math.floor((VIEWPORT_W - margin * 2 - gap * (ips.length - 1)) / Math.max(1, ips.length));
    const panelY = 74;
    const panelH = 420;

    ips.forEach((ip, i) => {
      const px = margin + i * (panelW + gap);
      const accent = ip.theme?.primary_hex ?? "#94a3b8";
      ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
      ctx.fillRect(px, panelY, panelW, panelH);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.strokeRect(px, panelY, panelW, panelH);

      ctx.textAlign = "left";
      ctx.fillStyle = accent;
      ctx.font = `bold 26px ${FONT}`;
      ctx.fillText(ip.name_zh, px + 18, panelY + 38);

      const groups = this.registry.groupsByIp[ip.id] ?? [];
      const cols = 3;
      const cellGap = 12;
      const cellW = Math.floor((panelW - 32 - cellGap * (cols - 1)) / cols);
      const cellH = 96;
      groups.forEach((g, idx) => {
        const cx = px + 16 + (idx % cols) * (cellW + cellGap);
        const cy = panelY + 60 + Math.floor(idx / cols) * (cellH + cellGap);
        const id = g.baseBundle.fighter.id;
        const taken = this.picks[this.slot].charId === id;
        const otherTag = this.slot === 1 && this.picks[0].charId === id ? "P1" : "";
        this.drawCard(ctx, cx, cy, cellW, cellH, g.baseBundle.fighter.name_zh, placeholderColor(id), {
          confirmed: taken,
          pre: this.stage === "char" && this.preChar === id,
          tag: otherTag,
          onClick: () => this.onCharTap(id),
        });
      });
    });

    // Assist strip (same screen) — shown only after the character is confirmed
    if (this.stage === "assist") {
      const assists = this.assistsForCurrentChar();
      const aw = 220;
      const ag = 16;
      const total = assists.length * aw + (assists.length - 1) * ag;
      const sx = Math.floor((VIEWPORT_W - total) / 2);
      const sy = 530;
      assists.forEach((a, idx) => {
        this.drawCard(ctx, sx + idx * (aw + ag), sy, aw, 110, a.assist.name_zh, placeholderColor(a.assist.id), {
          confirmed: this.picks[this.slot].assistId === a.assist.id,
          pre: this.preAssist === a.assist.id,
          tag: "",
          onClick: () => this.onAssistTap(a.assist.id),
        });
      });
    }

    // Picks summary (P1 / P2)
    ctx.textAlign = "left";
    ctx.font = `16px ${FONT}`;
    ([0, 1] as const).forEach((s) => {
      const p = this.picks[s];
      const cName = this.groupById(p.charId)?.baseBundle.fighter.name_zh ?? "—";
      const aName = p.assistId ? (this.registry.assistsById[p.assistId]?.assist.name_zh ?? "") : "—";
      ctx.fillStyle = s === 0 ? "#60a5fa" : "#f87171";
      ctx.fillText(`${s === 0 ? "P1" : "P2"}  ${cName} / ${aName}`, 40 + s * 360, VIEWPORT_H - 28);
    });
  }

  private drawCard(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    color: string,
    opt: { confirmed: boolean; pre: boolean; tag: string; onClick: () => void },
  ): void {
    if (opt.confirmed) {
      // Confirmed = solid filled highlight
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);
    } else {
      ctx.fillStyle = "#111827";
      ctx.fillRect(x, y, w, h);
      // colour swatch strip so the placeholder identity is visible
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 8, h);
      if (opt.pre) {
        // Pre-selected = outline only
        ctx.strokeStyle = "#fde047";
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
      }
    }
    ctx.textAlign = "center";
    ctx.fillStyle = opt.confirmed ? "#0b0f19" : "#f8fafc";
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 6);
    if (opt.tag) {
      ctx.fillStyle = "#60a5fa";
      ctx.font = `bold 14px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(opt.tag, x + w - 8, y + 20);
    }
    this.hotspots.push({ x, y, w, h, onClick: opt.onClick });
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    onClick: () => void,
  ): void {
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#e5e7eb";
    ctx.font = `bold 16px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 6);
    this.hotspots.push({ x, y, w, h, onClick });
  }
}
