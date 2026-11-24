/**
 * Distance-Aware Tactical Fighting AI (`TacticalAiController`).
 *
 * Driven by `character.json` `ai_profile` + selectable difficulty (`EASY`, `NORMAL`, `HARD`).
 * Implements:
 * - Footsies spacing (approach, micro-walk, dash-in, backdash).
 * - Reactive high/low blocking against incoming attacks and projectiles.
 * - Anti-air reaction when opponent jumps in.
 * - Whiff / recovery punishment.
 * - Hit-confirm cancel combos (Light -> Medium -> Heavy -> Special -> Ultimate).
 * - Strategic Awakening transformation and compact Assist summoning.
 */

import type { ContentRegistry } from "../core/data_models";
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
} from "../core/input_bits";
import type { SimState } from "../core/sim_state";

export type AiDifficulty = "EASY" | "NORMAL" | "HARD";

export class TacticalAiController {
  public readonly slot: 0 | 1;
  public difficulty: AiDifficulty;
  private holdMask = INPUT_NONE;
  private holdTicks = 0;

  constructor(slot: 0 | 1, difficulty: AiDifficulty = "NORMAL") {
    this.slot = slot;
    this.difficulty = difficulty;
  }

  public computeInput(state: SimState, registry: ContentRegistry): number {
    if (state.phase !== "FIGHT") {
      this.holdTicks = 0;
      return INPUT_NONE;
    }

    const me = state.fighters[this.slot];
    const opp = state.fighters[this.slot === 0 ? 1 : 0];
    const myBundle = registry.fightersById[me.activeFighterId]!;
    const profile = myBundle.fighter.ai_profile ?? {};

    const forwardBit = me.facing > 0 ? INPUT_RIGHT : INPUT_LEFT;
    const backBit = me.facing > 0 ? INPUT_LEFT : INPUT_RIGHT;
    const dist = Math.abs(me.posX - opp.posX);

    // Deterministic hash from state.tick + positions (zero external state drift)
    const roll = ((state.tick * 1103515245 + Math.abs(me.posX) + opp.hp * 97) >>> 8) % 100;
    const diffScale = this.difficulty === "HARD" ? 100 : this.difficulty === "NORMAL" ? 68 : 36;

    // 1. Hit-confirm cancel chain while our attack is connecting!
    if (
      (me.state === "ATTACKING" || me.state === "SKILL") &&
      me.hitIndicesRegistered.length > 0 &&
      roll < Math.trunc(((profile.combo_focus ?? 0.7) * diffScale))
    ) {
      if (me.state === "SKILL" && me.gauge >= 1000 && opp.hp <= 340) {
        return INPUT_ULTIMATE;
      }
      if (me.currentMoveId === "light_01") return INPUT_MEDIUM;
      if (me.currentMoveId === "light_02" || me.currentMoveId === "medium_01" || me.currentMoveId === "crouch_light") {
        return INPUT_HEAVY;
      }
      if (me.currentMoveId === "heavy_01") {
        return me.gauge >= 1000 && roll < 45 ? INPUT_ULTIMATE : INPUT_SKILL_1;
      }
    }

    // Hold ongoing short movement commitment unless threatened
    const incomingProj = state.projectiles.some(
      (p) => p.active && p.ownerSlot !== this.slot && Math.abs(p.posX - me.posX) < 180000,
    );
    const oppAttackingNear =
      (opp.state === "ATTACKING" || opp.state === "SKILL" || opp.state === "ULTIMATE") &&
      dist < 175000;

    if (this.holdTicks > 0 && !incomingProj && !oppAttackingNear) {
      this.holdTicks -= 1;
      return this.holdMask;
    }

    // 2. Reactive Defense (High vs Low Guard)
    const defChance = Math.trunc((profile.defense ?? 0.65) * diffScale);
    if ((incomingProj || oppAttackingNear) && roll < defChance) {
      const oppBundle = registry.fightersById[opp.activeFighterId]!;
      const oppFd = opp.currentMoveId ? oppBundle.framedata[opp.currentMoveId] : undefined;
      const isLowThreat =
        opp.currentMoveId?.includes("crouch") ||
        oppFd?.hitboxes?.some((h) => h.guard_type === "low");
      const guardMask = isLowThreat
        ? backBit | INPUT_DOWN | INPUT_BLOCK
        : backBit | INPUT_BLOCK;
      this.holdMask = guardMask;
      this.holdTicks = 6;
      return guardMask;
    }

    // 3. Anti-Air when opponent jumps in close
    if (
      opp.posY < -35000 &&
      dist < 165000 &&
      roll < Math.trunc((profile.anti_air ?? 0.65) * diffScale)
    ) {
      return INPUT_SKILL_2;
    }

    // 4. In-Match Awakening when gauge >= 2000 at safe spacing
    const hasAwaken = myBundle.skills.some((s) => s.type === "awaken");
    if (hasAwaken && me.gauge >= 2000 && dist > 130000 && roll < Math.trunc(diffScale * 0.55)) {
      return INPUT_AWAKEN;
    }

    // 5. Assist Summon for pressure or neutral control
    if (
      me.assistId &&
      me.assistCooldownTicks === 0 &&
      !state.assists[this.slot].active &&
      dist < 340000 &&
      roll < Math.trunc((profile.assist_usage ?? 0.55) * (diffScale * 0.35))
    ) {
      return INPUT_ASSIST;
    }

    // 6. Close-range mixups (Throw vs Low vs Light chain vs Guard-break Overhead)
    if (dist <= 95000) {
      if ((opp.state === "STAND_BLOCK" || opp.state === "CROUCH_BLOCK") && roll < Math.trunc(diffScale * 0.45)) {
        return dist <= 78000 ? INPUT_THROW : forwardBit | INPUT_HEAVY;
      }
      if (roll < 28) return INPUT_DOWN | INPUT_LIGHT;
      if (roll < 62) return INPUT_LIGHT;
      if (roll < 80) return INPUT_MEDIUM;
      if (roll < 92) return backBit | INPUT_DASH;
      return INPUT_BLOCK | backBit;
    }

    // 7. Mid-range footsies & whiff punish
    if (dist <= 230000) {
      if (me.gauge >= 1000 && (opp.state === "ATTACKING" || opp.hp <= 250) && roll < Math.trunc(diffScale * 0.42)) {
        return INPUT_ULTIMATE;
      }
      if (roll < 22) return INPUT_SKILL_1;
      if (roll < 36) return INPUT_MEDIUM;
      if (roll < 48) return INPUT_SKILL_3;
      if (roll < 76) {
        this.holdMask = forwardBit;
        this.holdTicks = 8;
        return forwardBit;
      }
      this.holdMask = backBit;
      this.holdTicks = 5;
      return backBit;
    }

    // 8. Far-range compact neutral: projectile poke, dash-in, or jump-in
    if (roll < Math.trunc((profile.zoning ?? 0.5) * 35)) {
      return INPUT_SKILL_3;
    }
    if (roll < 58 && this.difficulty !== "EASY") {
      return forwardBit | INPUT_DASH;
    }
    if (roll < 70) {
      return forwardBit | INPUT_UP;
    }
    this.holdMask = forwardBit;
    this.holdTicks = 12;
    return forwardBit;
  }
}
