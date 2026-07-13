export const CMAPS = {
  plasma: ["#0d0887", "#5b02a3", "#9a179b", "#cb4679", "#ed7953", "#fdb32f", "#f0f921"],
  viridis: ["#440154", "#46327e", "#365c8d", "#277f8e", "#1fa187", "#4ac16d", "#a0da39", "#fde725"],
  inferno: ["#000004", "#320a5e", "#781c6d", "#bc3754", "#ed6925", "#fbb61a", "#fcffa4"],
  magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  cividis: ["#00224e", "#35456c", "#666970", "#948e77", "#c8b866", "#fee838"],
  turbo: ["#30123b", "#4662d7", "#36bbce", "#5fe962", "#d9e735", "#fb8022", "#7a0403"],
  blues: ["#08306b", "#2171b5", "#6baed6", "#c6dbef"],
  greys: ["#111111", "#555555", "#999999", "#cccccc"],
};

export const PHASE_COLORS = [
  "#1f77b4", "#d62728", "#2ca02c", "#9467bd",
  "#ff7f0e", "#8c564b", "#e377c2", "#17becf",
];

export const DEFAULTS = {
  drx: { xmin: 10, xmax: 58, xlabel: "2θ (°, Cu Kα, λ = 1.5406 Å)" },
  raman: { xmin: 100, xmax: 1800, xlabel: "Décalage Raman (cm⁻¹)" },
};

export const INITIAL_SETTINGS = {
  mode: "drx",
  title: "",
  xmin: 10,
  xmax: 58,
  xlabel: DEFAULTS.drx.xlabel,
  ylabel: "Intensité (normalisée, décalée)",
  xTickStep: 0,
  showGrid: false,
  gridOpacity: 0.55,
  smoothW: 3,
  clipPct: 99.5,
  normalizeMode: "minmax",
  vstep: 1.25,
  pxPerUnit: 80,
  lineWidth: 0.9,
  showFill: true,
  fillAlpha: 0.08,
  reverseStack: false,
  cmap: "plasma",
  cmapMin: 0.05,
  cmapMax: 0.85,
  cmapReverse: false,
  useCustomColors: false,
  patternLabelSize: 12,
  patternLabelBold: true,
  showAnnotations: true,
  tickMinI: 1,
  labelMinI: 10,
  labelMinSep: 1.6,
  tickScale: 0.46,
  annotFontSize: 8.5,
  annotGap: 1.06,
  showAbbrevKey: true,
  showPdfPanel: true,
  pdfPanelH: 150,
  pdfStickW: 1,
  showPdfLegend: true,
  showRowLabels: true,
  axisFontSize: 13,
  tickFontSize: 11,
  titleFontSize: 15,
  rightMargin: 145,
  figWidth: 1100,
  pngScale: 2,
  pageBackground: "#ffffff",
  transparentExport: false,
  fileName: "figure_stacked",
};

