/**
 * 4-Layer Dual-IP Character, Form & Assist Select Screen (`SelectScreen`).
 *
 * Strictly implements Section 4.4 4-Layer Selection Architecture (100% Data-Driven from `registry`):
 * - Layer 1: Choose IP (side-by-side IP Cards with theme accents, cover art & roster stats).
 * - Layer 2: Choose Character under the selected IP (categorized grid, Splash Standee, Stats, Skills).
 * - Layer 3: Choose Available Form (Normal / Awakened Forms) + Choose Compact-Stage Assist.
 * - Layer 4: Confirm Ready (P1 & P2/CPU summary + Difficulty + Start Match).
 * Also includes a toggleable Full Roster & Resource Database Drawer (`Tab` or button) displaying
 * `roster_manifest.json` completeness & authorization status!
 */

import type { AiDifficulty } from "../ai_system/tactical_ai";
import type { SpriteAssetCache } from "../animation/fighter_renderer";
import { VIEWPORT_H, VIEWPORT_W } from "../combat/stage_renderer";
import type {
  AssistBundle,
  CharacterGroup,
  ContentRegistry,
  FighterBundle,
  IPDefinition,
} from "../core/data_models";
import type { AudioEngine } from "./audio_engine";
import type { InputCollector } from "./input_collector";

export type GameMode = "VERSUS_CPU" | "VERSUS_2P" | "TRAINING" | "ROLLBACK_LAB";

export interface ClickHotspot {
  x: number;
  y: number;
  w: number;
  h: number;
  onClick: () => void;
}

interface SlotSelectionState {
  layer: 1 | 2 | 3 | 4;
  ipIdx: number;
  charIdx: number;
  formIdx: number;
  assistIdx: number;
}

export interface ConfirmedMatchParticipants {
  p1FighterId: string;
  p2FighterId: string;
  p1AssistId: string | null;
  p2AssistId: string | null;
  stageIpId: string;
  aiDifficulty: AiDifficulty;
}

export class SelectScreen {
  private readonly registry: ContentRegistry;
  private readonly cache: SpriteAssetCache;
  private readonly audio: AudioEngine;
  public mode: GameMode = "VERSUS_CPU";
  public aiDifficulty: AiDifficulty = "NORMAL";
  public showManifestModal = false;
  public manifestIpIdx = 0;

  public activeSlot: 0 | 1 = 0; // In CPU/Training mode, human picks P1 then P2/Dummy!
  public slots: [SlotSelectionState, SlotSelectionState] = [
    { layer: 1, ipIdx: 0, charIdx: 0, formIdx: 0, assistIdx: 0 },
    { layer: 1, ipIdx: 1, charIdx: 0, formIdx: 0, assistIdx: 0 },
  ];

  private hotspots: ClickHotspot[] = [];
  private onMatchConfirmed: ((res: ConfirmedMatchParticipants) => void) | null = null;
  private onBackToTitle: (() => void) | null = null;

  constructor(
    registry: ContentRegistry,
    cache: SpriteAssetCache,
    audio: AudioEngine,
  ) {
    this.registry = registry;
    this.cache = cache;
    this.audio = audio;
    if (this.registry.ips.length < 2) {
      this.slots[1].ipIdx = 0;
    }
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
    this.showManifestModal = false;
    this.slots = [
      { layer: 1, ipIdx: 0, charIdx: 0, formIdx: 0, assistIdx: 0 },
      { layer: 1, ipIdx: Math.min(1, Math.max(0, this.registry.ips.length - 1)), charIdx: 0, formIdx: 0, assistIdx: 0 },
    ];
  }

  public handlePointerClick(canvasX: number, canvasY: number): void {
    for (let i = this.hotspots.length - 1; i >= 0; i--) {
      const h = this.hotspots[i]!;
      if (canvasX >= h.x && canvasX <= h.x + h.w && canvasY >= h.y && canvasY <= h.y + h.h) {
        this.audio.playUiBlip(620, 0.05);
        h.onClick();
        return;
      }
    }
  }

