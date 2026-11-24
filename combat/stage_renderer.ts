/**
 * Compact 2D Arcade Stage & Framing Camera Renderer (`StageRenderer`).
 *
 * Enforces Section 5.1 Compact Fighting Arena requirements:
 * - Compact fixed stage width (`stage_half_width`), keeping both fighters inside the main combat viewport.
 * - Explicit visual distinction between Stage Corner Boundary Pillars and Screen Viewport Edges.
 * - Stable arcade camera with subtle horizontal pan (`±75px`) and micro-framing (`1.00–1.04x`),
 *   forbidding dramatic zoom-outs or long-distance chase scrolling.
 * - Purely data-driven atmospheric styling read from `IPDefinition.theme`.
 */

import type { CombatConfig, IPDefinition } from "../core/data_models";
import { unitsToPx } from "../core/fixed_math";
import type { SimState } from "../core/sim_state";

export const VIEWPORT_W = 1280;
export const VIEWPORT_H = 720;
export const STAGE_FLOOR_Y = 592;

export interface CameraTransform {
  centerX: number; // world px centered in screen
  zoom: number;    // subtle [1.00 .. 1.04]
  shakeX: number;
  shakeY: number;
}

export class StageRenderer {
  private smoothCenterX = 0;
  private smoothZoom = 1.02;

  public resetCamera(): void {
    this.smoothCenterX = 0;
    this.smoothZoom = 1.02;
  }

  public computeCamera(state: SimState, cfg: CombatConfig): CameraTransform {
    const p1x = unitsToPx(state.fighters[0].posX);
    const p2x = unitsToPx(state.fighters[1].posX);
    const midX = (p1x + p2x) * 0.5;
    const spanPx = Math.abs(p1x - p2x);

    // Clamp camera horizontal pan tightly so compact stage stays anchored
    const halfStagePx = unitsToPx(cfg.stage_half_width);
    const maxPan = Math.max(40, halfStagePx - VIEWPORT_W * 0.44);
    const targetX = Math.max(-maxPan, Math.min(maxPan, midX * 0.35));

    // Micro-zoom between 1.00 (far apart) and 1.04 (close-quarters)
    const closeFactor = Math.max(0, Math.min(1, (520 - spanPx) / 420));
    const targetZoom = 1.0 + closeFactor * 0.04;

    this.smoothCenterX += (targetX - this.smoothCenterX) * 0.22;
    this.smoothZoom += (targetZoom - this.smoothZoom) * 0.15;

    // Subtle hitstop impact micro-shake
    const activeShake =
      Math.max(state.fighters[0].hitstopTicks, state.fighters[1].hitstopTicks) > 6;
    const shakeX = activeShake ? ((state.tick % 2 === 0 ? 1 : -1) * 3) : 0;
    const shakeY = activeShake ? ((state.tick % 3 === 0 ? 1 : -1) * 2) : 0;

    return {
      centerX: this.smoothCenterX,
      zoom: this.smoothZoom,
      shakeX,
      shakeY,
    };
  }

