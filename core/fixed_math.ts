/**
 * Deterministic integer fixed-point math utilities (Decision D4).
 *
 * Simulation rate: 60 Hz (1 tick = 1 simulation frame).
 * Coordinate scale: 1 pixel = 1000 simulation units.
 * Origin (0, 0) = fighter foot ground anchor; +X right, +Y down (ground y = 0, air y < 0).
 * No floating-point values may influence simulation state transitions.
 */

export const SIM_HZ = 60;
export const UNITS_PER_PX = 1000;
export const PERMILLE_BASE = 1000;
export const PERCENT_BASE = 100;

export type IntRect = readonly [number, number, number, number]; // [x, y, w, h]

/** Truncate toward zero integer division (matching C / GDScript integer division). */
export function divTrunc(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero in divTrunc");
  }
  return Math.trunc(a / b) | 0;
}

/** Floor integer division toward -Infinity. */
export function divFloor(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero in divFloor");
  }
  return Math.floor(a / b);
}

/** Ceil integer division for positive denominators. */
export function divCeilPos(a: number, b: number): number {
  if (b <= 0) {
    throw new Error("Denominator must be positive in divCeilPos");
  }
  return Math.floor((a + b - 1) / b);
}

/** Clamp an integer into [lo, hi]. */
export function clampInt(v: number, lo: number, hi: number): number {
  const iv = Math.trunc(v);
  if (iv < lo) return lo;
  if (iv > hi) return hi;
  return iv;
}

/** Convert simulation units to nearest integer render pixel (for presentation only). */
export function unitsToPx(units: number): number {
  return Math.round(units / UNITS_PER_PX);
}

/** Convert pixels to simulation units. */
export function pxToUnits(px: number): number {
  return Math.trunc(px * UNITS_PER_PX);
}

/**
 * Project a local rect [x, y, w, h] at fighter world position (posX, posY) and facing (+1 right, -1 left).
 * Decision D4 mirror formula when facing === -1: [posX - x - w, posY + y, w, h].
 */
export function toWorldRect(localRect: IntRect, posX: number, posY: number, facing: 1 | -1): IntRect {
  const [lx, ly, lw, lh] = localRect;
  if (facing >= 0) {
    return [posX + lx, posY + ly, lw, lh];
  }
  return [posX - lx - lw, posY + ly, lw, lh];
}

/**
 * Strict integer AABB intersection (Decision D4):
 * Touching edges (a.x + a.w === b.x) do NOT overlap.
 */
export function rectsOverlap(a: IntRect, b: IntRect): boolean {
  return (
    a[0] < b[0] + b[2] &&
    b[0] < a[0] + a[2] &&
    a[1] < b[1] + b[3] &&
    b[1] < a[1] + a[3]
  );
}

/** Compute simulation frame capacity of an animation: ceil(frame_count * 60 / animation_fps). */
export function calcAnimSimLength(frameCount: number, animationFps: number): number {
  return divCeilPos(frameCount * SIM_HZ, animationFps);
}

/** Map a simulation tick within an animation to an animation frame index [0 .. frameCount - 1]. */
export function simTickToAnimFrame(
  simTick: number,
  frameCount: number,
  animationFps: number,
  loop: boolean,
): number {
  if (frameCount <= 1) return 0;
  const rawFrame = divFloor(Math.max(0, simTick) * animationFps, SIM_HZ);
  if (loop) {
    return rawFrame % frameCount;
  }
  return Math.min(frameCount - 1, rawFrame);
}