let idCounter = 1;
export function newId(prefix = "id") {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${idCounter++}_${rand}`;
}

function parseNumberToken(token) {
  const normalized = token.replace(/\s/g, "").replace(",", ".");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Reads the first two numbers found on each line. This handles:
 * 10.25 145.8, 10,25 ; 145,8, 10.25,145.8 and tab-separated files.
 */
export function parseXYText(text) {
  const points = [];
  let ignored = 0;
  const numberPattern = /[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][-+]?\d+)?/;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[#%!]/.test(line)) continue;

    let fields;
    if (/[;\t]/.test(line)) {
      fields = line.split(/[;\t]+/);
    } else if (/\s+/.test(line)) {
      fields = line.split(/\s+/);
    } else if (line.includes(",")) {
      // In a comma-only line, the comma is treated as the CSV delimiter.
      // Decimal commas remain supported in whitespace-, tab- or semicolon-separated files.
      fields = line.split(",");
    } else {
      fields = [line];
    }

    const tokens = fields
      .map((field) => field.match(numberPattern)?.[0] ?? null)
      .filter(Boolean);

    if (tokens.length < 2) {
      ignored += 1;
      continue;
    }
    const x = parseNumberToken(tokens[0]);
    const y = parseNumberToken(tokens[1]);
    if (x === null || y === null) {
      ignored += 1;
      continue;
    }
    points.push([x, y]);
  }

  points.sort((a, b) => a[0] - b[0]);
  const deduped = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (previous && Math.abs(previous[0] - point[0]) < 1e-12) {
      previous[1] = point[1];
    } else {
      deduped.push(point);
    }
  }

  return {
    x: deduped.map((point) => point[0]),
    y: deduped.map((point) => point[1]),
    ignored,
  };
}

export function parseDIFBinary(buffer) {
  try {
    if (buffer.byteLength < 0x2d4) return [];
    const view = new DataView(buffer);
    const count = view.getUint32(0x02d0, true);
    const recordSize = view.getUint32(0x02cc, true);
    if (!count || !recordSize || count * recordSize > buffer.byteLength) return [];
    const dataStart = buffer.byteLength - count * recordSize;
    const peaks = [];

    for (let i = 0; i < count; i += 1) {
      const offset = dataStart + i * recordSize;
      const t2 = view.getFloat64(offset, true);
      const intensity = view.getFloat32(offset + 8, true);
      if (
        Number.isFinite(t2) && Number.isFinite(intensity)
        && t2 >= 2 && t2 <= 180 && intensity > 0
      ) {
        peaks.push([t2, intensity]);
      }
    }
    return normalizePeaks(peaks);
  } catch {
    return [];
  }
}

export function parsePeaksText(text) {
  const { x, y } = parseXYText(text);
  return normalizePeaks(x.map((value, index) => [value, y[index]]));
}

export function normalizePeaks(peaks) {
  if (!peaks.length) return [];
  const maximum = Math.max(...peaks.map((peak) => peak[1]));
  if (!Number.isFinite(maximum) || maximum <= 0) return [];
  return peaks
    .map(([x, intensity]) => [x, (intensity / maximum) * 100])
    .sort((a, b) => a[0] - b[0]);
}

export function mergeDedupPeaks(listA, listB, separation = 0.12) {
  const all = [...listA, ...listB].sort((a, b) => a[0] - b[0]);
  if (!all.length) return [];
  const maximum = Math.max(...all.map((peak) => peak[1]));
  const normalized = all.map(([x, intensity]) => [x, (intensity / maximum) * 100]);
  const result = [normalized[0]];

  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i];
    const previous = result[result.length - 1];
    if (current[0] - previous[0] > separation) result.push(current);
    else if (current[1] > previous[1]) result[result.length - 1] = current;
  }
  return result;
}

export function movingAverage(values, width) {
  const windowSize = Math.max(1, Math.round(width));
  if (windowSize <= 1 || values.length < 3) return values.slice();
  const half = Math.floor(windowSize / 2);
  const prefix = new Array(values.length + 1).fill(0);
  for (let i = 0; i < values.length; i += 1) prefix[i + 1] = prefix[i] + values[i];
  const output = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length - 1, i + half);
    output[i] = (prefix[end + 1] - prefix[start]) / (end - start + 1);
  }
  return output;
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (Math.max(0, Math.min(100, p)) / 100) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function downsampleMinMax(x, y, buckets) {
  const n = x.length;
  if (n <= buckets * 2) return { x, y };
  const bucketSize = Math.ceil(n / buckets);
  const outputX = [];
  const outputY = [];

  for (let start = 0; start < n; start += bucketSize) {
    const end = Math.min(start + bucketSize, n);
    let minIndex = start;
    let maxIndex = start;
    for (let i = start + 1; i < end; i += 1) {
      if (y[i] < y[minIndex]) minIndex = i;
      if (y[i] > y[maxIndex]) maxIndex = i;
    }
    const first = Math.min(minIndex, maxIndex);
    const second = Math.max(minIndex, maxIndex);
    outputX.push(x[first]);
    outputY.push(y[first]);
    if (second !== first) {
      outputX.push(x[second]);
      outputY.push(y[second]);
    }
  }
  return { x: outputX, y: outputY };
}

function trapezoidalArea(x, y) {
  let area = 0;
  for (let i = 1; i < x.length; i += 1) {
    area += Math.abs(x[i] - x[i - 1]) * (Math.abs(y[i]) + Math.abs(y[i - 1])) * 0.5;
  }
  return area;
}

function normalizeSeries(x, y, mode) {
  if (!y.length) return y;
  if (mode === "none") return y.slice();
  if (mode === "max") {
    const maximum = Math.max(...y.map((value) => Math.abs(value))) || 1;
    return y.map((value) => value / maximum);
  }
  if (mode === "area") {
    const area = trapezoidalArea(x, y) || 1;
    return y.map((value) => value / area);
  }
  const minimum = Math.min(...y);
  const maximum = Math.max(...y);
  const range = maximum - minimum || 1;
  return y.map((value) => (value - minimum) / range);
}

export function processPatterns(patterns, settings) {
  const visible = patterns.filter((pattern) => pattern.visible);
  const preliminary = visible.map((pattern) => {
    const xs = [];
    const ys = [];
    const offset = Number.isFinite(pattern.xoffset) ? pattern.xoffset : 0;

    for (let i = 0; i < pattern.x.length; i += 1) {
      const xValue = pattern.x[i] + offset;
      if (xValue >= settings.xmin && xValue <= settings.xmax) {
        xs.push(xValue);
        ys.push(pattern.y[i]);
      }
    }

    if (xs.length < 2) return { ...pattern, px: [], py: [], rawProcessedY: [] };
    let processedY = movingAverage(ys, settings.smoothW);
    if (settings.clipPct < 100) {
      const top = percentile(processedY, settings.clipPct);
      processedY = processedY.map((value) => Math.min(value, top));
    }
    processedY = normalizeSeries(xs, processedY, settings.normalizeMode);
    const scale = Number.isFinite(pattern.yscale) ? pattern.yscale : 1;
    processedY = processedY.map((value) => value * scale);

    return { ...pattern, sourceX: xs, rawProcessedY: processedY };
  });

  let displayMin = 0;
  let displayMax = 1;
  if (settings.normalizeMode === "none") {
    const allValues = preliminary.flatMap((pattern) => pattern.rawProcessedY);
    if (allValues.length) {
      displayMin = Math.min(...allValues);
      displayMax = Math.max(...allValues);
      if (displayMax === displayMin) displayMax = displayMin + 1;
    }
  }

  return preliminary.map((pattern, visibleIndex) => {
    if (!pattern.sourceX?.length) return { ...pattern, stackIndex: visibleIndex };
    const displayY = settings.normalizeMode === "none"
      ? pattern.rawProcessedY.map((value) => (value - displayMin) / (displayMax - displayMin))
      : pattern.rawProcessedY;
    const sampled = downsampleMinMax(pattern.sourceX, displayY, 1800);
    return {
      ...pattern,
      px: sampled.x,
      py: sampled.y,
      stackIndex: settings.reverseStack ? preliminary.length - 1 - visibleIndex : visibleIndex,
    };
  });
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]) {
  const convert = (value) => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
  return `#${convert(r)}${convert(g)}${convert(b)}`;
}