  public applyWorldTransform(ctx: CanvasRenderingContext2D, cam: CameraTransform): void {
    ctx.translate(VIEWPORT_W * 0.5 + cam.shakeX, STAGE_FLOOR_Y + cam.shakeY);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.centerX, -STAGE_FLOOR_Y);
  }

  public renderBackdropAndFloor(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    stageIp: IPDefinition,
    cfg: CombatConfig,
    cam: CameraTransform,
  ): void {
    const theme = stageIp.theme ?? {
      primary_hex: "#ff7a18",
      secondary_hex: "#1e293b",
      accent_hex: "#fbbf24",
      stage_sky_top: "#0f172a",
      stage_sky_bottom: "#334155",
      stage_floor_hex: "#1e293b",
      emblem_label: "CROSS ARENA",
    };

    // 1. Atmospheric Sky Gradient (Screen Space)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, STAGE_FLOOR_Y);
    skyGrad.addColorStop(0, theme.stage_sky_top ?? "#0b1120");
    skyGrad.addColorStop(1, theme.stage_sky_bottom ?? "#1e293b");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);

    // Subtle distant moon / shrine silhouette (Parallax 0.25x)
    ctx.save();
    const paraX = VIEWPORT_W * 0.5 - cam.centerX * 0.25;
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.beginPath();
    ctx.arc(paraX, 205, 118, 0, Math.PI * 2);
    ctx.fill();

    // Distant mountain / fortress ridge
    ctx.fillStyle = "rgba(9, 13, 24, 0.55)";
    ctx.beginPath();
    ctx.moveTo(0, STAGE_FLOOR_Y);
    ctx.lineTo(180 - cam.centerX * 0.3, 360);
    ctx.lineTo(440 - cam.centerX * 0.3, 445);
    ctx.lineTo(640 - cam.centerX * 0.3, 330);
    ctx.lineTo(890 - cam.centerX * 0.3, 440);
    ctx.lineTo(1120 - cam.centerX * 0.3, 355);
    ctx.lineTo(VIEWPORT_W, STAGE_FLOOR_Y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 2. Enter World Camera Space for Compact Arena Floor & Explicit Corner Walls
    ctx.save();
    this.applyWorldTransform(ctx, cam);

    const halfW = unitsToPx(cfg.stage_half_width);

    // Arena Deck Floor
    const floorGrad = ctx.createLinearGradient(0, STAGE_FLOOR_Y - 12, 0, VIEWPORT_H + 40);
    floorGrad.addColorStop(0, theme.stage_floor_hex ?? "#273449");
    floorGrad.addColorStop(1, "#090d16");
    ctx.fillStyle = floorGrad;
    ctx.fillRect(-halfW - 160, STAGE_FLOOR_Y - 6, (halfW + 160) * 2, VIEWPORT_H - STAGE_FLOOR_Y + 80);

    // Perspective stone tiles inside compact arena [-halfW, +halfW]
    ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
    ctx.lineWidth = 2;
    ctx.strokeRect(-halfW, STAGE_FLOOR_Y, halfW * 2, 76);
    for (let gx = -halfW; gx <= halfW; gx += 80) {
      ctx.beginPath();
      ctx.moveTo(gx, STAGE_FLOOR_Y);
      ctx.lineTo(gx * 1.14, STAGE_FLOOR_Y + 95);
      ctx.stroke();
    }

    // Center Arena Line & Emblem Label
    ctx.strokeStyle = theme.primary_hex;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, STAGE_FLOOR_Y);
    ctx.lineTo(0, STAGE_FLOOR_Y + 34);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
    ctx.font = "bold 15px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(theme.emblem_label ?? stageIp.name_en.toUpperCase(), 0, STAGE_FLOOR_Y + 56);

    // Explicit Left & Right Stage Boundary Pillars (Distinct from Screen Edge!)
    for (const side of [-1, 1] as const) {
      const wallX = side * halfW;
      ctx.fillStyle = "#0f172a";
      ctx.strokeStyle = theme.primary_hex;
      ctx.lineWidth = 3;
      const pillarW = 22;
      const px = side < 0 ? wallX - pillarW : wallX;
      ctx.fillRect(px, STAGE_FLOOR_Y - 220, pillarW, 232);
      ctx.strokeRect(px, STAGE_FLOOR_Y - 220, pillarW, 232);

      // Glowing corner boundary energy strip
      ctx.fillStyle = theme.accent_hex;
      ctx.fillRect(wallX - 2, STAGE_FLOOR_Y - 220, 4, 232);
    }

    ctx.restore();

    // 3. Dramatic Super Freeze Darkening Veil (when Ultimate or Awakening triggers)
    if (state.superFreezeTicks > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(4, 7, 15, 0.66)";
      ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);
      ctx.strokeStyle = theme.accent_hex;
      ctx.lineWidth = 4;
      ctx.strokeRect(10, 10, VIEWPORT_W - 20, VIEWPORT_H - 20);
      ctx.restore();
    }
  }
}