  public updateKeyboard(input: InputCollector): void {
    if (input.consumeJustPressed("Tab")) {
      this.showManifestModal = !this.showManifestModal;
      this.audio.playUiBlip(520, 0.05);
      return;
    }
    if (this.showManifestModal) {
      if (input.consumeJustPressed("Escape")) {
        this.showManifestModal = false;
      } else if (input.consumeJustPressed("KeyA") || input.consumeJustPressed("ArrowLeft")) {
        this.manifestIpIdx = (this.manifestIpIdx + this.registry.ips.length - 1) % Math.max(1, this.registry.ips.length);
      } else if (input.consumeJustPressed("KeyD") || input.consumeJustPressed("ArrowRight")) {
        this.manifestIpIdx = (this.manifestIpIdx + 1) % Math.max(1, this.registry.ips.length);
      }
      return;
    }

    const s = this.slots[this.activeSlot];
    const left = input.consumeJustPressed("KeyA") || input.consumeJustPressed("ArrowLeft");
    const right = input.consumeJustPressed("KeyD") || input.consumeJustPressed("ArrowRight");
    const up = input.consumeJustPressed("KeyW") || input.consumeJustPressed("ArrowUp");
    const down = input.consumeJustPressed("KeyS") || input.consumeJustPressed("ArrowDown");
    const confirm =
      input.consumeJustPressed("KeyJ") ||
      input.consumeJustPressed("Enter") ||
      input.consumeJustPressed("Space");
    const back =
      input.consumeJustPressed("KeyK") ||
      input.consumeJustPressed("Escape") ||
      input.consumeJustPressed("Backspace");

    if (back) {
      this.audio.playUiBlip(380, 0.05);
      this.stepBack();
      return;
    }

    const ip = this.getSelectedIp(this.activeSlot);
    const groups = ip ? (this.registry.groupsByIp[ip.id] ?? []) : [];
    const group = groups[s.charIdx];
    const assists = ip ? (this.registry.assistsByIp[ip.id] ?? []) : [];

    if (s.layer === 1) {
      if ((left || right) && this.registry.ips.length > 1) {
        s.ipIdx = (s.ipIdx + (right ? 1 : this.registry.ips.length - 1)) % this.registry.ips.length;
        s.charIdx = 0;
        s.formIdx = 0;
        s.assistIdx = 0;
        this.audio.playUiBlip(540, 0.04);
      }
      if (confirm && ip) {
        s.layer = 2;
        this.audio.playUiBlip(680, 0.06);
      }
    } else if (s.layer === 2 && groups.length > 0) {
      const cols = 3;
      if (left) s.charIdx = (s.charIdx + groups.length - 1) % groups.length;
      if (right) s.charIdx = (s.charIdx + 1) % groups.length;
      if (up) s.charIdx = (s.charIdx + groups.length - cols) % groups.length;
      if (down) s.charIdx = (s.charIdx + cols) % groups.length;
      if (left || right || up || down) {
        s.formIdx = 0;
        this.audio.playUiBlip(540, 0.04);
      }
      if (confirm) {
        s.layer = 3;
        this.audio.playUiBlip(680, 0.06);
      }
    } else if (s.layer === 3 && group) {
      if (left || right) {
        const fc = group.forms.length;
        if (fc > 1) {
          s.formIdx = (s.formIdx + (right ? 1 : fc - 1)) % fc;
          this.audio.playUiBlip(560, 0.04);
        }
      }
      if ((up || down) && assists.length > 0) {
        const ac = assists.length;
        s.assistIdx = (s.assistIdx + (down ? 1 : ac - 1)) % ac;
        this.audio.playUiBlip(560, 0.04);
      }
      if (confirm) {
        s.layer = 4;
        this.audio.playUiBlip(740, 0.07);
        if (this.activeSlot === 0 && this.slots[1].layer < 4) {
          this.activeSlot = 1;
        }
      }
    } else if (s.layer === 4) {
      if (confirm) {
        if (this.slots[0].layer === 4 && this.slots[1].layer === 4) {
          this.launchConfirmedMatch();
        } else if (this.activeSlot === 0) {
          this.activeSlot = 1;
        }
      }
    }
  }

  private stepBack(): void {
    const s = this.slots[this.activeSlot];
    if (s.layer > 1) {
      s.layer = (s.layer - 1) as 1 | 2 | 3;
    } else if (this.activeSlot === 1) {
      this.activeSlot = 0;
      if (this.slots[0].layer === 4) this.slots[0].layer = 3;
    } else {
      this.onBackToTitle?.();
    }
  }

