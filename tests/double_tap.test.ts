import { describe, expect, it } from "vitest";
import { DoubleTapDetector } from "../ui/double_tap";

describe("DoubleTapDetector", () => {
  it("single tap only pre-selects", () => {
    const d = new DoubleTapDetector(300);
    expect(d.tap("a", 1000)).toBe("preselect");
  });

  it("second tap on same target within 300ms confirms", () => {
    const d = new DoubleTapDetector(300);
    d.tap("a", 1000);
    expect(d.tap("a", 1250)).toBe("confirm");
    // sequence resets after confirm
    expect(d.tap("a", 1300)).toBe("preselect");
  });

  it("slow second tap or different target does not confirm", () => {
    const d = new DoubleTapDetector(300);
    d.tap("a", 1000);
    expect(d.tap("a", 1400)).toBe("preselect");
    expect(d.tap("b", 1500)).toBe("preselect");
  });
});
