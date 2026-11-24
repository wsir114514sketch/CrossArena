/**
 * Nearest-Neighbor Pixel Sprite Renderer, VFX Particle System, and Hitbox/Hurtbox/Pushbox Debug Overlay.
 *
 * Strictly Presentation-Only: reads `SimState` without mutating simulation state.
 */

import type {
  AnimationDefinition,
  AssistBundle,
  ContentRegistry,
  FighterBundle,
  SpriteSheetAtlas,
} from "../core/data_models";
import { simTickToAnimFrame, toWorldRect, unitsToPx } from "../core/fixed_math";
import type { AssistSimState, FighterSimState, SimEvent, SimState } from "../core/sim_state";
import { getWorldHurtboxes, getWorldPushbox } from "../hit_system/hit_resolver";

export class SpriteAssetCache {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly failed = new Set<string>();

  public get(url: string): HTMLImageElement | null {
    if (this.failed.has(url)) return null;
    const existing = this.images.get(url);
    if (existing) {
      return existing.complete && existing.naturalWidth > 0 ? existing : null;
    }
    if (typeof Image === "undefined") return null;
    const img = new Image();
    img.decoding = "async";
    img.onerror = () => {
      this.failed.add(url);
    };
    img.src = url.includes("?") ? url : `${url}?v=2`;
    this.images.set(url, img);
    return null;
  }

  public preloadFighterBundle(b: FighterBundle): void {
    this.get(`${b.charDirUrl}/${b.fighter.portrait}`);
    this.get(`${b.charDirUrl}/${b.fighter.splash}`);
    for (const atlas of Object.values(b.spriteAtlases)) {
      this.get(`${b.charDirUrl}/sprites/${atlas.sheet}`);
    }
    for (const sk of b.skills) {
      if (sk.projectile) {
        this.get(`/ip_content/${b.ip.id}/${sk.projectile.effect}`);
      }
    }
  }

  public preloadAssistBundle(ab: AssistBundle): void {
    this.get(`${ab.assistDirUrl}/${ab.assist.portrait}`);
    if (ab.spriteAtlas) {
      this.get(`${ab.assistDirUrl}/sprites/${ab.spriteAtlas.sheet}`);
    }
  }
}

interface VfxSpark {
  xPx: number;
  yPx: number;
  kind: "hit" | "heavy" | "block" | "guard_break" | "awaken";
  age: number;
  maxAge: number;
  color: string;
}

export class BattleEntityRenderer {
  public readonly cache: SpriteAssetCache;
  public showDebugBoxes = false;
  private readonly sparks: VfxSpark[] = [];
  private lastProcessedTick = -1;

  constructor(cache: SpriteAssetCache) {
    this.cache = cache;
  }

  public resetVfx(): void {
    this.sparks.length = 0;
    this.lastProcessedTick = -1;
  }

