/**
 * Local 2-Player Keyboard + Gamepad Input Collector.
 *
 * Default Arcade Keybindings:
 * - Player 1: WASD (Move/Jump/Crouch), J (Light), K (Medium), U (Heavy),
 *             I (Skill 1), O (Skill 2), P (Skill 3), H (Ultimate),
 *             L (Dash), semicolon `;` / Space (Block), Y (Throw), N (Awaken), M (Assist).
 * - Player 2: Arrow Keys (Move/Jump/Crouch), Numpad1 / `1` (Light), Numpad2 / `2` (Medium), Numpad4 / `4` (Heavy),
 *             Numpad5 / `5` (Skill 1), Numpad6 / `6` (Skill 2), Numpad3 / `3` (Skill 3), Numpad0 / `0` (Ultimate),
 *             Numpad7 / `7` (Dash), Numpad8 / `8` (Block), Numpad9 / `9` (Throw), `-` (Awaken), `=` (Assist).
 */

import {
  INPUT_ASSIST,
  INPUT_AWAKEN,
  INPUT_BLOCK,
  INPUT_DASH,
  INPUT_DOWN,
  INPUT_HEAVY,
  INPUT_LEFT,
  INPUT_LIGHT,
  INPUT_MEDIUM,
  INPUT_NONE,
  INPUT_RIGHT,
  INPUT_SKILL_1,
  INPUT_SKILL_2,
  INPUT_SKILL_3,
  INPUT_THROW,
  INPUT_ULTIMATE,
  INPUT_UP,
  sanitizeSocd,
} from "../core/input_bits";

const P1_KEY_MAP: Record<string, number> = {
  KeyW: INPUT_UP,
  KeyS: INPUT_DOWN,
  KeyA: INPUT_LEFT,
  KeyD: INPUT_RIGHT,
  KeyJ: INPUT_LIGHT,
  KeyK: INPUT_MEDIUM,
  KeyU: INPUT_HEAVY,
  KeyI: INPUT_SKILL_1,
  KeyO: INPUT_SKILL_2,
  KeyP: INPUT_SKILL_3,
  KeyH: INPUT_ULTIMATE,
  KeyL: INPUT_DASH,
  Semicolon: INPUT_BLOCK,
  KeyY: INPUT_THROW,
  KeyN: INPUT_AWAKEN,
  KeyM: INPUT_ASSIST,
};

const P2_KEY_MAP: Record<string, number> = {
  ArrowUp: INPUT_UP,
  ArrowDown: INPUT_DOWN,
  ArrowLeft: INPUT_LEFT,
  ArrowRight: INPUT_RIGHT,
  Numpad1: INPUT_LIGHT,
  Digit1: INPUT_LIGHT,
  Numpad2: INPUT_MEDIUM,
  Digit2: INPUT_MEDIUM,
  Numpad4: INPUT_HEAVY,
  Digit4: INPUT_HEAVY,
  Numpad5: INPUT_SKILL_1,
  Digit5: INPUT_SKILL_1,
  Numpad6: INPUT_SKILL_2,
  Digit6: INPUT_SKILL_2,
  Numpad3: INPUT_SKILL_3,
  Digit3: INPUT_SKILL_3,
  Numpad0: INPUT_ULTIMATE,
  Digit0: INPUT_ULTIMATE,
  Numpad7: INPUT_DASH,
  Digit7: INPUT_DASH,
  Numpad8: INPUT_BLOCK,
  Digit8: INPUT_BLOCK,
  Numpad9: INPUT_THROW,
  Digit9: INPUT_THROW,
  Minus: INPUT_AWAKEN,
  Equal: INPUT_ASSIST,
};

export class InputCollector {
  private readonly heldCodes = new Set<string>();
  private readonly justPressedCodes = new Set<string>();

  public attach(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("keydown", (e) => {
      if (!this.heldCodes.has(e.code)) {
        this.justPressedCodes.add(e.code);
      }
      this.heldCodes.add(e.code);
      if (
        e.code.startsWith("Arrow") ||
        e.code === "Space" ||
        e.code === "Tab"
      ) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      this.heldCodes.delete(e.code);
    });
    window.addEventListener("blur", () => {
      this.heldCodes.clear();
      this.justPressedCodes.clear();
    });
  }

  public consumeJustPressed(code: string): boolean {
    if (this.justPressedCodes.has(code)) {
      this.justPressedCodes.delete(code);
      return true;
    }
    return false;
  }

  public clearUiJustPressed(): void {
    this.justPressedCodes.clear();
  }

  public readPlayerMask(slot: 0 | 1): number {
    const map = slot === 0 ? P1_KEY_MAP : P2_KEY_MAP;
    let mask = INPUT_NONE;
    for (const code of this.heldCodes) {
      const bit = map[code];
      if (bit !== undefined) {
        mask |= bit;
      }
    }
    mask |= this.readGamepadMask(slot);
    return sanitizeSocd(mask);
  }

  private readGamepadMask(slot: 0 | 1): number {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return 0;
    const pads = navigator.getGamepads();
    const pad = pads[slot];
    if (!pad) return 0;
    let m = 0;
    const axX = pad.axes[0] ?? 0;
    const axY = pad.axes[1] ?? 0;
    if (axX < -0.45 || pad.buttons[14]?.pressed) m |= INPUT_LEFT;
    if (axX > 0.45 || pad.buttons[15]?.pressed) m |= INPUT_RIGHT;
    if (axY < -0.45 || pad.buttons[12]?.pressed) m |= INPUT_UP;
    if (axY > 0.45 || pad.buttons[13]?.pressed) m |= INPUT_DOWN;
    if (pad.buttons[0]?.pressed) m |= INPUT_LIGHT;
    if (pad.buttons[1]?.pressed) m |= INPUT_MEDIUM;
    if (pad.buttons[2]?.pressed) m |= INPUT_HEAVY;
    if (pad.buttons[3]?.pressed) m |= INPUT_SKILL_1;
    if (pad.buttons[4]?.pressed) m |= INPUT_ASSIST;
    if (pad.buttons[5]?.pressed) m |= INPUT_DASH;
    if (pad.buttons[6]?.pressed) m |= INPUT_BLOCK;
    if (pad.buttons[7]?.pressed) m |= INPUT_ULTIMATE;
    if (pad.buttons[8]?.pressed) m |= INPUT_AWAKEN;
    if (pad.buttons[9]?.pressed) m |= INPUT_THROW;
    return m;
  }
}
