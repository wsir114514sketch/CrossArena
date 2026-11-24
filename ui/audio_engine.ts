/**
 * Procedural Web Audio Synthesizer (`AudioEngine`).
 *
 * Zero external unlicensed MP3 dependency: synthesizes crisp arcade hit impacts, sword/fist swings,
 * guard blocks, guard-break shatters, super-freeze chimes, awakening power surges, and K.O. booms.
 * Deduplicates `(tick, type, slot)` keys so Rollback re-simulation never double-plays audio!
 */

import type { SimEvent } from "../core/sim_state";

export class AudioEngine {
  private ctx: AudioContext | null = null;
  public muted = false;
  private readonly playedKeys = new Set<string>();

  public unlock(): void {
    if (this.ctx || typeof window === "undefined") return;
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtor) {
      this.ctx = new AudioCtor();
    }
  }

  public resetMatchAudioHistory(): void {
    this.playedKeys.clear();
  }

  public playUiBlip(freq = 560, durationSec = 0.055): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.25, now + durationSec);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec);
  }

  public consumeSimEvents(events: readonly SimEvent[]): void {
    if (this.muted || events.length === 0) return;
    this.unlock();
    if (!this.ctx) return;

    for (const ev of events) {
      const key = `${ev.tick}:${ev.type}:${ev.slot}`;
      if (this.playedKeys.has(key)) continue;
      this.playedKeys.add(key);

      switch (ev.type) {
        case "swing":
          this.tone(240, 110, 0.06, "sine", 0.05);
          break;
        case "hit":
          this.tone(190, 65, 0.09, "sawtooth", 0.12);
          break;
        case "heavy_hit":
        case "throw_hit":
          this.tone(145, 42, 0.16, "square", 0.16);
          break;
        case "block":
          this.tone(820, 420, 0.07, "triangle", 0.10);
          break;
        case "guard_break":
          this.tone(520, 95, 0.28, "sawtooth", 0.18);
          break;
        case "super_freeze":
          this.tone(320, 980, 0.26, "triangle", 0.15);
          break;
        case "awaken":
          this.tone(220, 880, 0.35, "sawtooth", 0.16);
          break;
        case "assist_call":
          this.tone(440, 660, 0.14, "triangle", 0.11);
          break;
        case "ko":
          this.tone(120, 32, 0.42, "sawtooth", 0.22);
          break;
        default:
          break;
      }
    }
  }

  private tone(
    startFreq: number,
    endFreq: number,
    dur: number,
    wave: OscillatorType,
    vol: number,
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + dur);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }
}
