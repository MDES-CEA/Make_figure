import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync("src/index.css", "utf8");

describe("CSS architecture", () => {
  it("uses functional section names instead of chronological redesign layers", () => {
    const comments = css.match(/\/\*[\s\S]*?\*\//g) || [];
    expect(comments.join("\n")).not.toMatch(/\bv\d+\b|restored\s+v\d+|core workspace redesign/i);
  });

  it("contains no top-level declarations overridden by the same selector", () => {
    expect(() => execFileSync(process.execPath, ["scripts/consolidate-css.mjs"], {
      cwd: process.cwd(),
      stdio: "pipe",
    })).not.toThrow();
  });
});
