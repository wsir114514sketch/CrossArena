/**
 * Unified Portrait Character & Assist Select Screen (`SelectScreen`).
 *
 * Reference design adapted from BleachVsNaruto (`SelectFighterStage` / `SelectFighterItem`):
 * 1. Portrait Tiles: Every playable character and assist renders as a crisp unstretched character portrait
 *    (`100x96`, native 2x pixel face icon via `drawImageFit`), unified in size, framing, and style.
 * 2. Integrated Assists: Regular fighters and Assist fighters share the SAME character grid within each IP tab/panel,
 *    with Assists carrying a cohesive corner badge (`援助`) while retaining separate fighter vs assist combat roles.
 *    Supports category filter (`全部` / `主战` / `援助`) and wheel/touch scroll when roster grows.
 * 3. Explicit 3-State Visual Feedback + Smooth Arcade Animations:
 *    - Idle (`待选择`): clean dark frame; Hover gives subtle brighten + `1.04x` lift.
 *    - Selected (`已选择`, 1st click): bright gold border + outer glow + `1.07x` scale + live preview in P1/P2 slot.
 *    - Confirmed (`已确定`, 2nd click on selected tile / double-click / slot `确定` button):
 *      back-out pop + expanding pulse ring + corner `✓` badge + full standee (`splash.png`) reveal + `重选` option.
 */

import type { AiDifficulty } from "../ai_system/tactical_ai";
import type { SpriteAssetCache } from "../animation/fighter_renderer";
import { VIEWPORT_H, VIEWPORT_W } from "../combat/stage_renderer";
import type { ContentRegistry } from "../core/data_models";
import type { AudioEngine } from "./audio_engine";
import { drawImageFit } from "./draw_fit";
import type { InputCollector } from "./input_collector";

export type GameMode = "VERSUS_CPU" | "VERSUS_2P" | "TRAINING" | "ROLLBACK_LAB";
export type RosterFilter = "all" | "char" | "assist";

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

export interface SelectTile {
  key: string;
  kind: "char" | "assist";
  id: string;
  ipId: string;
  name: string;
  subLabel: string;
  portraitUrl: string;
  splashUrl: string;
}

interface Hot extends ClickHotspot {
  key: string;
}

export interface PlayerSlotState {
  selectedCharId: string | null;
  confirmedCharId: string | null;
  selectedAssistId: string | null;
  confirmedAssistId: string | null;
}

