import { describe, expect, it } from "vitest";
import { exportScaleLimits, prepareSvgForExport, serializeSvgForExport } from "./exportUtils.js";

function makeSvg() {
  document.body.innerHTML = `
    <svg viewBox="0 0 100 50" width="42" height="21" class="editor-zoom">
      <rect data-figure-background width="100" height="50" fill="#eee" />
      <path id="curve" d="M0 0L100 50" stroke="#000" stroke-width="2.5" vector-effect="non-scaling-stroke" />
      <circle data-ui-only cx="10" cy="10" r="3" />
    </svg>`;
  return document.querySelector("svg");
}

describe("prepareSvgForExport", () => {
  it("normalizes editor zoom and preserves the requested curve width", () => {
    const clone = prepareSvgForExport(makeSvg(), { width: 100, height: 50, background: "#fff" });
    expect(clone.getAttribute("width")).toBe("100");
    expect(clone.getAttribute("height")).toBe("50");
    expect(clone.getAttribute("class")).toBeNull();
    expect(clone.querySelector("[data-ui-only]")).toBeNull();
    expect(clone.querySelector("#curve").getAttribute("stroke-width")).toBe("2.5");
    expect(clone.querySelector("#curve").getAttribute("vector-effect")).toBeNull();
  });

  it("applies transparent and opaque backgrounds", () => {
    const transparent = prepareSvgForExport(makeSvg(), { width: 100, height: 50, transparent: true });
    expect(transparent.querySelector("[data-figure-background]").getAttribute("fill")).toBe("none");

    const opaque = serializeSvgForExport(makeSvg(), { width: 100, height: 50, background: "#123456" });
    expect(opaque).toContain('fill="#123456"');
  });
});

describe("exportScaleLimits", () => {
  it("keeps a normal requested scale", () => {
    expect(exportScaleLimits(1000, 600, 2)).toBe(2);
  });

  it("limits excessive canvas dimensions", () => {
    expect(exportScaleLimits(6000, 3000, 4)).toBeCloseTo(Math.sqrt(28000000 / (6000 * 3000)));
  });
});