export function cmapColor(name, value) {
  const stops = CMAPS[name] || CMAPS.plasma;
  const scaled = Math.max(0, Math.min(1, value)) * (stops.length - 1);
  const index = Math.min(Math.floor(scaled), stops.length - 2);
  const fraction = scaled - index;
  const from = hexToRgb(stops[index]);
  const to = hexToRgb(stops[index + 1]);
  return rgbToHex([
    from[0] + (to[0] - from[0]) * fraction,
    from[1] + (to[1] - from[1]) * fraction,
    from[2] + (to[2] - from[2]) * fraction,
  ]);
}

export function cmapGradient(name, minimum, maximum, reverse) {
  const colors = Array.from({ length: 12 }, (_, index) => {
    let value = minimum + (maximum - minimum) * (index / 11);
    if (reverse) value = minimum + maximum - value;
    return cmapColor(name, value);
  });
  return `linear-gradient(to right, ${colors.join(",")})`;
}

export function patternColor(pattern, visibleIndex, visibleCount, settings) {
  if (settings.useCustomColors && pattern.color) return pattern.color;
  const fraction = visibleCount <= 1 ? 0 : visibleIndex / (visibleCount - 1);
  let value = settings.cmapMin + (settings.cmapMax - settings.cmapMin) * fraction;
  if (settings.cmapReverse) value = settings.cmapMin + settings.cmapMax - value;
  return cmapColor(settings.cmap, value);
}

