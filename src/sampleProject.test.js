import { describe, expect, it } from "vitest";
import { validateProject } from "./lib.js";
import { makeSampleProject } from "./sampleProject.js";

describe("built-in sample project", () => {
  it("builds a valid multi-technique synthetic hydration study", () => {
    const project = validateProject(makeSampleProject());

    expect(project.version).toBe(18);
    expect(project.name).toContain("exemple synthétique");
    expect(project.activeMode).toBe("drx");
    expect(project.workspaces.drx.patterns).toHaveLength(6);
    expect(project.workspaces.raman.patterns).toHaveLength(6);
    expect(project.workspaces.ir.patterns).toHaveLength(6);
    expect(project.workspaces.drx.phases).toHaveLength(4);
    expect(project.workspaces.raman.zones).toHaveLength(3);
    expect(project.workspaces.ir.zones).toHaveLength(4);
  });

  it("is deterministic and contains no external measurements", () => {
    const first = makeSampleProject();
    const second = makeSampleProject();
    expect(first.workspaces.drx.patterns[0].y).toEqual(second.workspaces.drx.patterns[0].y);
    expect(first.description).toContain("sans mesures expérimentales");
    expect(JSON.stringify(first)).not.toMatch(/RRUFF|User CEA|Manon|X26-/i);
  });

  it("produces finite non-negative spectra", () => {
    const project = makeSampleProject();
    for (const workspace of Object.values(project.workspaces)) {
      for (const curve of workspace.patterns) {
        expect(curve.x.length).toBe(curve.y.length);
        expect(curve.x.length).toBeGreaterThan(1000);
        expect(curve.y.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
      }
    }
  });
});
