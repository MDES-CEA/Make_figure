import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const cssPath = path.resolve(process.cwd(), "src/index.css");
const source = fs.readFileSync(cssPath, "utf8");

function braceDepths(text) {
  const depths = new Uint16Array(text.length + 1);
  let depth = 0;
  let quote = null;
  let comment = false;

  for (let index = 0; index < text.length; index += 1) {
    depths[index] = depth;
    const char = text[index];
    const next = text[index + 1];
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        depths[index + 1] = depth;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") {
        depths[index + 1] = depth;
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      comment = true;
      depths[index + 1] = depth;
      index += 1;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  depths[text.length] = depth;
  return depths;
}

function splitDeclarations(body, bodyOffset) {
  const declarations = [];
  let start = 0;
  let quote = null;
  let comment = false;
  let parentheses = 0;

  const append = (end) => {
    const raw = body.slice(start, end);
    const colon = raw.indexOf(":");
    if (colon >= 0) {
      const property = raw.slice(0, colon).replace(/\/\*[\s\S]*?\*\//g, "").trim().toLowerCase();
      if (/^--[\w-]+$|^[a-z-]+$/.test(property)) {
        declarations.push({ property, start: bodyOffset + start, end: bodyOffset + end, raw });
      }
    }
    start = end;
  };

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      parentheses += 1;
    } else if (char === ")") {
      parentheses = Math.max(0, parentheses - 1);
    } else if (char === ";" && parentheses === 0) {
      append(index + 1);
    }
  }
  if (start < body.length) append(body.length);
  return declarations;
}

const depths = braceDepths(source);
const leafRulePattern = /([^{}]+)\{([^{}]*)\}/g;
const occurrences = new Map();
let match;

while ((match = leafRulePattern.exec(source))) {
  const ruleStart = match.index;
  if (depths[ruleStart] !== 0) continue;
  const selector = match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim().replace(/\s+/g, " ");
  if (!selector || selector.startsWith("@")) continue;
  const bodyStart = ruleStart + match[1].length + 1;
  for (const declaration of splitDeclarations(match[2], bodyStart)) {
    const key = `${selector}\u0000${declaration.property}`;
    const list = occurrences.get(key) || [];
    list.push({ ...declaration, selector });
    occurrences.set(key, list);
  }
}

const duplicates = [...occurrences.values()].filter((entries) => entries.length > 1);
if (!process.argv.includes("--write")) {
  for (const entries of duplicates) {
    const lines = entries.map((entry) => source.slice(0, entry.start).split("\n").length).join(", ");
    console.log(`${entries[0].selector} :: ${entries[0].property} (${lines})`);
  }
  console.log(`${duplicates.length} duplicate top-level selector/property pairs.`);
  process.exit(duplicates.length ? 1 : 0);
}

const removals = duplicates
  .flatMap((entries) => entries.slice(0, -1))
  .sort((left, right) => right.start - left.start);
let output = source;
for (const removal of removals) {
  output = output.slice(0, removal.start) + output.slice(removal.end);
}
fs.writeFileSync(cssPath, output);
console.log(`Removed ${removals.length} overridden declarations from ${cssPath}.`);
