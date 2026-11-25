/**
 * Double-tap / double-click detector shared by mouse and touch (driven by pointerdown).
 * First tap on a target = pre-select; second tap on the SAME target within `intervalMs` = confirm.
 */
export class DoubleTapDetector {
  private lastKey = "";
  private lastTime = Number.NEGATIVE_INFINITY;

  constructor(public readonly intervalMs = 300) {}

  public tap(key: string, nowMs: number): "preselect" | "confirm" {
    if (key === this.lastKey && nowMs - this.lastTime <= this.intervalMs) {
      this.reset();
      return "confirm";
    }
    this.lastKey = key;
    this.lastTime = nowMs;
    return "preselect";
  }

  public reset(): void {
    this.lastKey = "";
    this.lastTime = Number.NEGATIVE_INFINITY;
  }
}
