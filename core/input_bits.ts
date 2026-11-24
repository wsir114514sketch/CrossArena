/**
 * Compact deterministic 16-bit input bitmask for 60Hz simulation, replay, and rollback netcode.
 */

export const INPUT_NONE     = 0;
export const INPUT_UP       = 1 << 0;
export const INPUT_DOWN     = 1 << 1;
export const INPUT_LEFT     = 1 << 2;
export const INPUT_RIGHT    = 1 << 3;
export const INPUT_LIGHT    = 1 << 4;
export const INPUT_MEDIUM   = 1 << 5;
export const INPUT_HEAVY    = 1 << 6;
export const INPUT_SKILL_1  = 1 << 7;
export const INPUT_SKILL_2  = 1 << 8;
export const INPUT_SKILL_3  = 1 << 9;
export const INPUT_ULTIMATE = 1 << 10;
export const INPUT_BLOCK    = 1 << 11;
export const INPUT_DASH     = 1 << 12;
export const INPUT_THROW    = 1 << 13;
export const INPUT_AWAKEN   = 1 << 14;
export const INPUT_ASSIST   = 1 << 15;

export const ALL_ATTACK_BITS =
  INPUT_LIGHT |
  INPUT_MEDIUM |
  INPUT_HEAVY |
  INPUT_SKILL_1 |
  INPUT_SKILL_2 |
  INPUT_SKILL_3 |
  INPUT_ULTIMATE |
  INPUT_THROW |
  INPUT_AWAKEN;

/**
 * Neutral Simultaneous Opposite Cardinal Directions (SOCD) cleaning:
 * Left + Right = Neutral, Up + Down = Neutral.
 */
export function sanitizeSocd(mask: number): number {
  let clean = mask & 0xffff;
  if ((clean & INPUT_LEFT) !== 0 && (clean & INPUT_RIGHT) !== 0) {
    clean &= ~(INPUT_LEFT | INPUT_RIGHT);
  }
  if ((clean & INPUT_UP) !== 0 && (clean & INPUT_DOWN) !== 0) {
    clean &= ~(INPUT_UP | INPUT_DOWN);
  }
  return clean;
}

/** Return horizontal axis in {-1, 0, +1} after SOCD sanitization. */
export function horizontalSign(mask: number): -1 | 0 | 1 {
  const c = sanitizeSocd(mask);
  if ((c & INPUT_RIGHT) !== 0) return 1;
  if ((c & INPUT_LEFT) !== 0) return -1;
  return 0;
}

/**
 * Convert world directional bitmask into numpad notation (1..9) relative to fighter facing (+1 right, -1 left):
 * 7 8 9
 * 4 5 6  (6 = forward, 4 = backward, 2 = down, 8 = up, 5 = neutral)
 * 1 2 3
 */
export function toNumpadDirection(mask: number, facing: 1 | -1): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 {
  const c = sanitizeSocd(mask);
  const hx = horizontalSign(c);
  const relX = hx * facing; // +1 forward, -1 back, 0 neutral
  const up = (c & INPUT_UP) !== 0;
  const down = (c & INPUT_DOWN) !== 0;

  if (down) {
    if (relX < 0) return 1;
    if (relX > 0) return 3;
    return 2;
  }
  if (up) {
    if (relX < 0) return 7;
    if (relX > 0) return 9;
    return 8;
  }
  if (relX < 0) return 4;
  if (relX > 0) return 6;
  return 5;
}

/** Bits newly pressed on `curr` that were not held on `prev`. */
export function justPressed(curr: number, prev: number): number {
  return curr & ~prev;
}