  public ingestEvents(events: readonly SimEvent[], tick: number): void {
    if (tick !== this.lastProcessedTick) {
      for (const s of this.sparks) s.age += 1;
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        if (this.sparks[i]!.age >= this.sparks[i]!.maxAge) {
          this.sparks.splice(i, 1);
        }
      }
      this.lastProcessedTick = tick;
    }
    for (const ev of events) {
      const xPx = unitsToPx(ev.x);
      const yPx = unitsToPx(ev.y);
      if (ev.type === "hit") {
        this.sparks.push({ xPx, yPx, kind: "hit", age: 0, maxAge: 10, color: "#facc15" });
      } else if (ev.type === "heavy_hit" || ev.type === "throw_hit" || ev.type === "ko") {
        this.sparks.push({ xPx, yPx, kind: "heavy", age: 0, maxAge: 16, color: "#fb7185" });
      } else if (ev.type === "block") {
        this.sparks.push({ xPx, yPx, kind: "block", age: 0, maxAge: 11, color: "#38bdf8" });
      } else if (ev.type === "guard_break") {
        this.sparks.push({ xPx, yPx, kind: "guard_break", age: 0, maxAge: 20, color: "#f43f5e" });
      } else if (ev.type === "awaken" || ev.type === "super_freeze") {
        this.sparks.push({ xPx, yPx, kind: "awaken", age: 0, maxAge: 24, color: "#fbbf24" });
      }
    }
  }

  /** Render shadows, assists, fighters, projectiles, VFX sparks, and optional debug boxes in stage world-pixel space. */
  public renderEntities(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    registry: ContentRegistry,
    floorY: number,
  ): void {
    ctx.imageSmoothingEnabled = false;

    const f0 = state.fighters[0];
    const f1 = state.fighters[1];

    // 1. Ground contact shadows
    for (const f of [f0, f1]) {
      const sx = unitsToPx(f.posX);
      const airHeight = Math.max(0, -unitsToPx(f.posY));
      const radiusX = Math.max(16, 40 - Math.trunc(airHeight * 0.12));
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.46)";
      ctx.beginPath();
      ctx.ellipse(sx, floorY + 3, radiusX, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 2. Active Assists (drawn slightly behind active fighters so main characters stay readable)
    for (const aState of state.assists) {
      if (!aState.active) continue;
      const ab = registry.assistsById[aState.assistId];
      if (ab) {
        this.drawAssistSprite(ctx, aState, ab, floorY);
      }
    }

    // 3. Draw fighters (attacker on top!)
    const p1Attacking = f0.state === "ATTACKING" || f0.state === "SKILL" || f0.state === "ULTIMATE" || f0.state === "AWAKENING";
    const order: readonly [FighterSimState, FighterSimState] = p1Attacking ? [f1, f0] : [f0, f1];

    for (const f of order) {
      const b = registry.fightersById[f.activeFighterId]!;
      this.drawFighterSprite(ctx, state, f, b, floorY);
    }

    // 4. Projectiles
    for (const p of state.projectiles) {
      if (!p.active) continue;
      const px = unitsToPx(p.posX);
      const py = floorY + unitsToPx(p.posY);
      const img = this.cache.get(`/ip_content/${p.ipId}/${p.effectPath}`);
      ctx.save();
      ctx.translate(px, py);
      if (p.facing < 0) ctx.scale(-1, 1);
      if (img) {
        ctx.drawImage(img, -img.naturalWidth * 0.65, -img.naturalHeight * 0.65, img.naturalWidth * 1.3, img.naturalHeight * 1.3);
      } else {
        ctx.fillStyle = "#38bdf8";
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 5. Hit / Block / Guard-Break / Awakening VFX Sparks
    this.drawSparks(ctx, floorY);

    // 6. Debug Hitbox / Hurtbox / Pushbox Overlay
    if (this.showDebugBoxes) {
      this.drawDebugCollisionBoxes(ctx, state, registry, floorY);
    }
  }

  private drawFighterSprite(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    f: FighterSimState,
    bundle: FighterBundle,
    floorY: number,
  ): void {
    const { animId, animTick } = resolveFighterAnimation(state, f, bundle);
    const animDef: AnimationDefinition | undefined =
      bundle.animations[animId] ?? bundle.animations["idle"];
    if (!animDef) return;

    const frameIdx = simTickToAnimFrame(
      animTick,
      animDef.frame_count,
      animDef.animation_fps,
      animDef.loop,
    );
    const screenX = unitsToPx(f.posX);
    const screenY = floorY + unitsToPx(f.posY);

    // Awakening / Invuln aura ring
    if (f.activeFighterId !== f.baseFighterId || f.state === "AWAKENING" || f.state === "ULTIMATE") {
      const accent = bundle.ip.theme?.primary_hex ?? "#fbbf24";
      ctx.save();
      ctx.globalAlpha = 0.28 + 0.12 * Math.sin(state.tick * 0.25);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(screenX, screenY - 58, 46, 68, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const atlas: SpriteSheetAtlas | undefined = bundle.spriteAtlases[animDef.animation_id];
    const [anchorX, anchorY] = animDef.ground_anchor;

    ctx.save();
    ctx.translate(screenX, screenY);
    if (f.facing < 0) {
      ctx.scale(-1, 1);
    }
    if (f.invulnTicks > 0 && state.tick % 4 < 2) {
      ctx.globalAlpha = 0.68;
    }

    let drawn = false;
    if (atlas) {
      const sheetImg = this.cache.get(`${bundle.charDirUrl}/sprites/${atlas.sheet}`);
      const cell = atlas.frames[Math.min(atlas.frames.length - 1, frameIdx)];
      if (sheetImg && cell) {
        const [sx, sy, sw, sh] = cell.rect;
        const [ox, oy] = cell.crop_offset;
        const destX = ox - anchorX;
        const destY = oy - anchorY;
        ctx.drawImage(sheetImg, sx, sy, sw, sh, destX, destY, sw, sh);
        drawn = true;
      }
    }

    if (!drawn) {
      const fStr = String(frameIdx).padStart(3, "0");
      const rawImg = this.cache.get(
        `${bundle.charDirUrl}/${animDef.source_frames}frame_${fStr}.png`,
      );
      if (rawImg) {
        ctx.drawImage(rawImg, -anchorX, -anchorY);
        drawn = true;
      }
    }

    if (!drawn) {
      // Crisp fallback silhouette only while image finishes async decode on first frame
      ctx.fillStyle = bundle.ip.theme?.primary_hex ?? "#60a5fa";
      ctx.fillRect(-26, -118, 52, 118);
    }
    ctx.restore();
  }

  private drawAssistSprite(
    ctx: CanvasRenderingContext2D,
    aState: AssistSimState,
    ab: AssistBundle,
    floorY: number,
  ): void {
    const animDef = ab.animation;
    const frameIdx = simTickToAnimFrame(
      aState.moveTick,
      animDef.frame_count,
      animDef.animation_fps,
      animDef.loop,
    );
    const screenX = unitsToPx(aState.posX);
    const screenY = floorY + unitsToPx(aState.posY);
    const [anchorX, anchorY] = animDef.ground_anchor;

    ctx.save();
    ctx.translate(screenX, screenY);
    if (aState.facing < 0) ctx.scale(-1, 1);
    ctx.globalAlpha = 0.94;

    if (ab.spriteAtlas) {
      const sheetImg = this.cache.get(`${ab.assistDirUrl}/sprites/${ab.spriteAtlas.sheet}`);
      const cell = ab.spriteAtlas.frames[Math.min(ab.spriteAtlas.frames.length - 1, frameIdx)];
      if (sheetImg && cell) {
        const [sx, sy, sw, sh] = cell.rect;
        const [ox, oy] = cell.crop_offset;
        ctx.drawImage(sheetImg, sx, sy, sw, sh, ox - anchorX, oy - anchorY, sw, sh);
      }
    }
    ctx.restore();
  }

  private drawSparks(ctx: CanvasRenderingContext2D, floorY: number): void {
    for (const sp of this.sparks) {
      const t = sp.age / sp.maxAge;
      const sx = sp.xPx;
      const sy = floorY + sp.yPx;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = sp.color;
      ctx.fillStyle = "#ffffff";

      if (sp.kind === "block") {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, 14 + t * 26, -Math.PI * 0.45, Math.PI * 0.45);
        ctx.stroke();
      } else if (sp.kind === "guard_break" || sp.kind === "awaken") {
        const r = 18 + t * 68;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const rays = sp.kind === "heavy" ? 8 : 5;
        const outer = (sp.kind === "heavy" ? 36 : 22) * (0.5 + t);
        ctx.lineWidth = sp.kind === "heavy" ? 3.5 : 2.5;
        for (let i = 0; i < rays; i++) {
          const ang = (i * Math.PI * 2) / rays + t * 0.6;
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(ang) * 6, sy + Math.sin(ang) * 6);
          ctx.lineTo(sx + Math.cos(ang) * outer, sy + Math.sin(ang) * outer);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  private drawDebugCollisionBoxes(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    registry: ContentRegistry,
    floorY: number,
  ): void {
    const drawWorldRect = (
      r: readonly [number, number, number, number],
      fill: string,
      stroke: string,
    ) => {
      const x = unitsToPx(r[0]);
      const y = floorY + unitsToPx(r[1]);
      const w = unitsToPx(r[2]);
      const h = unitsToPx(r[3]);
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    };

    for (const f of state.fighters) {
      const b = registry.fightersById[f.activeFighterId]!;
      const fd = f.currentMoveId ? b.framedata[f.currentMoveId] : undefined;

      // Pushbox (Green)
      drawWorldRect(
        getWorldPushbox(f, b.hurtbox),
        "rgba(34, 197, 94, 0.16)",
        "#22c55e",
      );

      // Hurtboxes (Blue)
      for (const hb of getWorldHurtboxes(f, b.hurtbox, fd)) {
        drawWorldRect(hb, "rgba(56, 189, 248, 0.22)", "#38bdf8");
      }

      // Active Hitboxes (Red)
      if (fd && fd.hitboxes) {
        const evalTick = Math.max(0, f.moveTick - 1);
        for (const atk of fd.hitboxes) {
          if (evalTick >= atk.frames[0] && evalTick <= atk.frames[1]) {
            drawWorldRect(
              toWorldRect(atk.rect, f.posX, f.posY, f.facing),
              "rgba(244, 63, 94, 0.35)",
              "#f43f5e",
            );
          }
        }
      }

      // Ground Anchor Crosshair (Yellow)
      const ax = unitsToPx(f.posX);
      const ay = floorY + unitsToPx(f.posY);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax - 8, ay);
      ctx.lineTo(ax + 8, ay);
      ctx.moveTo(ax, ay - 8);
      ctx.lineTo(ax, ay + 8);
      ctx.stroke();
    }

    // Active Projectile Hitboxes
    for (const p of state.projectiles) {
      if (!p.active) continue;
      drawWorldRect(
        toWorldRect(p.rect, p.posX, p.posY, p.facing),
        "rgba(244, 63, 94, 0.35)",
        "#f43f5e",
      );
    }
  }
}

function resolveFighterAnimation(
  state: SimState,
  f: FighterSimState,
  bundle: FighterBundle,
): { animId: string; animTick: number } {
  if (state.phase === "INTRO") {
    return { animId: bundle.animations["intro"] ? "intro" : "idle", animTick: f.stateTick };
  }
  if (f.state === "VICTORY") {
    return { animId: bundle.animations["victory"] ? "victory" : "idle", animTick: f.stateTick };
  }
  if (f.state === "DEAD") {
    return { animId: bundle.animations["defeat"] ? "defeat" : "knockdown", animTick: f.stateTick };
  }
  if (f.currentMoveId) {
    const fd = bundle.framedata[f.currentMoveId];
    if (fd && bundle.animations[fd.animation_id]) {
      return { animId: fd.animation_id, animTick: f.moveTick };
    }
  }
  switch (f.state) {
    case "WALK_FORWARD":
      return { animId: "walk_forward", animTick: f.stateTick };
    case "WALK_BACKWARD":
      return { animId: "walk_backward", animTick: f.stateTick };
    case "DASH":
    case "BACKDASH":
      return { animId: "dash", animTick: f.stateTick };
    case "CROUCH":
    case "CROUCH_BLOCK":
      return { animId: "crouch", animTick: f.stateTick };
    case "STAND_BLOCK":
    case "BLOCKSTUN":
      return { animId: "block", animTick: f.stateTick };
    case "JUMP":
      return {
        animId: f.stateTick < 6 && bundle.animations["jump_start"] ? "jump_start" : "jump_loop",
        animTick: f.stateTick,
      };
    case "HITSTUN":
    case "GUARD_BREAK":
      return { animId: "hit", animTick: f.stateTick };
    case "AIR_HITSTUN":
    case "KNOCKDOWN":
      return { animId: "knockdown", animTick: f.stateTick };
    case "WAKEUP":
      return { animId: "wakeup", animTick: f.stateTick };
    default:
      return { animId: "idle", animTick: f.stateTick };
  }
}
