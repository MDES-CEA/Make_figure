import { describe, expect, it } from "vitest";
import { createWorkspace, zoneBoundaryEdges } from "./lib.js";

describe("workspace style migration", () => {
  it("adds complete text style defaults to an older workspace", () => {
    const workspace = createWorkspace("drx", { settings: { titleFontSize: 19 } });
    expect(workspace.settings.titleFontSize).toBe(19);
    expect(workspace.settings.titleFontBold).toBe(true);
    expect(workspace.settings.axisFontBold).toBe(false);
    expect(workspace.settings.tickFontBold).toBe(false);
    expect(workspace.settings.referenceRowFontSize).toBe(10.5);
    expect(workspace.settings.insetLabelFontSize).toBe(8);
    expect(workspace.settings.panelTitleFontBold).toBe(true);
    expect(workspace.settings.showPatternLabels).toBe(true);
  });

  it("migrates old notes with a non-bold default", () => {
    const workspace = createWorkspace("raman", { notes: [{ id: "legacy", text: "ancienne note", x: 500 }] });
    expect(workspace.notes[0].bold).toBe(false);
    expect(workspace.notes[0].fontSize).toBe(10);
  });
});

describe("zone boundary handles", () => {
  it("maps the visual handles to xmin/xmax on a normal axis", () => {
    expect(zoneBoundaryEdges(120, 360)).toEqual({ leftEdge: "min", rightEdge: "max" });
  });

  it("swaps the visual handles on a reversed Raman axis", () => {
    expect(zoneBoundaryEdges(360, 120)).toEqual({ leftEdge: "max", rightEdge: "min" });
  });
});
