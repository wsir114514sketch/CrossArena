/**
 * Deterministic 60Hz Circular Input Buffer & Motion Command Recognizer.
 *
 * Inspired by Ikemen GO / Rugen / Fray command tables:
 * - Tracks sanitized 16-bit input masks over a fixed history window.
 * - Recognizes classic arcade motions (236 QCF, 214 QCB, 623 DP, 22 Down-Down, 66 Dash, 44 Backdash)
 *   as well as directional + button shortcuts (e.g. 8+Skill, 2+Skill, 6+Attack).
 * - Prevents accidental dashes while holding forward via neutral-release gating (`6, 5, 6`).
 */

import {
  INPUT_AWAKEN,
  INPUT_DASH,
  INPUT_HEAVY,
  INPUT_LIGHT,
  INPUT_MEDIUM,
  INPUT_SKILL_1,
  INPUT_SKILL_2,
  INPUT_SKILL_3,
  INPUT_THROW,
  INPUT_ULTIMATE,
  justPressed,
  sanitizeSocd,
  toNumpadDirection,
} from "../core/input_bits";
import type { FighterSimState } from "../core/sim_state";

export const MAX_INPUT_RING = 32;

export function pushFighterInput(f: FighterSimState, rawMask: number, frozen = false): number {
  const clean = sanitizeSocd(rawMask);
  if (frozen && f.inputRing.length > 0 && f.inputRing[f.inputRing.length - 1] === clean) {
    // Do not age out buffered button rising-edges while frozen in hitstop / super-freeze!
    return clean;
  }
  f.inputRing.push(clean);
  if (f.inputRing.length > MAX_INPUT_RING) {
    f.inputRing.shift();
  }
  return clean;
}

/** Check if any frame within the last `bufferFrames` ticks newly pressed `buttonBit`. */
export function bufferedButtonPress(
  f: FighterSimState,
  buttonBit: number,
  bufferFrames: number,
): boolean {
  const n = f.inputRing.length;
  if (n === 0) return false;
  const span = Math.max(1, bufferFrames);
  const startIdx = Math.max(0, n - span);
  for (let i = n - 1; i >= startIdx; i--) {
    const curr = f.inputRing[i]!;
    const prev = i > 0 ? f.inputRing[i - 1]! : 0;
    if ((justPressed(curr, prev) & buttonBit) !== 0) {
      return true;
    }
  }
  return false;
}

/**
 * Match an ordered sequence of numpad directions (e.g. [2, 3, 6]) within `windowFrames` ticks
 * relative to current fighter `facing`. Intermediate frames are allowed (lenient arcade reader).
 */