  private launchConfirmedMatch(): void {
    const b0 = this.getSelectedBundle(0);
    const b1 = this.getSelectedBundle(1);
    if (!b0 || !b1) return;
    const a0 = this.getSelectedAssist(0);
    const a1 = this.getSelectedAssist(1);

    this.cache.preloadFighterBundle(b0);
    this.cache.preloadFighterBundle(b1);
    if (a0) this.cache.preloadAssistBundle(a0);
    if (a1) this.cache.preloadAssistBundle(a1);

    this.onMatchConfirmed?.({
      p1FighterId: b0.fighter.id,
      p2FighterId: b1.fighter.id,
      p1AssistId: a0?.assist.id ?? null,
      p2AssistId: a1?.assist.id ?? null,
      stageIpId: b0.ip.id,
      aiDifficulty: this.aiDifficulty,
    });
  }

  private getSelectedIp(slot: 0 | 1): IPDefinition | undefined {
    return this.registry.ips[this.slots[slot].ipIdx] ?? this.registry.ips[0];
  }

  private getSelectedGroup(slot: 0 | 1): CharacterGroup | undefined {
    const ip = this.getSelectedIp(slot);
    if (!ip) return undefined;
    const list = this.registry.groupsByIp[ip.id] ?? [];
    return list[this.slots[slot].charIdx] ?? list[0];
  }

  private getSelectedBundle(slot: 0 | 1): FighterBundle | undefined {
    const g = this.getSelectedGroup(slot);
    if (!g) return undefined;
    return g.forms[this.slots[slot].formIdx] ?? g.baseBundle;
  }

  private getSelectedAssist(slot: 0 | 1): AssistBundle | undefined {
    const ip = this.getSelectedIp(slot);
    if (!ip) return undefined;
    const list = this.registry.assistsByIp[ip.id] ?? [];
    return list[this.slots[slot].assistIdx] ?? list[0];
  }

  public render(ctx: CanvasRenderingContext2D): void {
    this.hotspots = [];
    ctx.imageSmoothingEnabled = false;

    // Background
    const bg = ctx.createLinearGradient(0, 0, VIEWPORT_W, VIEWPORT_H);
    bg.addColorStop(0, "#090d16");
    bg.addColorStop(0.5, "#111827");
    bg.addColorStop(1, "#090d16");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);

    const s = this.slots[this.activeSlot];
    const activeIp = this.getSelectedIp(this.activeSlot);
    const themeColor = activeIp?.theme?.primary_hex ?? "#ff7a18";

