import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.jsx"), "utf8");
const stylesheet = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");

describe("interface design policy", () => {
  it("does not restore decorative glow or particle hooks", () => {
    expect(appSource).not.toMatch(/app-logo__halo|workspace-asset__glow|workspace-asset__particle|welcome-card__eyebrow/);
    expect(stylesheet).not.toMatch(/card-shine|asset-glow|logo-breathe|drop-shadow\(0 0/);
  });

  it("keeps the application chrome free of the former purple tint", () => {
    expect(stylesheet).not.toMatch(/#(?:7b6cff|7d6dff|8171ff|d85ca4|d95da7|b85f8a|6f7cff)/i);
    expect(stylesheet).not.toMatch(/rgba\((?:111\s*,\s*124\s*,\s*255|129\s*,\s*113\s*,\s*255)/i);
  });

  it("does not use permanence or urgency marketing claims", () => {
    expect(readme).not.toMatch(/free forever|never charge|limited time|act now/i);
  });
});
