import { describe, expect, it } from "vitest";
import { canUpdatePatternField } from "./patternEditing.js";

describe("canUpdatePatternField", () => {
  it("allows every field on an unlocked pattern", () => {
    expect(canUpdatePatternField({ locked: false }, "xoffset")).toBe(true);
    expect(canUpdatePatternField({}, "labelFontSize")).toBe(true);
  });

  it.each(["labelDx", "labelDy", "labelFontSize", "labelBold"])(
    "keeps %s editable on a locked pattern",
    (field) => expect(canUpdatePatternField({ locked: true }, field)).toBe(true),
  );

  it("allows a locked pattern to be unlocked", () => {
    expect(canUpdatePatternField({ locked: true }, "locked")).toBe(true);
  });

  it("continues to protect data transformations on a locked pattern", () => {
    expect(canUpdatePatternField({ locked: true }, "xoffset")).toBe(false);
    expect(canUpdatePatternField({ locked: true }, "yscale")).toBe(false);
    expect(canUpdatePatternField({ locked: true }, "label")).toBe(false);
  });
});