    // Top Navigation Breadcrumb Bar (Showing the 4-Layer Flow explicitly!)
    ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
    ctx.fillRect(0, 0, VIEWPORT_W, 66);
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 66);
    ctx.lineTo(VIEWPORT_W, 66);
    ctx.stroke();

    // Back button
    this.drawButton(ctx, 20, 14, 92, 38, "← 返回", "#334155", () => this.stepBack());

    // 4-Layer Stepper Indicators
    const steps = ["1. 选择 IP 阵营", "2. 选择角色", "3. 选择形态与援助", "4. 确认出战"];
    steps.forEach((label, idx) => {
      const layerNum = (idx + 1) as 1 | 2 | 3 | 4;
      const x = 140 + idx * 205;
      const active = s.layer === layerNum;
      const done = s.layer > layerNum;
      ctx.fillStyle = active ? themeColor : done ? "#1e293b" : "#0f172a";
      ctx.strokeStyle = active || done ? themeColor : "#334155";
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.fillRect(x, 15, 192, 36);
      ctx.strokeRect(x, 15, 192, 36);
      ctx.fillStyle = active ? "#090d16" : done ? "#f8fafc" : "#94a3b8";
      ctx.font = "bold 14px 'Microsoft YaHei UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x + 96, 38);
    });

    // Slot Switcher (P1 vs P2/CPU) + Roster Manifest Button
    const slotLabel =
      this.activeSlot === 0
        ? "当前编辑: P1 主控"
        : this.mode === "VERSUS_2P"
          ? "当前编辑: P2 玩家"
          : "当前编辑: P2 对手";
    this.drawButton(
      ctx,
      972,
      14,
      152,
      38,
      slotLabel,
      this.activeSlot === 0 ? "#2563eb" : "#dc2626",
      () => {
        this.activeSlot = this.activeSlot === 0 ? 1 : 0;
      },
    );
    this.drawButton(ctx, 1134, 14, 126, 38, "角色资源库 [Tab]", "#475569", () => {
      this.showManifestModal = !this.showManifestModal;
    });

    // Left & Right Fighter Preview Columns (Always visible so P1 vs P2 standees frame the center!)
    this.renderSidePreviewCard(ctx, 0, 22, 82, 276, 566);
    this.renderSidePreviewCard(ctx, 1, VIEWPORT_W - 298, 82, 276, 566);

    // Center Interactive Layer Area (`x = 314 .. 966`, `w = 652`)
    const cx = 314;
    const cy = 82;
    const cw = 652;
    const ch = 566;

    if (s.layer === 1) {
      this.renderLayer1IpSelect(ctx, cx, cy, cw, ch);
    } else if (s.layer === 2) {
      this.renderLayer2CharacterGrid(ctx, cx, cy, cw, ch);
    } else if (s.layer === 3) {
      this.renderLayer3FormAndAssist(ctx, cx, cy, cw, ch);
    } else {
      this.renderLayer4ConfirmReady(ctx, cx, cy, cw, ch);
    }

    // Bottom Control Hint Bar
    ctx.fillStyle = "rgba(9, 13, 22, 0.92)";
    ctx.fillRect(0, VIEWPORT_H - 52, VIEWPORT_W, 52);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "14px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      "操作提示：鼠标直接点击卡片 / 键盘 WASD 或方向键移动 · J / Enter 确认进入下一层 · K / Esc 返回上一层 · Tab 查看双 IP 全角色资源盘点库",
      VIEWPORT_W * 0.5,
      VIEWPORT_H - 21,
    );

    if (this.showManifestModal) {
      this.renderRosterManifestModal(ctx);
    }
  }

  private renderSidePreviewCard(
    ctx: CanvasRenderingContext2D,
    slot: 0 | 1,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const s = this.slots[slot];
    const ip = this.getSelectedIp(slot);
    const bundle = this.getSelectedBundle(slot);
    const assist = this.getSelectedAssist(slot);
    const isEditing = this.activeSlot === slot;
    const accent = ip?.theme?.primary_hex ?? (slot === 0 ? "#3b82f6" : "#ef4444");

    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.strokeStyle = isEditing ? accent : "#334155";
    ctx.lineWidth = isEditing ? 3 : 1.5;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    // Header badge
    ctx.fillStyle = slot === 0 ? "#1d4ed8" : "#b91c1c";
    ctx.fillRect(x, y, w, 34);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 15px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "left";
    const pTag = slot === 0 ? "P1 挑战者" : this.mode === "VERSUS_2P" ? "P2 挑战者" : `P2 电脑 (${this.aiDifficulty})`;
    ctx.fillText(pTag, x + 12, y + 23);
    ctx.textAlign = "right";
    ctx.fillStyle = s.layer === 4 ? "#4ade80" : "#fde047";
    ctx.fillText(s.layer === 4 ? "已就绪 READY" : `第 ${s.layer} 层选择中`, x + w - 12, y + 23);

    if (!bundle || !ip) return;

    // Standee splash image
    const splashImg = this.cache.get(`${bundle.charDirUrl}/${bundle.fighter.splash}`);
    if (splashImg) {
      ctx.drawImage(splashImg, x + 18, y + 44, w - 36, 260);
    }

    // IP & Character & Form labels
    ctx.textAlign = "left";
    ctx.fillStyle = accent;
    ctx.font = "bold 13px 'Microsoft YaHei UI', sans-serif";
    ctx.fillText(`【${ip.name_zh} · ${ip.name_en}】`, x + 12, y + 324);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 20px 'Microsoft YaHei UI', sans-serif";
    ctx.fillText(bundle.fighter.name_zh, x + 12, y + 350);

    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 14px 'Microsoft YaHei UI', sans-serif";
    ctx.fillText(`形态：${bundle.fighter.form_name_zh ?? "常态"}`, x + 12, y + 372);

    // Stats bars
    const st = bundle.fighter.stats;
    this.drawStatMiniBar(ctx, x + 12, y + 388, w - 24, "生命 HP", st.max_hp / 1150, "#22c55e");
    this.drawStatMiniBar(ctx, x + 12, y + 410, w - 24, "机动 SPD", st.walk_speed / 6000, "#38bdf8");
    this.drawStatMiniBar(ctx, x + 12, y + 432, w - 24, "防御 DEF", st.defense / 115, "#f59e0b");

    // Signature skills summary
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px 'Microsoft YaHei UI', sans-serif";
    const skLabels = bundle.skills.slice(0, 4).map((sk) => sk.name_zh ?? sk.skill_id);
    ctx.fillText(`必杀：${skLabels.slice(0, 2).join(" / ")}`, x + 12, y + 464);
    if (skLabels.length > 2) {
      ctx.fillText(`奥义：${skLabels.slice(2).join(" / ")}`, x + 12, y + 482);
    }

    // Assist box
    ctx.fillStyle = "rgba(30, 41, 59, 0.9)";
    ctx.fillRect(x + 12, y + 498, w - 24, 54);
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 12, y + 498, w - 24, 54);
    if (assist) {
      const ap = this.cache.get(`${assist.assistDirUrl}/${assist.assist.portrait}`);
      if (ap) ctx.drawImage(ap, x + 16, y + 503, 44, 44);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 13px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(`援助：${assist.assist.name_zh}`, x + 68, y + 521);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(assist.assist.skill_name_zh ?? "", x + 68, y + 540);
    }

    this.hotspots.push({
      x,
      y,
      w,
      h: 40,
      onClick: () => {
        this.activeSlot = slot;
      },
    });
  }

  private renderLayer1IpSelect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const s = this.slots[this.activeSlot];
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 22px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("第一层：选择所属动漫 IP 阵营", x + w * 0.5, y + 32);

    const cardW = 304;
    const cardH = 470;
    this.registry.ips.forEach((ip, idx) => {
      const cx = x + 14 + idx * (cardW + 20);
      const cy = y + 54;
      const selected = s.ipIdx === idx;
      const accent = ip.theme?.primary_hex ?? "#ff7a18";

      ctx.fillStyle = selected ? "rgba(30, 41, 59, 0.96)" : "rgba(15, 23, 42, 0.85)";
      ctx.strokeStyle = selected ? accent : "#334155";
      ctx.lineWidth = selected ? 4 : 1.5;
      ctx.fillRect(cx, cy, cardW, cardH);
      ctx.strokeRect(cx, cy, cardW, cardH);

      const cov = this.cache.get(`/ip_content/${ip.id}/${ip.cover}`);
      if (cov) {
        ctx.drawImage(cov, cx + 12, cy + 12, cardW - 24, 168);
      }

      ctx.fillStyle = accent;
      ctx.font = "bold 28px 'Microsoft YaHei UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ip.name_zh, cx + cardW * 0.5, cy + 222);

      ctx.fillStyle = "#cbd5e1";
      ctx.font = "bold 15px 'Segoe UI', sans-serif";
      ctx.fillText(ip.name_en.toUpperCase(), cx + cardW * 0.5, cy + 246);

      const groups = this.registry.groupsByIp[ip.id] ?? [];
      const totalForms = groups.reduce((acc, g) => acc + g.forms.length, 0);
      const assists = this.registry.assistsByIp[ip.id] ?? [];
      const manifestCount = this.registry.manifestsByIp[ip.id]?.entries.length ?? 0;

      ctx.fillStyle = "#fde047";
      ctx.font = "bold 14px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(
        `实装角色 ${groups.length} 人（${totalForms} 形态）· 援助 ${assists.length} 人`,
        cx + cardW * 0.5,
        cy + 282,
      );
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(`原版资源库已盘点登记：${manifestCount} 条`, cx + cardW * 0.5, cy + 306);

      this.wrapText(ctx, ip.description, cx + 18, cy + 340, cardW - 36, 20, "#cbd5e1", "13px 'Microsoft YaHei UI', sans-serif");

      this.drawButton(
        ctx,
        cx + 42,
        cy + cardH - 58,
        cardW - 84,
        40,
        `进入 ${ip.name_zh} 阵容 →`,
        accent,
        () => {
          s.ipIdx = idx;
          s.charIdx = 0;
          s.formIdx = 0;
          s.assistIdx = 0;
          s.layer = 2;
        },
      );

      this.hotspots.push({
        x: cx,
        y: cy,
        w: cardW,
        h: cardH - 64,
        onClick: () => {
          s.ipIdx = idx;
          s.charIdx = 0;
          s.formIdx = 0;
          s.assistIdx = 0;
          s.layer = 2;
        },
      });
    });
    void h;
  }

  private renderLayer2CharacterGrid(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const s = this.slots[this.activeSlot];
    const ip = this.getSelectedIp(this.activeSlot);
    if (!ip) return;
    const groups = this.registry.groupsByIp[ip.id] ?? [];
    const accent = ip.theme?.primary_hex ?? "#ff7a18";

    ctx.fillStyle = accent;
    ctx.font = "bold 21px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`第二层：【${ip.name_zh}】选择登场角色（共 ${groups.length} 名独立角色）`, x + w * 0.5, y + 28);

    const cols = 3;
    const cellW = 198;
    const cellH = 148;
    groups.forEach((grp, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const gx = x + 16 + col * (cellW + 13);
      const gy = y + 46 + row * (cellH + 12);
      const selected = s.charIdx === idx;

      ctx.fillStyle = selected ? "rgba(30, 41, 59, 0.96)" : "rgba(15, 23, 42, 0.85)";
      ctx.strokeStyle = selected ? accent : "#334155";
      ctx.lineWidth = selected ? 3.5 : 1.5;
      ctx.fillRect(gx, gy, cellW, cellH);
      ctx.strokeRect(gx, gy, cellW, cellH);

      const pImg = this.cache.get(`${grp.baseBundle.charDirUrl}/${grp.baseBundle.fighter.portrait}`);
      if (pImg) {
        ctx.drawImage(pImg, gx + 10, gy + 12, 86, 86);
      }

      ctx.textAlign = "left";
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 16px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(grp.baseBundle.fighter.name_zh, gx + 104, gy + 36);

      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 12px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(`可选形态: ${grp.forms.length} 种`, gx + 104, gy + 60);

      const hasAwaken = grp.baseBundle.skills.some((sk) => sk.type === "awaken");
      ctx.fillStyle = hasAwaken ? "#38bdf8" : "#94a3b8";
      ctx.fillText(hasAwaken ? "支持局内觉醒变身" : "纯粹强化专精", gx + 104, gy + 82);

      ctx.fillStyle = "#cbd5e1";
      ctx.font = "12px 'Microsoft YaHei UI', sans-serif";
      const bioShort = (grp.baseBundle.fighter.bio ?? "").slice(0, 15) + "…";
      ctx.fillText(bioShort, gx + 10, gy + 126);

      this.hotspots.push({
        x: gx,
        y: gy,
        w: cellW,
        h: cellH,
        onClick: () => {
          s.charIdx = idx;
          s.formIdx = 0;
          s.layer = 3;
        },
      });
    });
    void h;
  }

  private renderLayer3FormAndAssist(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const s = this.slots[this.activeSlot];
    const ip = this.getSelectedIp(this.activeSlot);
    const grp = this.getSelectedGroup(this.activeSlot);
    if (!ip || !grp) return;
    const assists = this.registry.assistsByIp[ip.id] ?? [];
    const accent = ip.theme?.primary_hex ?? "#ff7a18";

    ctx.fillStyle = accent;
    ctx.font = "bold 21px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`第三层：【${grp.baseBundle.fighter.name_zh}】选择出战形态 & 援助同伴`, x + w * 0.5, y + 28);

    // Section A: Available Forms
    ctx.textAlign = "left";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 16px 'Microsoft YaHei UI', sans-serif";
    ctx.fillText("A. 选择初始登场形态（战斗中满气亦可按 N / - 触发觉醒变身）：", x + 16, y + 64);

    const fCardW = Math.min(198, Math.floor((w - 48) / Math.max(1, grp.forms.length)) - 8);
    grp.forms.forEach((fb, fIdx) => {
      const fx = x + 16 + fIdx * (fCardW + 10);
      const fy = y + 78;
      const sel = s.formIdx === fIdx;

      ctx.fillStyle = sel ? "rgba(30, 41, 59, 0.98)" : "rgba(15, 23, 42, 0.85)";
      ctx.strokeStyle = sel ? "#fbbf24" : "#334155";
      ctx.lineWidth = sel ? 3.5 : 1.5;
      ctx.fillRect(fx, fy, fCardW, 190);
      ctx.strokeRect(fx, fy, fCardW, 190);

      const pImg = this.cache.get(`${fb.charDirUrl}/${fb.fighter.portrait}`);
      if (pImg) {
        ctx.drawImage(pImg, fx + (fCardW - 84) * 0.5, fy + 12, 84, 84);
      }
      ctx.textAlign = "center";
      ctx.fillStyle = sel ? "#fbbf24" : "#f8fafc";
      ctx.font = "bold 14px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(fb.fighter.form_name_zh ?? fb.fighter.name_zh, fx + fCardW * 0.5, fy + 120);

      const ult = fb.skills.find((sk) => sk.type === "ultimate");
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "12px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(ult?.name_zh ?? "", fx + fCardW * 0.5, fy + 144);
      ctx.fillStyle = "#38bdf8";
      ctx.fillText(`HP ${fb.fighter.stats.max_hp} · SPD ${Math.round(fb.fighter.stats.walk_speed / 100)}`, fx + fCardW * 0.5, fy + 168);

      this.hotspots.push({
        x: fx,
        y: fy,
        w: fCardW,
        h: 190,
        onClick: () => {
          s.formIdx = fIdx;
        },
      });
    });

    // Section B: Compact-Stage Assist Selection
    ctx.textAlign = "left";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 16px 'Microsoft YaHei UI', sans-serif";
    ctx.fillText("B. 选择紧凑擂台援助角色（独立冷却 12s，无身体阻挡，按 M / = 召唤）：", x + 16, y + 302);

    const aCardW = 148;
    assists.forEach((ab, aIdx) => {
      const ax = x + 16 + aIdx * (aCardW + 10);
      const ay = y + 316;
      const sel = s.assistIdx === aIdx;

      ctx.fillStyle = sel ? "rgba(30, 41, 59, 0.98)" : "rgba(15, 23, 42, 0.85)";
      ctx.strokeStyle = sel ? accent : "#334155";
      ctx.lineWidth = sel ? 3 : 1.5;
      ctx.fillRect(ax, ay, aCardW, 152);
      ctx.strokeRect(ax, ay, aCardW, 152);

      const pImg = this.cache.get(`${ab.assistDirUrl}/${ab.assist.portrait}`);
      if (pImg) {
        ctx.drawImage(pImg, ax + (aCardW - 68) * 0.5, ay + 10, 68, 68);
      }
      ctx.textAlign = "center";
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 14px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(ab.assist.name_zh, ax + aCardW * 0.5, ay + 102);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText((ab.assist.skill_name_zh ?? "").slice(0, 10), ax + aCardW * 0.5, ay + 126);

      this.hotspots.push({
        x: ax,
        y: ay,
        w: aCardW,
        h: 152,
        onClick: () => {
          s.assistIdx = aIdx;
        },
      });
    });

    // Confirm Layer 3 -> Layer 4 Button
    this.drawButton(
      ctx,
      x + w * 0.5 - 140,
      y + h - 66,
      280,
      48,
      `锁定 ${this.activeSlot === 0 ? "P1" : "P2"} 角色与援助 →`,
      accent,
      () => {
        s.layer = 4;
        if (this.activeSlot === 0 && this.slots[1].layer < 4) {
          this.activeSlot = 1;
        }
      },
    );
  }

  private renderLayer4ConfirmReady(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const b0 = this.getSelectedBundle(0);
    const b1 = this.getSelectedBundle(1);
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 26px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("第四层：对决阵容确认", x + w * 0.5, y + 48);

    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2.5;
    ctx.fillRect(x + 24, y + 74, w - 48, 310);
    ctx.strokeRect(x + 24, y + 74, w - 48, 310);

    if (b0 && b1) {
      ctx.fillStyle = "#60a5fa";
      ctx.font = "bold 22px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(`${b0.fighter.name_zh}（${b0.fighter.form_name_zh ?? "常态"}）`, x + w * 0.5, y + 132);

      ctx.fillStyle = "#f43f5e";
      ctx.font = "italic bold 32px 'Segoe UI', sans-serif";
      ctx.fillText("VS", x + w * 0.5, y + 182);

      ctx.fillStyle = "#f87171";
      ctx.font = "bold 22px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(`${b1.fighter.name_zh}（${b1.fighter.form_name_zh ?? "常态"}）`, x + w * 0.5, y + 230);

      ctx.fillStyle = "#cbd5e1";
      ctx.font = "15px 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(`战斗擂台：${b0.ip.stage_name_zh ?? b0.ip.name_zh}（紧凑横版街机边界）`, x + w * 0.5, y + 278);
    }

    // AI Difficulty Selector (when applicable)
    if (this.mode === "VERSUS_CPU" || this.mode === "ROLLBACK_LAB") {
      const diffs: AiDifficulty[] = ["EASY", "NORMAL", "HARD"];
      diffs.forEach((d, idx) => {
        const bx = x + 130 + idx * 135;
        this.drawButton(
          ctx,
          bx,
          y + 318,
          120,
          38,
          `AI: ${d}`,
          this.aiDifficulty === d ? "#f59e0b" : "#334155",
          () => {
            this.aiDifficulty = d;
          },
        );
      });
    }

    if (this.slots[1].layer < 4) {
      this.drawButton(
        ctx,
        x + w * 0.5 - 150,
        y + h - 135,
        300,
        48,
        "继续为 P2 选择角色 →",
        "#dc2626",
        () => {
          this.activeSlot = 1;
        },
      );
    }

    // Allow instant launch even if P2 stays on default or after P2 locked
    this.drawButton(
      ctx,
      x + w * 0.5 - 165,
      y + h - 74,
      330,
      54,
      "🔥 开始街机对决 FIGHT! 🔥",
      "#16a34a",
      () => {
        this.slots[0].layer = 4;
        this.slots[1].layer = 4;
        this.launchConfirmedMatch();
      },
    );
  }

  private renderRosterManifestModal(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(3, 7, 18, 0.92)";
    ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);

    const mx = 60;
    const my = 48;
    const mw = VIEWPORT_W - 120;
    const mh = VIEWPORT_H - 96;
    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeRect(mx, my, mw, mh);

    const ip = this.registry.ips[this.manifestIpIdx] ?? this.registry.ips[0];
    const manifest = ip ? this.registry.manifestsByIp[ip.id] : undefined;

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 20px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      `双 IP 全量角色、形态、援助与授权状态盘点库 — 当前显示：${ip?.name_zh ?? ""}（共 ${manifest?.entries.length ?? 0} 项）`,
      mx + 24,
      my + 38,
    );

    this.registry.ips.forEach((itemIp, idx) => {
      this.drawButton(
        ctx,
        mx + mw - 360 + idx * 115,
        my + 12,
        106,
        34,
        itemIp.name_zh,
        this.manifestIpIdx === idx ? (itemIp.theme?.primary_hex ?? "#2563eb") : "#334155",
        () => {
          this.manifestIpIdx = idx;
        },
      );
    });
    this.drawButton(ctx, mx + mw - 118, my + 12, 98, 34, "关闭 [Esc]", "#dc2626", () => {
      this.showManifestModal = false;
    });

    if (!manifest) return;

    const cols = 3;
    const colW = Math.floor((mw - 48) / cols);
    const maxItems = Math.min(manifest.entries.length, 48);
    for (let i = 0; i < maxItems; i++) {
      const e = manifest.entries[i]!;
      const col = Math.floor(i / 16);
      const row = i % 16;
      const rx = mx + 20 + col * colW;
      const ry = my + 74 + row * 32;

      ctx.fillStyle = e.implemented_in_engine ? "rgba(22, 163, 74, 0.18)" : "rgba(51, 65, 85, 0.35)";
      ctx.fillRect(rx, ry - 18, colW - 12, 27);

      ctx.textAlign = "left";
      ctx.fillStyle = e.implemented_in_engine ? "#4ade80" : "#cbd5e1";
      ctx.font = "bold 12px 'Microsoft YaHei UI', sans-serif";
      const catMap: Record<string, string> = {
        playable: "独立角色",
        form: "形态",
        awakening_form: "觉醒形态",
        assist: "援助",
      };
      ctx.fillText(`[${catMap[e.category] ?? e.category}] ${e.name_zh}`, rx + 6, ry);

      ctx.textAlign = "right";
      ctx.fillStyle = e.implemented_in_engine ? "#fde047" : "#94a3b8";
      ctx.font = "11px 'Microsoft YaHei UI', sans-serif";
      const statusTxt = e.implemented_in_engine
        ? "已实装 · 待授权隔离"
        : e.has_xfl_source
          ? "XFL待适配 · 占位"
          : "仅SWF · 缺失占位";
      ctx.fillText(statusTxt, rx + colW - 18, ry);
    }
  }

  private drawStatMiniBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    label: string,
    ratio: number,
    color: string,
  ): void {
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "12px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, x, y + 11);
    const bx = x + 68;
    const bw = w - 68;
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(bx, y + 2, bw, 10);
    ctx.fillStyle = color;
    ctx.fillRect(bx, y + 2, Math.max(8, Math.min(bw, Math.round(bw * ratio))), 10);
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    bgHex: string,
    onClick: () => void,
  ): void {
    ctx.fillStyle = bgHex;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 5);
    this.hotspots.push({ x, y, w, h, onClick });
  }

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    color: string,
    font: string,
  ): void {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = "left";
    let line = "";
    let curY = y;
    for (const ch of text) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line.length > 0) {
        ctx.fillText(line, x, curY);
        line = ch;
        curY += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, curY);
  }
}
