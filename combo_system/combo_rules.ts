/**
 * Combo Scaling, Juggle Limit, Same-Move Protection, and Cancel Chain Rules.
 *
 * Combines KOF/SF cancel hierarchy (Normal -> Command/Heavy -> Special -> Ultimate/Awaken)
 * with anti-infinite protection (damage scaling floor, hitstun decay, juggle cap, same-move cap).
 */

import type { CombatConfig, FrameData } from "../core/data_models";
import { divTrunc, PERCENT_BASE } from "../core/fixed_math";
import type { FighterSimState } from "../core/sim_state";

/** Check if the fighter's current move allows canceling into `targetMoveOrCategory` at `moveTick`. */
export function canCancelCurrentMove(
  f: FighterSimState,
  currentFd: FrameData | undefined,
  targetMoveId: string,
  targetCategory: "normal" | "skill" | "ultimate" | "awaken",
): boolean {
  if (!currentFd || !currentFd.cancel_windows) {
    return false;
  }
  // Only allow attack/skill cancels after at least one hit/block contact has been registered
  // (classic KOF/SF hit-confirm / block-cancel rule; prevents whiff-cancel spam).
  if (f.hitIndicesRegistered.length === 0) {
    return false;
  }

  for (const cw of currentFd.cancel_windows) {
    const [startF, endF] = cw.frames;
    if (f.moveTick < startF || f.moveTick > endF) {
      continue;
    }
    for (const token of cw.into) {
      if (token === targetMoveId) return true;
      if (token === targetCategory) return true;
      if (token === "skill" && (targetCategory === "skill" || targetCategory === "ultimate")) {
        return true;
      }
      if (token === "ultimate" && (targetCategory === "ultimate" || targetCategory === "awaken")) {
        return true;
      }
    }
  }
  return false;
}

/** Compute scaled integer damage based on current combo hit count (0-indexed before increment) and defender defense. */
export function computeScaledDamage(
  rawDamage: number,
  comboHitIndex: number,
  defenderDefense: number,
  cfg: CombatConfig,
): number {
  if (rawDamage <= 0) return 0;
  const table = cfg.damage_scaling_pct;
  const scalePct =
    comboHitIndex < table.length
      ? table[comboHitIndex]!
      : cfg.min_damage_scaling_pct;

  const defSafe = Math.max(50, defenderDefense || 100);
  const scaled = divTrunc(rawDamage * scalePct * PERCENT_BASE, PERCENT_BASE * defSafe);
  return Math.max(1, scaled);
}

/** Apply progressive hitstun decay on long combos to prevent inescapable ground infinites. */
export function computeDecayedHitstun(baseHitstun: number, comboHitIndex: number): number {
  if (baseHitstun <= 0) return 0;
  if (comboHitIndex <= 3) return baseHitstun;
  const decay = Math.min(divTrunc(baseHitstun, 2), (comboHitIndex - 3) * 2);
  return Math.max(6, baseHitstun - decay);
}

/** Check whether an attack is blocked by combo protection (juggle cap or same-move repeat cap). */
export function isComboProtected(
  defender: FighterSimState,
  moveId: string,
  defenderAirborne: boolean,
  cfg: CombatConfig,
): boolean {
  if (defender.comboCounter > 0) {
    const used = defender.moveHitCountsInCombo[moveId] ?? 0;
    if (used >= cfg.same_move_combo_limit) {
      return true;
    }
  }
  if (defenderAirborne && defender.juggleHitsTaken >= cfg.juggle_max_hits) {
    return true;
  }
  return false;
}

/** Reset combo tracking on `defender` once they recover to neutral / wakeup. */
export function resetComboTracking(defender: FighterSimState): void {
  defender.comboCounter = 0;
  defender.comboDamage = 0;
  defender.juggleHitsTaken = 0;
  defender.moveHitCountsInCombo = {};
}