export function matchMotionSequence(
  f: FighterSimState,
  sequence: readonly number[],
  windowFrames: number,
): boolean {
  if (sequence.length === 0) return true;
  const n = f.inputRing.length;
  if (n === 0) return false;
  const startIdx = Math.max(0, n - Math.max(2, windowFrames));

  let seqCursor = sequence.length - 1;
  for (let i = n - 1; i >= startIdx; i--) {
    const dir = toNumpadDirection(f.inputRing[i]!, f.facing);
    if (dir === sequence[seqCursor]) {
      seqCursor--;
      if (seqCursor < 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Detect double-tap forward (`6, 5, 6`) or double-tap backward (`4, 5, 4`) on the current frame,
 * or explicit `INPUT_DASH` button with forward/backward direction.
 */
export function detectDashCommand(
  f: FighterSimState,
  windowFrames = 12,
): "forward" | "backward" | null {
  const n = f.inputRing.length;
  if (n === 0) return null;
  const curr = f.inputRing[n - 1]!;
  const prev = n >= 2 ? f.inputRing[n - 2]! : 0;
  const currDir = toNumpadDirection(curr, f.facing);
  const prevDir = toNumpadDirection(prev, f.facing);

  // Dedicated Dash macro button
  if ((justPressed(curr, prev) & INPUT_DASH) !== 0) {
    if (currDir === 4 || currDir === 1 || currDir === 7) {
      return "backward";
    }
    return "forward";
  }

  // Classic 6,5,6 or 4,5,4 tap
  if ((currDir === 6 || currDir === 4) && prevDir !== currDir) {
    const targetDir = currDir;
    let sawNeutralAfterFirstTap = false;
    const minIdx = Math.max(0, n - windowFrames);
    for (let i = n - 2; i >= minIdx; i--) {
      const d = toNumpadDirection(f.inputRing[i]!, f.facing);
      if (d === 5) {
        sawNeutralAfterFirstTap = true;
      } else if (d === targetDir && sawNeutralAfterFirstTap) {
        return targetDir === 6 ? "forward" : "backward";
      } else if (d !== targetDir) {
        break;
      }
    }
  }
  return null;
}

/**
 * Evaluate whether a data-driven skill `input` descriptor is triggered within the buffer window.
 * Supported `SkillDefinition.input` formats:
 * - `"awaken"`
 * - `"skill_ultimate"` / `"236_ultimate"` / `"214_ultimate"`
 * - `"skill_01"` / `"236_skill"` / `"6_skill"`
 * - `"skill_02"` / `"214_skill"` / `"8_skill"`
 * - `"skill_03"` / `"623_skill"` / `"2_skill"`
 */
export function isSkillInputTriggered(
  f: FighterSimState,
  inputSpec: string,
  bufferFrames: number,
  motionWindowFrames: number,
): boolean {
  const n = f.inputRing.length;
  if (n === 0) return false;
  const currDir = toNumpadDirection(f.inputRing[n - 1]!, f.facing);

  if (inputSpec === "awaken") {
    return bufferedButtonPress(f, INPUT_AWAKEN, bufferFrames);
  }

  if (inputSpec === "skill_ultimate" || inputSpec === "ultimate") {
    return (
      bufferedButtonPress(f, INPUT_ULTIMATE, bufferFrames) ||
      (matchMotionSequence(f, [2, 3, 6], motionWindowFrames) &&
        bufferedButtonPress(f, INPUT_HEAVY, bufferFrames) &&
        currDir === 6 &&
        false) // keep explicit Ultimate or 236236+Heavy
    ) || (
      matchMotionSequence(f, [2, 3, 6, 2, 3, 6], motionWindowFrames + 8) &&
      bufferedButtonPress(f, INPUT_HEAVY | INPUT_SKILL_1, bufferFrames)
    );
  }

  if (inputSpec === "skill_01" || inputSpec === "236_skill") {
    return (
      bufferedButtonPress(f, INPUT_SKILL_1, bufferFrames) ||
      (matchMotionSequence(f, [2, 3, 6], motionWindowFrames) &&
        bufferedButtonPress(f, INPUT_LIGHT | INPUT_MEDIUM, bufferFrames))
    );
  }

  if (inputSpec === "skill_02" || inputSpec === "214_skill") {
    return (
      bufferedButtonPress(f, INPUT_SKILL_2, bufferFrames) ||
      (currDir === 8 && bufferedButtonPress(f, INPUT_SKILL_1, bufferFrames)) ||
      (matchMotionSequence(f, [2, 1, 4], motionWindowFrames) &&
        bufferedButtonPress(f, INPUT_LIGHT | INPUT_MEDIUM, bufferFrames))
    );
  }

  if (inputSpec === "skill_03" || inputSpec === "623_skill") {
    return (
      bufferedButtonPress(f, INPUT_SKILL_3, bufferFrames) ||
      ((currDir === 2 || currDir === 1 || currDir === 3) &&
        bufferedButtonPress(f, INPUT_SKILL_1, bufferFrames)) ||
      (matchMotionSequence(f, [6, 2, 3], motionWindowFrames) &&
        bufferedButtonPress(f, INPUT_LIGHT | INPUT_MEDIUM | INPUT_HEAVY, bufferFrames))
    );
  }

  // Fallback generic mapping
  if (inputSpec.includes("ultimate")) {
    return bufferedButtonPress(f, INPUT_ULTIMATE, bufferFrames);
  }
  if (inputSpec.includes("02")) {
    return bufferedButtonPress(f, INPUT_SKILL_2, bufferFrames);
  }
  if (inputSpec.includes("03")) {
    return bufferedButtonPress(f, INPUT_SKILL_3, bufferFrames);
  }
  return bufferedButtonPress(f, INPUT_SKILL_1, bufferFrames);
}

export function isThrowInputTriggered(f: FighterSimState, bufferFrames: number): boolean {
  if (bufferedButtonPress(f, INPUT_THROW, bufferFrames)) {
    return true;
  }
  // Classic SF light + medium simultaneous press
  const n = f.inputRing.length;
  if (n === 0) return false;
  const curr = f.inputRing[n - 1]!;
  const prev = n >= 2 ? f.inputRing[n - 2]! : 0;
  const pressed = justPressed(curr, prev);
  return (curr & INPUT_LIGHT) !== 0 && (curr & INPUT_MEDIUM) !== 0 && (pressed & (INPUT_LIGHT | INPUT_MEDIUM)) !== 0;
}