const FONT = "'Microsoft YaHei UI', 'PingFang SC', 'Segoe UI', sans-serif";
const TILE_W = 92;
const TILE_H = 88;
const LABEL_H = 22;
const GAP = 10;
const CONFIRM_ANIM_MS = 320;

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export class SelectScreen {
  private readonly registry: ContentRegistry;
  private readonly cache: SpriteAssetCache;
  private readonly audio: AudioEngine;
  public mode: GameMode = "VERSUS_CPU";
  public aiDifficulty: AiDifficulty = "NORMAL";
  public filter: RosterFilter = "all";

  public activeSlot: 0 | 1 = 0;
  public slots: [PlayerSlotState, PlayerSlotState] = [
    { selectedCharId: null, confirmedCharId: null, selectedAssistId: null, confirmedAssistId: null },
    { selectedCharId: null, confirmedCharId: null, selectedAssistId: null, confirmedAssistId: null },
  ];

  private hoverKey: string | null = null;
  private readonly confirmedAt = new Map<string, number>();
  private standeeAnimAt: [number, number] = [0, 0];
  private readonly panelScrollY = new Map<string, number>();
  private readonly panelMaxScroll = new Map<string, number>();

  private hotspots: Hot[] = [];
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
    this.activeSlot = 0;
    this.filter = "all";
    this.slots = [
      { selectedCharId: null, confirmedCharId: null, selectedAssistId: null, confirmedAssistId: null },
      { selectedCharId: null, confirmedCharId: null, selectedAssistId: null, confirmedAssistId: null },
    ];
    this.hoverKey = null;
    this.confirmedAt.clear();
    this.panelScrollY.clear();
    this.preloadAllPortraits();
  }

  private preloadAllPortraits(): void {
    for (const ip of this.registry.ips) {
      for (const t of this.tilesOf(ip.id, "all")) {
        this.cache.get(t.portraitUrl);
        this.cache.get(t.splashUrl);
      }
    }
  }

  public handlePointerMove(x: number, y: number): boolean {
    const h = this.hit(x, y);
    this.hoverKey = h ? h.key : null;
    return h !== null;
  }

  public handlePointerClick(x: number, y: number): void {
    this.hit(x, y)?.onClick();
  }

  public handleWheel(x: number, _y: number, deltaY: number): void {
    const ips = this.registry.ips;
    if (ips.length === 0) return;
    const panelIdx = Math.min(ips.length - 1, Math.max(0, Math.floor((x / VIEWPORT_W) * ips.length)));
    const ipId = ips[panelIdx]!.id;
    const maxS = this.panelMaxScroll.get(ipId) ?? 0;
    if (maxS <= 0) return;
    const prev = this.panelScrollY.get(ipId) ?? 0;
    this.panelScrollY.set(ipId, Math.max(0, Math.min(maxS, prev + (deltaY > 0 ? 36 : -36))));
  }

  private hit(x: number, y: number): Hot | null {
    for (let i = this.hotspots.length - 1; i >= 0; i--) {
      const h = this.hotspots[i]!;
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  public updateKeyboard(input: InputCollector): void {
    if (input.consumeJustPressed("Escape")) {
      this.goBack();
    }
  }

  public goBack(): void {
    const cur = this.slots[this.activeSlot];
    if (cur.confirmedAssistId || cur.confirmedCharId || cur.selectedCharId || cur.selectedAssistId) {
      this.resetSlot(this.activeSlot);
      this.audio.playUiBlip(420, 0.04);
      return;
    }
    if (this.activeSlot === 1) {
      this.activeSlot = 0;
      this.slots[0].confirmedAssistId = null;
      this.audio.playUiBlip(420, 0.04);
      return;
    }
    this.onBackToTitle?.();
  }

  public resetSlot(slot: 0 | 1): void {
    this.slots[slot] = {
      selectedCharId: null,
      confirmedCharId: null,
      selectedAssistId: null,
      confirmedAssistId: null,
    };
    this.activeSlot = slot;
  }

  /**
   * Tap / click a portrait tile:
   * - 1st click on an unconfirmed tile -> immediately enters `已选择 (Selected)` state.
   * - 2nd click on the already-selected tile (whether fast double-click or deliberate confirm click) -> `已确定 (Confirmed)`.
   * - Clicking an already-confirmed tile toggles it back to `已选择` so the user can cancel/change cleanly.
   */
  public tapTile(t: SelectTile, nowMs = performance.now()): "selected" | "confirmed" | "unconfirmed" {
    const st = this.slots[this.activeSlot];

    if (t.kind === "char") {
      if (st.confirmedCharId === t.id) {
        st.confirmedCharId = null;
        st.selectedCharId = t.id;
        this.audio.playUiBlip(440, 0.04);
        return "unconfirmed";
      }
      if (st.selectedCharId === t.id) {
        this.confirmSlotChar(this.activeSlot, t.id, nowMs);
        return "confirmed";
      }
      st.selectedCharId = t.id;
      if (st.confirmedCharId !== null) {
        // Switching preview while keeping or replacing confirmed fighter on next click
        st.confirmedCharId = null;
      }
      this.standeeAnimAt[this.activeSlot] = nowMs;
      this.audio.playUiBlip(560, 0.04);
      return "selected";
    }

    // Assist tile
    if (st.confirmedAssistId === t.id) {
      st.confirmedAssistId = null;
      st.selectedAssistId = t.id;
      this.audio.playUiBlip(440, 0.04);
      return "unconfirmed";
    }
    if (st.selectedAssistId === t.id) {
      this.confirmSlotAssist(this.activeSlot, t.id, nowMs);
      return "confirmed";
    }
    st.selectedAssistId = t.id;
    if (st.confirmedAssistId !== null) {
      st.confirmedAssistId = null;
    }
    this.audio.playUiBlip(560, 0.04);
    return "selected";
  }

  public confirmPendingForSlot(slot: 0 | 1, nowMs = performance.now()): void {
    const st = this.slots[slot];
    if (!st.confirmedCharId && st.selectedCharId) {
      this.confirmSlotChar(slot, st.selectedCharId, nowMs);
      return;
    }
    if (!st.confirmedAssistId && st.selectedAssistId) {
      this.confirmSlotAssist(slot, st.selectedAssistId, nowMs);
    }
  }

  private confirmSlotChar(slot: 0 | 1, charId: string, nowMs: number): void {
    const st = this.slots[slot];
    st.selectedCharId = charId;
    st.confirmedCharId = charId;
    this.confirmedAt.set(`${slot}:c:${charId}`, nowMs);
    this.standeeAnimAt[slot] = nowMs;
    this.audio.playUiBlip(780, 0.06);
    this.advanceIfSlotComplete(slot);
  }

  private confirmSlotAssist(slot: 0 | 1, assistId: string, nowMs: number): void {
    const st = this.slots[slot];
    st.selectedAssistId = assistId;
    st.confirmedAssistId = assistId;
    this.confirmedAt.set(`${slot}:a:${assistId}`, nowMs);
    this.audio.playUiBlip(780, 0.06);
    this.advanceIfSlotComplete(slot);
  }

  private advanceIfSlotComplete(slot: 0 | 1): void {
    const st = this.slots[slot];
    if (!st.confirmedCharId || !st.confirmedAssistId) {
      return;
    }
    if (slot === 0 && (!this.slots[1].confirmedCharId || !this.slots[1].confirmedAssistId)) {
      this.activeSlot = 1;
      return;
    }
    if (
      this.slots[0].confirmedCharId &&
      this.slots[0].confirmedAssistId &&
      this.slots[1].confirmedCharId &&
      this.slots[1].confirmedAssistId
    ) {
      this.launch();
    }
  }

  private launch(): void {
    const b0 = this.registry.fightersById[this.slots[0].confirmedCharId ?? ""];
    const b1 = this.registry.fightersById[this.slots[1].confirmedCharId ?? ""];
    if (!b0 || !b1) return;
    this.cache.preloadFighterBundle(b0);
    this.cache.preloadFighterBundle(b1);
    this.onMatchConfirmed?.({
      p1FighterId: b0.fighter.id,
      p2FighterId: b1.fighter.id,
      p1AssistId: this.slots[0].confirmedAssistId,
      p2AssistId: this.slots[1].confirmedAssistId,
      stageIpId: b0.fighter.ip_id,
      aiDifficulty: this.aiDifficulty,
    });
  }

  public tilesOf(ipId: string, filter: RosterFilter = this.filter): SelectTile[] {
    const out: SelectTile[] = [];
    if (filter === "all" || filter === "char") {
      for (const g of this.registry.groupsByIp[ipId] ?? []) {
        const b = g.baseBundle;
        out.push({
          key: `c:${b.fighter.id}`,
          kind: "char",
          id: b.fighter.id,
          ipId,
          name: b.fighter.name_zh,
          subLabel: b.fighter.form_name_zh ?? "",
          portraitUrl: `${b.charDirUrl}/${b.fighter.portrait}`,
          splashUrl: `${b.charDirUrl}/${b.fighter.splash}`,
        });
      }
    }
    if (filter === "all" || filter === "assist") {
      for (const a of this.registry.assistsByIp[ipId] ?? []) {
        out.push({
          key: `a:${a.assist.id}`,
          kind: "assist",
          id: a.assist.id,
          ipId,
          name: a.assist.name_zh,
          subLabel: a.assist.skill_name_zh ?? "",
          portraitUrl: `${a.assistDirUrl}/${a.assist.portrait}`,
          splashUrl: `${a.assistDirUrl}/${a.assist.portrait}`,
        });
      }
    }
    return out;
  }

  private findTile(key: string): SelectTile | undefined {
    for (const ip of this.registry.ips) {
      const t = this.tilesOf(ip.id, "all").find((x) => x.key === key);
      if (t) return t;
    }
    return undefined;
  }

  public render(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    this.hotspots = [];
    ctx.imageSmoothingEnabled = false;

    // Arcade dark backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, VIEWPORT_H);
    bg.addColorStop(0, "#090d16");
    bg.addColorStop(0.55, "#111827");
    bg.addColorStop(1, "#080b13");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);

    // Top Bar: Back + P1/P2 Active Turn Switch + Unified Category Filter Pills (`全部` / `主战` / `援助`)
    this.drawButton(ctx, 28, 14, 84, 36, "← 返回", false, () => this.goBack());

    // Active Player Turn Pill
    const p1Done = Boolean(this.slots[0].confirmedCharId && this.slots[0].confirmedAssistId);
    const p2Done = Boolean(this.slots[1].confirmedCharId && this.slots[1].confirmedAssistId);
    this.drawPlayerTurnTab(ctx, VIEWPORT_W * 0.5 - 148, 14, 140, 36, 0, p1Done);
    this.drawPlayerTurnTab(ctx, VIEWPORT_W * 0.5 + 8, 14, 140, 36, 1, p2Done);

    // Unified Grid Filter Tabs (keeps regular & assist in the SAME selection area, with quick filtering)
    const filters: Array<{ id: RosterFilter; label: string }> = [
      { id: "all", label: "全部" },
      { id: "char", label: "主战" },
      { id: "assist", label: "援助" },
    ];
    filters.forEach((f, idx) => {
      const fx = VIEWPORT_W - 28 - (filters.length - idx) * 76 + 6;
      this.drawButton(ctx, fx, 14, 70, 36, f.label, this.filter === f.id, () => {
        this.filter = f.id;
        this.panelScrollY.clear();
        this.audio.playUiBlip(520, 0.03);
      });
    });

    // Dual-IP Unified Portrait Panels (Regular Characters + Assist Characters in ONE shared grid per IP)
    const ips = this.registry.ips;
    const margin = 28;
    const gap = 20;
    const panelW = Math.floor((VIEWPORT_W - margin * 2 - gap * Math.max(0, ips.length - 1)) / Math.max(1, ips.length));
    const panelY = 62;
    const panelH = 446;

    ips.forEach((ip, i) => {
      const px = margin + i * (panelW + gap);
      const accent = ip.theme?.primary_hex ?? "#94a3b8";

      ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
      ctx.fillRect(px, panelY, panelW, panelH);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(px, panelY, panelW, panelH);

      // IP Header Strip
      ctx.fillStyle = "rgba(30, 41, 59, 0.75)";
      ctx.fillRect(px + 2, panelY + 2, panelW - 4, 38);
      ctx.textAlign = "left";
      ctx.fillStyle = accent;
      ctx.font = `bold 20px ${FONT}`;
      ctx.fillText(ip.name_zh, px + 16, panelY + 28);

      ctx.textAlign = "right";
      ctx.fillStyle = "#94a3b8";
      ctx.font = `bold 12px ${FONT}`;
      ctx.fillText(ip.name_en.toUpperCase(), px + panelW - 16, panelY + 27);

      const tiles = this.tilesOf(ip.id, this.filter);
      const innerX = px + 16;
      const innerY = panelY + 50;
      const innerW = panelW - 32;
      const innerH = panelH - 60;

      const cols = Math.max(1, Math.floor((innerW + GAP) / (TILE_W + GAP)));
      const rows = Math.max(1, Math.ceil(tiles.length / cols));
      const rowStride = TILE_H + LABEL_H + GAP;
      const contentH = rows * rowStride - GAP;
      const maxScroll = Math.max(0, contentH - innerH);
      this.panelMaxScroll.set(ip.id, maxScroll);
      const scrollY = Math.min(maxScroll, this.panelScrollY.get(ip.id) ?? 0);

      const gridW = cols * TILE_W + (cols - 1) * GAP;
      const startX = innerX + Math.floor((innerW - gridW) / 2);

      ctx.save();
      ctx.beginPath();
      ctx.rect(px + 3, innerY - 6, panelW - 6, innerH + 10);
      ctx.clip();

      tiles.forEach((t, idx) => {
        const tx = startX + (idx % cols) * (TILE_W + GAP);
        const ty = innerY + Math.floor(idx / cols) * rowStride - scrollY;
        if (ty + TILE_H + LABEL_H < innerY - 8 || ty > innerY + innerH + 8) return;
        this.drawPortraitTile(ctx, t, tx, ty, TILE_W, TILE_H, accent, now, {
          clipTop: innerY - 6,
          clipBottom: innerY + innerH + 4,
        });
      });
      ctx.restore();

      if (maxScroll > 0) {
        const trackH = innerH;
        const thumbH = Math.max(28, Math.round((innerH / contentH) * trackH));
        const thumbY = innerY + Math.round((scrollY / maxScroll) * (trackH - thumbH));
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(px + panelW - 8, innerY, 4, trackH);
        ctx.fillStyle = accent;
        ctx.fillRect(px + panelW - 8, thumbY, 4, thumbH);
      }
    });

    // Bottom P1 & P2 Confirmed / Selected Showcase Dock (`y = 520 .. 704`)
    const dockW = Math.floor((VIEWPORT_W - margin * 2 - 48) / 2);
    const dockY = 520;
    const dockH = 184;
    this.drawPlayerShowcaseCard(ctx, 0, margin, dockY, dockW, dockH, now);
    this.drawPlayerShowcaseCard(ctx, 1, VIEWPORT_W - margin - dockW, dockY, dockW, dockH, now);

    // Center VS Emblem between P1 & P2 docks
    ctx.textAlign = "center";
    ctx.fillStyle = "#fbbf24";
    ctx.font = "italic bold 26px 'Segoe UI', sans-serif";
    ctx.fillText("VS", VIEWPORT_W * 0.5, dockY + dockH * 0.5 + 9);
  }

  private drawPortraitTile(
    ctx: CanvasRenderingContext2D,
    t: SelectTile,
    x: number,
    y: number,
    w: number,
    h: number,
    accent: string,
    now: number,
    clipBounds: { clipTop: number; clipBottom: number },
  ): void {
    const cur = this.slots[this.activeSlot];
    const p1Confirmed =
      t.kind === "char" ? this.slots[0].confirmedCharId === t.id : this.slots[0].confirmedAssistId === t.id;
    const p2Confirmed =
      t.kind === "char" ? this.slots[1].confirmedCharId === t.id : this.slots[1].confirmedAssistId === t.id;
    const activeConfirmed = this.activeSlot === 0 ? p1Confirmed : p2Confirmed;
    const activeSelected =
      !activeConfirmed &&
      (t.kind === "char" ? cur.selectedCharId === t.id : cur.selectedAssistId === t.id);
    const hover = !activeConfirmed && !activeSelected && this.hoverKey === t.key;

    // Smooth scale & confirm pulse
    let scale = hover ? 1.04 : activeSelected ? 1.07 : 1.0;
    let pulseAlpha = 0;
    const animStart =
      this.confirmedAt.get(`${this.activeSlot}:${t.key}`) ??
      this.confirmedAt.get(`0:${t.key}`) ??
      this.confirmedAt.get(`1:${t.key}`);
    if ((p1Confirmed || p2Confirmed) && animStart !== undefined) {
      const p = Math.min(1, (now - animStart) / CONFIRM_ANIM_MS);
      if (p < 1) {
        scale = 1 + 0.14 * (1 - easeOutBack(p));
        pulseAlpha = 1 - p;
      }
    }

    const cx = x + w * 0.5;
    const cy = y + h * 0.5;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-w * 0.5, -h * 0.5);

    // Portrait well background
    ctx.fillStyle = "#0b1120";
    ctx.fillRect(0, 0, w, h);

    // Crisp unstretched character portrait (`drawImageFit`)
    const img = this.cache.get(t.portraitUrl);
    if (img) {
      drawImageFit(ctx, img, 2, 2, w - 4, h - 4);
    } else {
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(4, 4, w - 8, h - 8);
    }

    // Assist Unified Corner Badge (`援助`) — visually cohesive yet immediately recognizable
    if (t.kind === "assist") {
      ctx.fillStyle = "rgba(245, 158, 11, 0.94)";
      ctx.fillRect(2, h - 20, 36, 18);
      ctx.fillStyle = "#090d16";
      ctx.font = `bold 11px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("援助", 20, h - 7);
    }

    // 3-State Border & Glow Styling
    if (p1Confirmed || p2Confirmed) {
      const ownerColor = p1Confirmed && p2Confirmed ? "#c084fc" : p1Confirmed ? "#3b82f6" : "#ef4444";
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, w - 4, h - 4);

      // Top-left player tag (`P1` / `P2`)
      const pLabel = p1Confirmed && p2Confirmed ? "1P/2P" : p1Confirmed ? "P1" : "P2";
      const tagW = p1Confirmed && p2Confirmed ? 40 : 26;
      ctx.fillStyle = ownerColor;
      ctx.fillRect(0, 0, tagW, 17);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold 11px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(pLabel, tagW * 0.5, 12.5);

      // Top-right confirmed check badge `✓`
      ctx.beginPath();
      ctx.arc(w - 13, 13, 10, 0, Math.PI * 2);
      ctx.fillStyle = "#22c55e";
      ctx.fill();
      ctx.strokeStyle = "#052e16";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(w - 17.5, 13);
      ctx.lineTo(w - 14, 16.5);
      ctx.lineTo(w - 8.5, 9.5);
      ctx.stroke();
    } else if (activeSelected) {
      // Selected (Pre-confirmed) state: vibrant gold border + outer glow + "已选" corner pill
      ctx.shadowColor = "#fde047";
      ctx.shadowBlur = 14;
      ctx.strokeStyle = "#fde047";
      ctx.lineWidth = 3.5;
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
      ctx.shadowBlur = 0;

      ctx.fillStyle = "#fde047";
      ctx.fillRect(w - 34, 0, 34, 16);
      ctx.fillStyle = "#090d16";
      ctx.font = `bold 10px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("已选", w - 17, 12);
    } else if (hover) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
    } else {
      ctx.strokeStyle = t.kind === "assist" ? "rgba(245, 158, 11, 0.45)" : "#334155";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, w - 2, h - 2);
    }

    // Confirm expanding pulse ring
    if (pulseAlpha > 0) {
      ctx.strokeStyle = accent;
      ctx.globalAlpha = pulseAlpha * 0.85;
      ctx.lineWidth = 2.5;
      const expand = (1 - pulseAlpha) * 14;
      ctx.strokeRect(-expand, -expand, w + expand * 2, h + expand * 2);
    }

    ctx.restore();

    // Name plate under portrait
    ctx.textAlign = "center";
    ctx.fillStyle = p1Confirmed || p2Confirmed ? "#ffffff" : activeSelected ? "#fde047" : "#cbd5e1";
    ctx.font = `bold 12px ${FONT}`;
    const shortName = t.name.length > 7 ? `${t.name.slice(0, 6)}…` : t.name;
    ctx.fillText(shortName, cx, y + h + 15);

    const hitY0 = Math.max(clipBounds.clipTop, y);
    const hitY1 = Math.min(clipBounds.clipBottom, y + h + LABEL_H);
    if (hitY1 > hitY0) {
      this.hotspots.push({
        x,
        y: hitY0,
        w,
        h: hitY1 - hitY0,
        key: t.key,
        onClick: () => {
          this.tapTile(t);
        },
      });
    }
  }

  private drawPlayerShowcaseCard(
    ctx: CanvasRenderingContext2D,
    slot: 0 | 1,
    x: number,
    y: number,
    w: number,
    h: number,
    now: number,
  ): void {
    const isTurn = this.activeSlot === slot;
    const pColor = slot === 0 ? "#3b82f6" : "#ef4444";
    const st = this.slots[slot];

    const dispCharId = st.confirmedCharId ?? st.selectedCharId;
    const dispAssistId = st.confirmedAssistId ?? st.selectedAssistId;
    const charConfirmed = st.confirmedCharId !== null;
    const assistConfirmed = st.confirmedAssistId !== null;
    const hasPendingSelection =
      (!charConfirmed && st.selectedCharId !== null) ||
      (!assistConfirmed && st.selectedAssistId !== null);

    ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = isTurn ? pColor : "#334155";
    ctx.lineWidth = isTurn ? 3 : 1.5;
    ctx.strokeRect(x, y, w, h);

    // Left Standee Showcase Box (`190 x 158`, preserves aspect ratio via `drawImageFit`)
    const sx = x + 14;
    const sy = y + 13;
    const sw = 192;
    const sh = h - 26;
    ctx.fillStyle = "#090d16";
    ctx.fillRect(sx, sy, sw, sh);

    const charTile = dispCharId ? this.findTile(`c:${dispCharId}`) : undefined;
    if (charTile) {
      const animT = Math.min(1, (now - this.standeeAnimAt[slot]) / 240);
      const slidePx = (1 - animT) * (1 - animT) * 14;
      const sImg = this.cache.get(charTile.splashUrl) ?? this.cache.get(charTile.portraitUrl);
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx + 2, sy + 2, sw - 4, sh - 4);
      ctx.clip();
      ctx.globalAlpha = charConfirmed ? 1.0 : 0.68;
      if (sImg) {
        drawImageFit(ctx, sImg, sx + 4, sy + 4 + slidePx, sw - 8, sh - 8);
      }
      ctx.restore();
    }

    ctx.strokeStyle = charConfirmed ? pColor : charTile ? "#fde047" : "#1e293b";
    ctx.lineWidth = charConfirmed ? 2.5 : 1.5;
    if (charTile && !charConfirmed) ctx.setLineDash([7, 4]);
    ctx.strokeRect(sx, sy, sw, sh);
    ctx.setLineDash([]);

    // Right Info & Assist Slot Area
    const rx = sx + sw + 18;
    ctx.textAlign = "left";
    ctx.fillStyle = pColor;
    ctx.font = `bold 15px ${FONT}`;
    const roleTitle = slot === 0 ? "P1 主控阵容" : this.mode === "VERSUS_2P" ? "P2 对战阵容" : "P2 对手阵容";
    ctx.fillText(roleTitle, rx, y + 30);

    // Main Fighter Name + 3-State Status Pill (`待选择` / `已选择` / `已确定`)
    ctx.fillStyle = charConfirmed ? "#ffffff" : charTile ? "#fde047" : "#64748b";
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText(charTile ? charTile.name : "待选择主战角色", rx, y + 62);

    this.drawStatePill(
      ctx,
      rx,
      y + 72,
      charConfirmed ? "confirmed" : charTile ? "selected" : "idle",
    );

    // Assist Portrait Slot (`68 x 65` matching 100:96 portrait ratio!)
    const ax = rx;
    const ay = y + 104;
    const aw = 68;
    const ah = 65;
    ctx.fillStyle = "#090d16";
    ctx.fillRect(ax, ay, aw, ah);
    const assistTile = dispAssistId ? this.findTile(`a:${dispAssistId}`) : undefined;
    if (assistTile) {
      const aImg = this.cache.get(assistTile.portraitUrl);
      ctx.save();
      ctx.globalAlpha = assistConfirmed ? 1.0 : 0.68;
      if (aImg) drawImageFit(ctx, aImg, ax + 2, ay + 2, aw - 4, ah - 4);
      ctx.restore();
    }
    ctx.strokeStyle = assistConfirmed ? "#f59e0b" : assistTile ? "#fde047" : "#334155";
    ctx.lineWidth = assistConfirmed ? 2.5 : 1.5;
    if (assistTile && !assistConfirmed) ctx.setLineDash([6, 4]);
    ctx.strokeRect(ax, ay, aw, ah);
    ctx.setLineDash([]);

    // Assist corner badge inside slot
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(ax, ay + ah - 15, 32, 15);
    ctx.fillStyle = "#090d16";
    ctx.font = `bold 10px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("援助", ax + 16, ay + ah - 4);

    // Assist Name & Status
    ctx.textAlign = "left";
    ctx.fillStyle = assistConfirmed ? "#ffffff" : assistTile ? "#fde047" : "#64748b";
    ctx.font = `bold 16px ${FONT}`;
    ctx.fillText(assistTile ? assistTile.name : "待选择援助", ax + aw + 12, ay + 26);
    this.drawStatePill(
      ctx,
      ax + aw + 12,
      ay + 36,
      assistConfirmed ? "confirmed" : assistTile ? "selected" : "idle",
    );

    // Action Buttons on the top-right of the Player Card (`确定` when pre-selected, `重选` when confirmed/selected)
    const btnRight = x + w - 14;
    if (hasPendingSelection && isTurn) {
      this.drawActionBtn(ctx, btnRight - 146, y + 12, 68, 30, "确定 ✓", "#16a34a", `confirm:${slot}`, () => {
        this.confirmPendingForSlot(slot);
      });
    }
    if (dispCharId || dispAssistId) {
      this.drawActionBtn(ctx, btnRight - 70, y + 12, 70, 30, "重选", "#334155", `reset:${slot}`, () => {
        this.resetSlot(slot);
        this.audio.playUiBlip(420, 0.04);
      });
    }
  }

  private drawStatePill(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    state: "idle" | "selected" | "confirmed",
  ): void {
    const cfg =
      state === "confirmed"
        ? { bg: "rgba(34, 197, 94, 0.22)", border: "#22c55e", fg: "#4ade80", text: "已确定 ✓" }
        : state === "selected"
          ? { bg: "rgba(250, 204, 21, 0.20)", border: "#fde047", fg: "#fde047", text: "已选择 · 再点确定" }
          : { bg: "rgba(51, 65, 85, 0.35)", border: "#475569", fg: "#94a3b8", text: "待选择" };
    const pw = state === "selected" ? 114 : 68;
    ctx.fillStyle = cfg.bg;
    ctx.fillRect(x, y, pw, 20);
    ctx.strokeStyle = cfg.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, pw, 20);
    ctx.fillStyle = cfg.fg;
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(cfg.text, x + pw * 0.5, y + 14);
  }

  private drawPlayerTurnTab(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    slot: 0 | 1,
    done: boolean,
  ): void {
    const active = this.activeSlot === slot;
    const color = slot === 0 ? "#3b82f6" : "#ef4444";
    ctx.fillStyle = active ? color : "#1e293b";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active || done ? color : "#475569";
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 15px ${FONT}`;
    ctx.textAlign = "center";
    const label = slot === 0 ? (done ? "P1 已就绪 ✓" : "P1 选择中") : done ? "P2 已就绪 ✓" : "P2 选择中";
    ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 5);
    this.hotspots.push({
      x,
      y,
      w,
      h,
      key: `turn:${slot}`,
      onClick: () => {
        this.activeSlot = slot;
        this.audio.playUiBlip(520, 0.03);
      },
    });
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    active: boolean,
    onClick: () => void,
  ): void {
    const hover = this.hoverKey === `btn:${label}`;
    ctx.fillStyle = active ? "#2563eb" : hover ? "#334155" : "#1f2937";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? "#93c5fd" : "#475569";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#f8fafc";
    ctx.font = `bold 14px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 5);
    this.hotspots.push({ x, y, w, h, key: `btn:${label}`, onClick });
  }

  private drawActionBtn(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    bg: string,
    key: string,
    onClick: () => void,
  ): void {
    const hover = this.hoverKey === key;
    ctx.fillStyle = bg;
    ctx.globalAlpha = hover ? 1.0 : 0.9;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 12px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 4.5);
    this.hotspots.push({ x, y, w, h, key, onClick });
  }
}