export function computeTicks(minimum, maximum, requestedStep = 0) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return [];
  const range = maximum - minimum;
  let step = requestedStep > 0 ? requestedStep : 0;
  if (!step) {
    const raw = range / 9;
    const power = 10 ** Math.floor(Math.log10(raw));
    const candidates = [1, 2, 2.5, 5, 10].map((candidate) => candidate * power);
    step = candidates.find((candidate) => range / candidate <= 11) || candidates[candidates.length - 1];
  }
  const ticks = [];
  for (let value = Math.ceil(minimum / step) * step; value <= maximum + 1e-9; value += step) {
    ticks.push(Math.round(value * 1e6) / 1e6);
  }
  return ticks;
}

export function cardNumber(name) {
  const match = name.match(/\d{2}-\d{3}-\d{4,}/);
  return match ? match[0] : name;
}

export function downloadBlob(content, type, fileName) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 500);
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[;"\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function processedPatternsToCsv(processed) {
  const rows = [["pattern", "x", "processed_intensity"]];
  for (const pattern of processed) {
    for (let i = 0; i < (pattern.sourceX?.length || 0); i += 1) {
      rows.push([pattern.label, pattern.sourceX[i], pattern.rawProcessedY[i]]);
    }
  }
  return rows.map((row) => row.map(escapeCsv).join(";")).join("\n");
}

const DB_NAME = "make-figure-v3";
const STORE_NAME = "sessions";
const AUTOSAVE_KEY = "autosave";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAutosave(project) {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(project, AUTOSAVE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function loadAutosave() {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  const result = await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(AUTOSAVE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return result;
}

export async function clearAutosave() {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(AUTOSAVE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export function validateProject(input) {
  if (!input || typeof input !== "object") throw new Error("Le fichier ne contient pas un objet JSON.");
  const settings = { ...INITIAL_SETTINGS, ...(input.settings || {}) };
  if (!Number.isFinite(settings.xmin) || !Number.isFinite(settings.xmax) || settings.xmax <= settings.xmin) {
    throw new Error("Les limites X de la session sont invalides.");
  }
  const patterns = Array.isArray(input.patterns) ? input.patterns : [];
  const phases = Array.isArray(input.phases) ? input.phases : [];
  const notes = Array.isArray(input.notes) ? input.notes : [];
  for (const pattern of patterns) {
    if (!Array.isArray(pattern.x) || !Array.isArray(pattern.y) || pattern.x.length !== pattern.y.length) {
      throw new Error(`Patron invalide : ${pattern.label || pattern.fileName || "sans nom"}.`);
    }
  }
  return { settings, patterns, phases, notes };
}

export function nearestValue(pattern, x) {
  const xs = pattern.px || [];
  const ys = pattern.py || [];
  if (!xs.length) return null;
  let low = 0;
  let high = xs.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (xs[middle] < x) low = middle + 1;
    else high = middle;
  }
  const candidate = low;
  const previous = Math.max(0, candidate - 1);
  const index = Math.abs(xs[candidate] - x) < Math.abs(xs[previous] - x) ? candidate : previous;
  return { x: xs[index], y: ys[index] };
}
