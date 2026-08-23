import { describe, expect, it } from "vitest";
import { isPhaseDashed } from "./phaseStyles.js";

describe("isPhaseDashed", () => {
  it("defaults every scope to a solid line", () => {
    expect(isPhaseDashed({}, "annotation")).toBe(false);
    expect(isPhaseDashed({}, "overlay")).toBe(false);
    expect(isPhaseDashed({}, "panel")).toBe(false);
  });

  it("preserves the legacy global dashed setting", () => {
    const legacyPhase = { dashed: true };
    expect(isPhaseDashed(legacyPhase, "annotation")).toBe(true);
    expect(isPhaseDashed(legacyPhase, "overlay")).toBe(true);
    expect(isPhaseDashed(legacyPhase, "panel")).toBe(true);
  });

  it("allows each scope to override the legacy setting independently", () => {
    const phase = {
      dashed: true,
      annotationDashed: false,
      overlayDashed: true,
      panelDashed: false,
    };
    expect(isPhaseDashed(phase, "annotation")).toBe(false);
    expect(isPhaseDashed(phase, "overlay")).toBe(true);
    expect(isPhaseDashed(phase, "panel")).toBe(false);
  });

  it("rejects unknown scopes", () => {
    expect(isPhaseDashed({ dashed: true }, "other")).toBe(false);
  });
});
