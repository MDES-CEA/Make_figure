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

  baselineMode: "none",
  baselineWindow: 51,
  baselinePolyOrder: 3,
  baselineLambdaLog: 5,
  baselineAsymmetry: 0.02,
  baselineIterations: 8,
  baselineClamp: false,

  layoutMode: "stacked",
  vstep: 1.25,
  waterfallXShift: 0.18,
  waterfallXShiftPct: 1.5,
  differenceReferenceId: "",
  pxPerUnit: 80,
  lineWidth: 0.9,
  showFill: true,
  fillAlpha: 0.08,
  reverseStack: false,

  showDetectedPeaks: false,
  peakMinHeight: 10,
  peakMinProminence: 5,
  peakMinDistance: 0.5,
  peakLookaround: 30,
  peakMaxLabels: 20,
  peakMarkerSize: 3,
  peakLabelSize: 8,

  alignmentReferenceId: "",
  alignmentMaxShift: 1,
  alignmentStep: 0.01,

  ramanAverageMethod: "mean",
  ramanAverageNormalize: "none",
  ramanAverageHideSources: true,

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
  showRowSubtitles: true,
  phaseSubtitleMaxLength: 42,
  axisFontSize: 13,
  tickFontSize: 11,
  titleFontSize: 15,
  rightMargin: 145,
  figWidth: 1100,
  pngScale: 2,
  exportDpi: 300,
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

function arrayMinMax(values) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return values.length ? { minimum, maximum } : { minimum: 0, maximum: 0 };
}

function arrayMaxAbs(values) {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return maximum;
}

/**
 * Reads the first two numbers found on each line. Supports decimal commas,
 * decimal points, semicolon/tab/space separators, and standard CSV.
 */
export function parseXYText(text) {
  const points = [];
  let ignored = 0;
  const numberPattern = /[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][-+]?\d+)?/;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[#%!]/.test(line)) continue;

    let fields;
    if (/[;\t]/.test(line)) fields = line.split(/[;\t]+/);
    else if (/\s+/.test(line)) fields = line.split(/\s+/);
    else if (line.includes(",")) fields = line.split(",");
    else fields = [line];

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
    if (previous && Math.abs(previous[0] - point[0]) < 1e-12) previous[1] = point[1];
    else deduped.push(point);
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
      ) peaks.push([t2, intensity]);
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

export function parseRruffMetadata(text) {
  const metadata = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("##") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(2, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) metadata[key] = value;
  }
  return metadata;
}

/**
 * Converts a continuous Raman reference spectrum into a compact stick list.
 * RRUFF RAW spectra receive a rolling-minimum baseline correction; processed
 * spectra are only lightly smoothed before local maxima are selected.
 */
export function extractRamanReferencePeaks(x, y, options = {}) {
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.length < 5) return [];
  const smoothWindow = Math.max(1, Math.round(options.smoothWindow ?? 7));
  const baselineWindow = Math.max(11, Math.round(options.baselineWindow ?? 151) | 1);
  const minProminencePct = Math.max(0, Number(options.minProminencePct ?? 1));
  const minHeightPct = Math.max(0, Number(options.minHeightPct ?? 1));
  const minDistance = Math.max(0, Number(options.minDistance ?? 5));
  const maxCount = Math.max(1, Math.round(options.maxCount ?? 30));
  const isProcessed = Boolean(options.isProcessed);

  const smoothed = movingAverage(y, smoothWindow);
  let baseline;
  if (isProcessed) {
    const low = percentile(smoothed, 1);
    baseline = new Array(smoothed.length).fill(low);
  } else {
    baseline = movingAverage(movingMinimum(smoothed, baselineWindow), baselineWindow);
  }
  const corrected = smoothed.map((value, index) => Math.max(0, value - baseline[index]));
  const dxValues = [];
  for (let i = 1; i < x.length; i += 1) {
    const dx = x[i] - x[i - 1];
    if (Number.isFinite(dx) && dx > 0) dxValues.push(dx);
  }
  const medianDx = dxValues.length ? percentile(dxValues, 50) : 1;
  const lookaround = Math.max(3, Math.round((options.lookaround ?? 15) / Math.max(medianDx, 1e-9)));
  const detected = detectPeaks(x, corrected, {
    peakMinHeight: minHeightPct,
    peakMinProminence: minProminencePct,
    peakMinDistance: minDistance,
    peakLookaround: lookaround,
  });
  if (!detected.length) return [];

  const selected = detected
    .slice()
    .sort((a, b) => b.prominence - a.prominence || b.y - a.y)
    .slice(0, maxCount);
  const maximum = Math.max(...selected.map((peak) => corrected[peak.index]));
  if (!Number.isFinite(maximum) || maximum <= 0) return [];
  return selected
    .map((peak) => [peak.x, (corrected[peak.index] / maximum) * 100])
    .sort((a, b) => a[0] - b[0]);
}

export function parseReferenceText(text, options = {}) {
  const metadata = parseRruffMetadata(text);
  const parsed = parseXYText(text);
  const fileType = metadata.FILETYPE || "";
  const isRaman = /raman/i.test(fileType) || Boolean(metadata["RAMAN WAVELENGTH"]);
  if (!isRaman) {
    return {
      kind: "peak-list",
      peaks: normalizePeaks(parsed.x.map((value, index) => [value, parsed.y[index]])),
      metadata,
      name: metadata.NAMES || options.fallbackName || "Phase",
    };
  }

  const ramanOptions = {
    smoothWindow: options.smoothWindow ?? 7,
    baselineWindow: options.baselineWindow ?? 151,
    minProminencePct: options.minProminencePct ?? 1,
    minHeightPct: options.minHeightPct ?? 1,
    minDistance: options.minDistance ?? 5,
    maxCount: options.maxCount ?? 30,
    lookaround: options.lookaround ?? 15,
    isProcessed: /processed/i.test(fileType),
  };
  return {
    kind: "raman-spectrum",
    peaks: extractRamanReferencePeaks(parsed.x, parsed.y, ramanOptions),
    metadata,
    name: metadata.NAMES || options.fallbackName || "Référence Raman",
    spectrum: { x: parsed.x, y: parsed.y },
    ramanOptions,
  };
}

/**
 * Parses manual peak definitions. Accepted examples:
 *   107; 280; 713; 750; 1085
 *   107:40; 280:100; 713:65
 *   one "position intensity" pair per line
 */
export function parseManualPeaks(text) {
  const entries = [];
  const numberPattern = /[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][-+]?\d+)?/g;
  const segments = String(text || "")
    .replace(/[−–—]/g, "-")
    .split(/[;\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const matches = segment.match(numberPattern) || [];
    const values = matches.map(parseNumberToken).filter((value) => value !== null);
    if (!values.length) continue;
    const explicitPair = /[:|]/.test(segment) || (/\s+/.test(segment) && values.length === 2 && !/,\s*/.test(segment));
    if (explicitPair && values.length >= 2) entries.push([values[0], Math.max(0, values[1])]);
    else values.forEach((position) => entries.push([position, 100]));
  }

  const sorted = entries
    .filter(([position, intensity]) => Number.isFinite(position) && Number.isFinite(intensity))
    .sort((a, b) => a[0] - b[0]);
  const deduped = [];
  for (const peak of sorted) {
    const previous = deduped[deduped.length - 1];
    if (previous && Math.abs(previous[0] - peak[0]) < 1e-9) previous[1] = Math.max(previous[1], peak[1]);
    else deduped.push(peak);
  }
  return normalizePeaks(deduped);
}

export function formatManualPeaks(peaks) {
  return (peaks || []).map(([position, intensity]) => `${Number(position).toFixed(2)}:${Number(intensity).toFixed(1)}`).join("; ");
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

function movingMinimum(values, width) {
  const windowSize = Math.max(3, Math.round(width) | 1);
  const half = Math.floor(windowSize / 2);
  const output = new Array(values.length);
  const deque = [];
  let right = -1;
  for (let i = 0; i < values.length; i += 1) {
    const desiredRight = Math.min(values.length - 1, i + half);
    while (right < desiredRight) {
      right += 1;
      while (deque.length && values[deque[deque.length - 1]] >= values[right]) deque.pop();
      deque.push(right);
    }
    const left = Math.max(0, i - half);
    while (deque.length && deque[0] < left) deque.shift();
    output[i] = values[deque[0]];
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
    const maximum = arrayMaxAbs(y) || 1;
    return y.map((value) => value / maximum);
  }
  if (mode === "area") {
    const area = trapezoidalArea(x, y) || 1;
    return y.map((value) => value / area);
  }
  const { minimum, maximum } = arrayMinMax(y);
  const range = maximum - minimum || 1;
  return y.map((value) => (value - minimum) / range);
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) < 1e-14) continue;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = a[column][column];
    for (let j = column; j <= n; j += 1) a[column][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      if (!factor) continue;
      for (let j = column; j <= n; j += 1) a[row][j] -= factor * a[column][j];
    }
  }
  return a.map((row) => Number.isFinite(row[n]) ? row[n] : 0);
}

function weightedPolynomialBaseline(x, y, order, asymmetry, iterations) {
  const n = y.length;
  if (n < order + 2) return new Array(n).fill(arrayMinMax(y).minimum);
  const xmin = x[0];
  const xmax = x[x.length - 1];
  const span = xmax - xmin || 1;
  const xn = x.map((value) => ((value - xmin) / span) * 2 - 1);
  const weights = new Array(n).fill(1);
  let coefficients = new Array(order + 1).fill(0);
  let baseline = new Array(n).fill(0);

  for (let iteration = 0; iteration < Math.max(1, iterations); iteration += 1) {
    const matrix = Array.from({ length: order + 1 }, () => new Array(order + 1).fill(0));
    const vector = new Array(order + 1).fill(0);
    for (let i = 0; i < n; i += 1) {
      const powers = new Array(order * 2 + 1).fill(1);
      for (let p = 1; p < powers.length; p += 1) powers[p] = powers[p - 1] * xn[i];
      for (let row = 0; row <= order; row += 1) {
        vector[row] += weights[i] * y[i] * powers[row];
        for (let column = 0; column <= order; column += 1) {
          matrix[row][column] += weights[i] * powers[row + column];
        }
        matrix[row][row] += 1e-10;
      }
    }
    coefficients = solveLinearSystem(matrix, vector);
    baseline = xn.map((value) => {
      let result = 0;
      let power = 1;
      for (const coefficient of coefficients) {
        result += coefficient * power;
        power *= value;
      }
      return result;
    });
    for (let i = 0; i < n; i += 1) weights[i] = y[i] > baseline[i] ? asymmetry : 1 - asymmetry;
  }
  return baseline;
}

function dot(a, b) {
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result += a[i] * b[i];
  return result;
}

function applyWhittakerMatrix(vector, weights, lambda) {
  const output = new Float64Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) output[i] = weights[i] * vector[i];
  for (let i = 0; i < vector.length - 2; i += 1) {
    const secondDifference = vector[i] - 2 * vector[i + 1] + vector[i + 2];
    output[i] += lambda * secondDifference;
    output[i + 1] -= 2 * lambda * secondDifference;
    output[i + 2] += lambda * secondDifference;
  }
  return output;
}

function conjugateGradient(weights, lambda, rhs, initial, maxIterations = 80, tolerance = 1e-7) {
  const x = Float64Array.from(initial);
  const ax = applyWhittakerMatrix(x, weights, lambda);
  const residual = new Float64Array(rhs.length);
  for (let i = 0; i < rhs.length; i += 1) residual[i] = rhs[i] - ax[i];
  const direction = Float64Array.from(residual);
  let residualNorm = dot(residual, residual);
  const initialNorm = Math.max(residualNorm, 1e-30);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const ad = applyWhittakerMatrix(direction, weights, lambda);
    const denominator = dot(direction, ad);
    if (Math.abs(denominator) < 1e-30) break;
    const alpha = residualNorm / denominator;
    for (let i = 0; i < x.length; i += 1) {
      x[i] += alpha * direction[i];
      residual[i] -= alpha * ad[i];
    }
    const nextNorm = dot(residual, residual);
    if (Math.sqrt(nextNorm / initialNorm) < tolerance) break;
    const beta = nextNorm / residualNorm;
    for (let i = 0; i < direction.length; i += 1) direction[i] = residual[i] + beta * direction[i];
    residualNorm = nextNorm;
  }
  return Array.from(x);
}

function asymmetricLeastSquares(y, lambda, asymmetry, iterations) {
  if (y.length < 4) return new Array(y.length).fill(arrayMinMax(y).minimum);
  const weights = new Float64Array(y.length).fill(1);
  let baseline = y.slice();
  for (let iteration = 0; iteration < Math.max(1, iterations); iteration += 1) {
    const rhs = new Float64Array(y.length);
    for (let i = 0; i < y.length; i += 1) rhs[i] = weights[i] * y[i];
    baseline = conjugateGradient(weights, lambda, rhs, baseline);
    for (let i = 0; i < y.length; i += 1) weights[i] = y[i] > baseline[i] ? asymmetry : 1 - asymmetry;
  }
  return baseline;
}

export function estimateBaseline(x, y, settings) {
  if (!y.length || settings.baselineMode === "none") return new Array(y.length).fill(0);
  if (settings.baselineMode === "linear") {
    const edgeCount = Math.max(2, Math.min(Math.floor(y.length * 0.05), 30));
    const first = y.slice(0, edgeCount).reduce((sum, value) => sum + value, 0) / edgeCount;
    const last = y.slice(-edgeCount).reduce((sum, value) => sum + value, 0) / edgeCount;
    const span = x[x.length - 1] - x[0] || 1;
    return x.map((value) => first + ((value - x[0]) / span) * (last - first));
  }
  if (settings.baselineMode === "rolling") {
    const minimum = movingMinimum(y, settings.baselineWindow);
    return movingAverage(minimum, Math.max(3, Math.round(settings.baselineWindow / 2)));
  }
  if (settings.baselineMode === "polynomial") {
    return weightedPolynomialBaseline(
      x,
      y,
      Math.max(1, Math.min(6, Math.round(settings.baselinePolyOrder))),
      Math.max(0.001, Math.min(0.49, settings.baselineAsymmetry)),
      settings.baselineIterations,
    );
  }
  if (settings.baselineMode === "als") {
    const lambda = 10 ** Math.max(1, Math.min(9, settings.baselineLambdaLog));
    return asymmetricLeastSquares(
      y,
      lambda,
      Math.max(0.001, Math.min(0.49, settings.baselineAsymmetry)),
      settings.baselineIterations,
    );
  }
  return new Array(y.length).fill(0);
}

function interpolateLinear(x, y, target) {
  if (!x.length || target < x[0] || target > x[x.length - 1]) return null;
  let low = 0;
  let high = x.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (x[middle] < target) low = middle + 1;
    else high = middle;
  }
  if (x[low] === target || low === 0) return y[low];
  const left = low - 1;
  const span = x[low] - x[left] || 1;
  const fraction = (target - x[left]) / span;
  return y[left] + (y[low] - y[left]) * fraction;
}



function preparePatternForAverage(pattern, normalizeMode = "none") {
  const offset = Number.isFinite(Number(pattern.xoffset)) ? Number(pattern.xoffset) : 0;
  const pairs = pattern.x
    .map((value, index) => [Number(value) + offset, Number(pattern.y[index])])
    .filter(([xValue, yValue]) => Number.isFinite(xValue) && Number.isFinite(yValue))
    .sort((a, b) => a[0] - b[0]);
  const x = [];
  const y = [];
  for (const [xValue, yValue] of pairs) {
    if (x.length && Math.abs(xValue - x[x.length - 1]) < 1e-12) y[y.length - 1] = yValue;
    else { x.push(xValue); y.push(yValue); }
  }
  return {
    pattern,
    x,
    y: normalizeSeries(x, y, normalizeMode),
  };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

/**
 * Builds a derived Raman pattern from several acquisitions. The densest
 * acquisition supplies the output grid; every other acquisition is linearly
 * interpolated on the common overlap. Standard deviation is retained as
 * metadata and exported with the processed CSV.
 */
export function averagePatterns(patterns, options = {}) {
  const usable = patterns
    .filter((pattern) => Array.isArray(pattern?.x) && Array.isArray(pattern?.y) && pattern.x.length >= 2)
    .map((pattern) => preparePatternForAverage(pattern, options.normalizeMode || "none"))
    .filter((pattern) => pattern.x.length >= 2);
  if (usable.length < 2) throw new Error("Sélectionner au moins deux acquisitions valides.");

  const overlapMinimum = Math.max(...usable.map((pattern) => pattern.x[0]));
  const overlapMaximum = Math.min(...usable.map((pattern) => pattern.x[pattern.x.length - 1]));
  if (!(overlapMaximum > overlapMinimum)) throw new Error("Les acquisitions sélectionnées ne possèdent aucune plage X commune.");

  const reference = usable
    .map((pattern) => ({
      ...pattern,
      count: pattern.x.reduce((count, value) => count + (value >= overlapMinimum && value <= overlapMaximum ? 1 : 0), 0),
    }))
    .sort((a, b) => b.count - a.count)[0];
  const grid = reference.x.filter((value) => value >= overlapMinimum && value <= overlapMaximum);
  if (grid.length < 2) throw new Error("La plage commune contient moins de deux points.");

  const method = options.method === "median" ? "median" : "mean";
  const outputGrid = [];
  const mean = [];
  const standardDeviation = [];
  for (const xValue of grid) {
    const values = usable
      .map((pattern) => interpolateLinear(pattern.x, pattern.y, xValue))
      .filter((value) => value !== null && Number.isFinite(value));
    if (values.length !== usable.length) continue;
    const arithmeticMean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const center = method === "median" ? median(values) : arithmeticMean;
    const variance = values.length > 1
      ? values.reduce((sum, value) => sum + (value - arithmeticMean) ** 2, 0) / (values.length - 1)
      : 0;
    outputGrid.push(xValue);
    mean.push(center);
    standardDeviation.push(Math.sqrt(Math.max(0, variance)));
  }

  if (mean.length < 2) throw new Error("Impossible d’interpoler les acquisitions sur une grille commune.");
  const sourceFiles = usable.flatMap(({ pattern }) => pattern.sourceFiles || [pattern.fileName || pattern.label]);
  return {
    id: newId("average"),
    label: options.label?.trim() || `Moyenne Raman (${usable.length} acquisitions)`,
    fileName: `moyenne_raman_${usable.length}_acquisitions`,
    x: outputGrid,
    y: mean,
    stdY: standardDeviation,
    visible: true,
    color: "#111111",
    yscale: 1,
    xoffset: 0,
    isAverage: true,
    replicateCount: usable.length,
    averageMethod: method,
    averageNormalizeMode: options.normalizeMode || "none",
    sourcePatternIds: usable.map(({ pattern }) => pattern.id),
    sourceFiles,
  };
}

export function detectPeaks(x, y, settings) {
  if (!x.length || x.length < 5) return [];
  const { minimum, maximum } = arrayMinMax(y);
  const range = maximum - minimum || 1;
  const heightThreshold = minimum + (settings.peakMinHeight / 100) * range;
  const prominenceThreshold = (settings.peakMinProminence / 100) * range;
  const lookaround = Math.max(2, Math.round(settings.peakLookaround));
  const candidates = [];

  for (let i = 1; i < y.length - 1; i += 1) {
    if (!(y[i] > y[i - 1] && y[i] >= y[i + 1] && y[i] >= heightThreshold)) continue;
    let leftMinimum = y[i];
    let rightMinimum = y[i];
    for (let j = Math.max(0, i - lookaround); j < i; j += 1) leftMinimum = Math.min(leftMinimum, y[j]);
    for (let j = i + 1; j <= Math.min(y.length - 1, i + lookaround); j += 1) rightMinimum = Math.min(rightMinimum, y[j]);
    const prominence = y[i] - Math.max(leftMinimum, rightMinimum);
    if (prominence < prominenceThreshold) continue;
    candidates.push({
      index: i,
      x: x[i],
      y: y[i],
      heightPct: ((y[i] - minimum) / range) * 100,
      prominence,
      prominencePct: (prominence / range) * 100,
    });
  }

  candidates.sort((a, b) => b.prominence - a.prominence || b.y - a.y);
  const kept = [];
  for (const candidate of candidates) {
    if (kept.every((peak) => Math.abs(peak.x - candidate.x) >= settings.peakMinDistance)) kept.push(candidate);
  }
  kept.sort((a, b) => a.x - b.x);
  return kept;
}

function preprocessPattern(pattern, settings, margin = 0) {
  const x = [];
  const raw = [];
  const rawStd = [];
  const offset = Number.isFinite(pattern.xoffset) ? pattern.xoffset : 0;
  for (let i = 0; i < pattern.x.length; i += 1) {
    const xValue = pattern.x[i] + offset;
    if (xValue >= settings.xmin - margin && xValue <= settings.xmax + margin) {
      x.push(xValue);
      raw.push(pattern.y[i]);
      rawStd.push(Array.isArray(pattern.stdY) && Number.isFinite(pattern.stdY[i]) ? pattern.stdY[i] : null);
    }
  }
  if (x.length < 2) return null;
  let smoothed = movingAverage(raw, settings.smoothW);
  if (settings.clipPct < 100) {
    const top = percentile(smoothed, settings.clipPct);
    smoothed = smoothed.map((value) => Math.min(value, top));
  }
  const baseline = estimateBaseline(x, smoothed, settings);
  let corrected = smoothed.map((value, index) => value - baseline[index]);
  if (settings.baselineClamp) corrected = corrected.map((value) => Math.max(0, value));
  const normalized = normalizeSeries(x, corrected, settings.normalizeMode);
  const scale = Number.isFinite(pattern.yscale) ? pattern.yscale : 1;
  return {
    ...pattern,
    sourceX: x,
    sourceRawY: raw,
    sourceStdY: rawStd,
    smoothedY: smoothed,
    baselineY: baseline,
    correctedY: corrected,
    normalizedY: normalized.map((value) => value * scale),
  };
}

export function processPatterns(patterns, settings) {
  const visible = patterns.filter((pattern) => pattern.visible);
  const waterfallPercent = Number.isFinite(Number(settings.waterfallXShiftPct))
    ? Number(settings.waterfallXShiftPct)
    : ((Number(settings.waterfallXShift) || 0) / Math.max(1e-12, settings.xmax - settings.xmin)) * 100;
  const waterfallStep = settings.layoutMode === "waterfall"
    ? ((settings.xmax - settings.xmin) * waterfallPercent) / 100
    : 0;
  const waterfallMargin = Math.abs(waterfallStep) * Math.max(0, visible.length - 1);
  const preliminary = visible
    .map((pattern) => preprocessPattern(pattern, settings, waterfallMargin))
    .filter(Boolean);

  const referenceId = settings.differenceReferenceId || preliminary[0]?.id;
  const reference = preliminary.find((pattern) => pattern.id === referenceId) || preliminary[0];

  const transformed = preliminary.map((pattern) => {
    let processedY = pattern.normalizedY.slice();
    if (settings.layoutMode === "difference" && reference) {
      processedY = pattern.sourceX.map((xValue, index) => {
        const refValue = interpolateLinear(reference.sourceX, reference.normalizedY, xValue);
        return refValue === null ? 0 : pattern.normalizedY[index] - refValue;
      });
    }
    return { ...pattern, processedY };
  });

  let globalScale = 1;
  if (settings.normalizeMode === "none") {
    globalScale = 1e-12;
    for (const pattern of transformed) globalScale = Math.max(globalScale, arrayMaxAbs(pattern.processedY));
  }

  return transformed.map((pattern, visibleIndex) => {
    const stackIndex = settings.reverseStack ? transformed.length - 1 - visibleIndex : visibleIndex;
    const stackOffset = settings.layoutMode === "overlay" ? 0 : stackIndex * settings.vstep;
    const waterfallShift = settings.layoutMode === "waterfall" ? stackIndex * waterfallStep : 0;
    const displayX = pattern.sourceX.map((value) => value + waterfallShift);
    const displayY = settings.normalizeMode === "none"
      ? pattern.processedY.map((value) => value / globalScale)
      : pattern.processedY.slice();
    const sampled = downsampleMinMax(displayX, displayY, 1800);
    const detectedPeaks = detectPeaks(pattern.sourceX, pattern.processedY, settings).map((peak) => ({
      ...peak,
      displayX: peak.x + waterfallShift,
      displayY: settings.normalizeMode === "none" ? peak.y / globalScale : peak.y,
    }));
    const displayRange = arrayMinMax(displayY);
    const displayMinimum = displayY.length ? displayRange.minimum : 0;
    const displayMaximum = displayY.length ? displayRange.maximum : 1;
    return {
      ...pattern,
      displayX,
      displayY,
      px: sampled.x,
      py: sampled.y,
      stackIndex,
      stackOffset,
      waterfallShift,
      detectedPeaks,
      displayMinimum,
      displayMaximum,
      isDifferenceReference: settings.layoutMode === "difference" && pattern.id === reference?.id,
    };
  });
}

function correlation(valuesA, valuesB) {
  if (valuesA.length < 3 || valuesA.length !== valuesB.length) return -Infinity;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < valuesA.length; i += 1) {
    meanA += valuesA[i];
    meanB += valuesB[i];
  }
  meanA /= valuesA.length;
  meanB /= valuesB.length;
  let numerator = 0;
  let denominatorA = 0;
  let denominatorB = 0;
  for (let i = 0; i < valuesA.length; i += 1) {
    const da = valuesA[i] - meanA;
    const db = valuesB[i] - meanB;
    numerator += da * db;
    denominatorA += da * da;
    denominatorB += db * db;
  }
  const denominator = Math.sqrt(denominatorA * denominatorB);
  return denominator > 0 ? numerator / denominator : -Infinity;
}

export function estimateCorrelationShift(referencePattern, targetPattern, settings) {
  const maxShift = Math.max(0, Number(settings.alignmentMaxShift) || 0);
  const step = Math.max(1e-5, Number(settings.alignmentStep) || 0.01);
  const reference = preprocessPattern(referencePattern, { ...settings, normalizeMode: "minmax" }, maxShift);
  const target = preprocessPattern(targetPattern, { ...settings, normalizeMode: "minmax" }, maxShift);
  if (!reference || !target) return { shift: 0, score: null };

  const start = Math.max(settings.xmin, reference.sourceX[0]);
  const end = Math.min(settings.xmax, reference.sourceX.at(-1));
  if (end <= start) return { shift: 0, score: null };
  const sampleCount = Math.min(1600, Math.max(120, Math.round((end - start) / step)));
  const gridStep = (end - start) / Math.max(1, sampleCount - 1);
  const grid = Array.from({ length: sampleCount }, (_, index) => start + index * gridStep);

  let bestShift = 0;
  let bestScore = -Infinity;
  const numberOfSteps = Math.max(1, Math.floor((maxShift * 2) / step));
  for (let shiftIndex = 0; shiftIndex <= numberOfSteps; shiftIndex += 1) {
    const shift = -maxShift + shiftIndex * step;
    const refValues = [];
    const targetValues = [];
    for (const xValue of grid) {
      const a = interpolateLinear(reference.sourceX, reference.normalizedY, xValue);
      const b = interpolateLinear(target.sourceX, target.normalizedY, xValue - shift);
      if (a !== null && b !== null) {
        refValues.push(a);
        targetValues.push(b);
      }
    }
    if (refValues.length < 30) continue;
    const score = correlation(refValues, targetValues);
    if (score > bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }
  return {
    shift: Math.round(bestShift / step) * step,
    score: Number.isFinite(bestScore) ? bestScore : null,
  };
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
  const rows = [[
    "pattern", "x", "x_display", "raw_intensity", "smoothed_intensity",
    "baseline", "corrected_intensity", "processed_intensity", "display_intensity",
    "raw_standard_deviation", "replicate_count", "source_files",
  ]];
  for (const pattern of processed) {
    for (let i = 0; i < (pattern.sourceX?.length || 0); i += 1) {
      rows.push([
        pattern.label,
        pattern.sourceX[i],
        pattern.displayX[i],
        pattern.sourceRawY[i],
        pattern.smoothedY[i],
        pattern.baselineY[i],
        pattern.correctedY[i],
        pattern.processedY[i],
        pattern.displayY[i],
        pattern.sourceStdY?.[i] ?? "",
        pattern.replicateCount ?? 1,
        (pattern.sourceFiles || [pattern.fileName || pattern.label]).join(" | "),
      ]);
    }
  }
  return rows.map((row) => row.map(escapeCsv).join(";")).join("\n");
}

export function detectedPeaksToCsv(processed) {
  const rows = [["pattern", "x", "display_x", "intensity", "height_pct", "prominence", "prominence_pct"]];
  for (const pattern of processed) {
    for (const peak of pattern.detectedPeaks || []) {
      rows.push([
        pattern.label,
        peak.x,
        peak.displayX,
        peak.y,
        peak.heightPct,
        peak.prominence,
        peak.prominencePct,
      ]);
    }
  }
  return rows.map((row) => row.map(escapeCsv).join(";")).join("\n");
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function buildPdfFromJpeg(jpegBytes, pixelWidth, pixelHeight, dpi = 300) {
  const encoder = new TextEncoder();
  const pageWidth = (pixelWidth / dpi) * 72;
  const pageHeight = (pixelHeight / dpi) * 72;
  const content = `q\n${pageWidth.toFixed(4)} 0 0 ${pageHeight.toFixed(4)} 0 0 cm\n/Im0 Do\nQ\n`;
  const objects = [
    null,
    encoder.encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encoder.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(4)} ${pageHeight.toFixed(4)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`),
    encoder.encode(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`),
    null,
  ];

  const parts = [encoder.encode("%PDF-1.4\n")];
  const offsets = [0];
  let currentOffset = parts[0].length;
  for (let index = 1; index <= 5; index += 1) {
    offsets[index] = currentOffset;
    const header = encoder.encode(`${index} 0 obj\n`);
    const footer = encoder.encode("\nendobj\n");
    let body;
    if (index === 5) {
      const imageHeader = encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
      const imageFooter = encoder.encode("\nendstream");
      body = concatBytes([imageHeader, jpegBytes, imageFooter]);
    } else body = objects[index];
    parts.push(header, body, footer);
    currentOffset += header.length + body.length + footer.length;
  }
  const xrefOffset = currentOffset;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let index = 1; index <= 5; index += 1) xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(encoder.encode(xref));
  return concatBytes(parts);
}

function writeTiffEntry(view, offset, tag, type, count, valueOrOffset) {
  view.setUint16(offset, tag, true);
  view.setUint16(offset + 2, type, true);
  view.setUint32(offset + 4, count, true);
  if (type === 3 && count === 1) {
    view.setUint16(offset + 8, valueOrOffset, true);
    view.setUint16(offset + 10, 0, true);
  } else view.setUint32(offset + 8, valueOrOffset, true);
}

export function encodeTiffRgba(imageData, width, height, dpi = 300) {
  const entryCount = 14;
  const ifdOffset = 8;
  const ifdSize = 2 + entryCount * 12 + 4;
  const bitsOffset = ifdOffset + ifdSize;
  const xResolutionOffset = bitsOffset + 8;
  const yResolutionOffset = xResolutionOffset + 8;
  const pixelOffset = yResolutionOffset + 8;
  const pixelByteCount = width * height * 4;
  const buffer = new ArrayBuffer(pixelOffset + pixelByteCount);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entryCount, true);

  let entryOffset = ifdOffset + 2;
  const add = (tag, type, count, value) => {
    writeTiffEntry(view, entryOffset, tag, type, count, value);
    entryOffset += 12;
  };
  add(256, 4, 1, width);
  add(257, 4, 1, height);
  add(258, 3, 4, bitsOffset);
  add(259, 3, 1, 1);
  add(262, 3, 1, 2);
  add(273, 4, 1, pixelOffset);
  add(277, 3, 1, 4);
  add(278, 4, 1, height);
  add(279, 4, 1, pixelByteCount);
  add(282, 5, 1, xResolutionOffset);
  add(283, 5, 1, yResolutionOffset);
  add(284, 3, 1, 1);
  add(296, 3, 1, 2);
  add(338, 3, 1, 2);
  view.setUint32(ifdOffset + 2 + entryCount * 12, 0, true);

  for (let i = 0; i < 4; i += 1) view.setUint16(bitsOffset + i * 2, 8, true);
  view.setUint32(xResolutionOffset, Math.round(dpi), true);
  view.setUint32(xResolutionOffset + 4, 1, true);
  view.setUint32(yResolutionOffset, Math.round(dpi), true);
  view.setUint32(yResolutionOffset + 4, 1, true);
  bytes.set(imageData.data, pixelOffset);
  return new Uint8Array(buffer);
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

const PROJECT_INDEX_KEY = "project-index-v10";
const projectStorageKey = (id) => `project-v10:${id}`;

function summarizeProject(project) {
  const countWorkspace = (mode) => {
    const workspace = project?.workspaces?.[mode] || {};
    return ["patterns", "phases", "notes", "zones"].reduce((sum, key) => sum + (Array.isArray(workspace[key]) ? workspace[key].length : 0), 0);
  };
  return {
    id: String(project.id),
    name: String(project.name || "Projet sans titre"),
    description: String(project.description || ""),
    createdAt: Number(project.createdAt) || Date.now(),
    updatedAt: Number(project.updatedAt) || Date.now(),
    activeMode: project.activeMode === "raman" ? "raman" : "drx",
    drxCount: countWorkspace("drx"),
    ramanCount: countWorkspace("raman"),
  };
}

async function readStoreValue(database, key) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function listStoredProjects() {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  const index = await readStoreValue(database, PROJECT_INDEX_KEY);
  database.close();
  return Array.isArray(index) ? index.slice().sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)) : [];
}

export async function loadStoredProject(id) {
  if (!id || typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  const project = await readStoreValue(database, projectStorageKey(id));
  database.close();
  return project ? validateProject(project) : null;
}

export async function saveStoredProject(input) {
  if (typeof indexedDB === "undefined") return input;
  const validated = validateProject(input);
  const now = Date.now();
  const project = {
    ...validated,
    version: 10,
    id: String(validated.id || newId("project")),
    name: String(validated.name || "Projet sans titre"),
    createdAt: Number(validated.createdAt) || now,
    updatedAt: now,
  };
  const database = await openDatabase();
  const currentIndex = await readStoreValue(database, PROJECT_INDEX_KEY);
  const index = Array.isArray(currentIndex) ? currentIndex.filter((entry) => entry.id !== project.id) : [];
  index.unshift(summarizeProject(project));
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(project, projectStorageKey(project.id));
    store.put(index.slice(0, 30), PROJECT_INDEX_KEY);
    store.put(project, AUTOSAVE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  return project;
}

export async function deleteStoredProject(id) {
  if (!id || typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  const currentIndex = await readStoreValue(database, PROJECT_INDEX_KEY);
  const index = Array.isArray(currentIndex) ? currentIndex.filter((entry) => entry.id !== id) : [];
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.delete(projectStorageKey(id));
    store.put(index, PROJECT_INDEX_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  return index;
}

export function duplicateProject(input, name) {
  const source = validateProject(input);
  const now = Date.now();
  return {
    ...source,
    version: 10,
    id: newId("project"),
    name: String(name || `${source.name || "Projet"} — copie`),
    createdAt: now,
    updatedAt: now,
    workspaces: structuredCloneSafe(source.workspaces),
  };
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function createWorkspace(mode = "drx", input = {}) {
  const resolvedMode = mode === "raman" ? "raman" : "drx";
  const defaults = DEFAULTS[resolvedMode];
  const seededSettings = input?.settings && typeof input.settings === "object" ? input.settings : {};
  const settings = {
    ...INITIAL_SETTINGS,
    xmin: defaults.xmin,
    xmax: defaults.xmax,
    xlabel: defaults.xlabel,
    fileName: `figure_${resolvedMode}`,
    ...seededSettings,
    mode: resolvedMode,
  };
  return {
    settings,
    patterns: Array.isArray(input?.patterns) ? input.patterns : [],
    phases: Array.isArray(input?.phases) ? input.phases : [],
    notes: Array.isArray(input?.notes) ? input.notes : [],
    zones: resolvedMode === "raman" && Array.isArray(input?.zones) ? input.zones : [],
  };
}

export function createEmptyProject(activeMode = "drx", options = {}) {
  const resolvedMode = activeMode === "raman" ? "raman" : "drx";
  const now = Date.now();
  return {
    version: 10,
    id: options.id || newId("project"),
    name: String(options.name || "Projet sans titre"),
    description: String(options.description || ""),
    createdAt: Number(options.createdAt) || now,
    updatedAt: Number(options.updatedAt) || now,
    activeMode: resolvedMode,
    workspaces: {
      drx: createWorkspace("drx", options.workspaces?.drx),
      raman: createWorkspace("raman", options.workspaces?.raman),
    },
  };
}

function validateWorkspace(input, mode) {
  const workspace = createWorkspace(mode, input || {});
  const { settings, patterns, phases, notes, zones } = workspace;
  if (!Number.isFinite(settings.xmin) || !Number.isFinite(settings.xmax) || settings.xmax <= settings.xmin) {
    throw new Error(`Les limites X de l’espace ${mode.toUpperCase()} sont invalides.`);
  }
  for (const pattern of patterns) {
    if (!Array.isArray(pattern.x) || !Array.isArray(pattern.y) || pattern.x.length !== pattern.y.length) {
      throw new Error(`Patron invalide : ${pattern.label || pattern.fileName || "sans nom"}.`);
    }
    if (pattern.stdY !== undefined && (!Array.isArray(pattern.stdY) || pattern.stdY.length !== pattern.x.length)) {
      throw new Error(`Écart-type invalide : ${pattern.label || pattern.fileName || "sans nom"}.`);
    }
  }
  for (const phase of phases) {
    if (!Array.isArray(phase.peaks)) throw new Error(`Phase invalide : ${phase.name || "sans nom"}.`);
  }
  for (const zone of zones) {
    if (!Number.isFinite(Number(zone.xmin)) || !Number.isFinite(Number(zone.xmax))) {
      throw new Error(`Zone invalide : ${zone.name || "sans nom"}.`);
    }
  }
  return { settings, patterns, phases, notes, zones };
}

export function validateProject(input) {
  if (!input || typeof input !== "object") throw new Error("Le fichier ne contient pas un objet JSON.");

  if (input.workspaces && typeof input.workspaces === "object") {
    const activeMode = input.activeMode === "raman" ? "raman" : "drx";
    const now = Date.now();
    return {
      version: 10,
      id: String(input.id || newId("project")),
      name: String(input.name || "Projet importé"),
      description: String(input.description || ""),
      createdAt: Number(input.createdAt) || now,
      updatedAt: Number(input.updatedAt) || now,
      activeMode,
      workspaces: {
        drx: validateWorkspace(input.workspaces.drx, "drx"),
        raman: validateWorkspace(input.workspaces.raman, "raman"),
      },
    };
  }

  // Migration des sessions v3–v6. Les éléments dont le type est explicite
  // sont répartis automatiquement ; les éléments ambigus restent dans
  // l’espace qui était actif au moment de l’enregistrement.
  const legacyMode = input.settings?.mode === "raman" ? "raman" : "drx";
  const legacyPatterns = Array.isArray(input.patterns) ? input.patterns : [];
  const legacyPhases = Array.isArray(input.phases) ? input.phases : [];
  const legacyNotes = Array.isArray(input.notes) ? input.notes : [];
  const legacyZones = Array.isArray(input.zones) ? input.zones : [];

  const inferPatternMode = (pattern) => {
    if (pattern?.isAverage || /raman/i.test(`${pattern?.label || ""} ${pattern?.fileName || ""}`)) return "raman";
    if (/drx|xrd|diffract/i.test(`${pattern?.label || ""} ${pattern?.fileName || ""}`)) return "drx";
    const xs = Array.isArray(pattern?.x) ? pattern.x.filter(Number.isFinite) : [];
    if (xs.length) {
      let maximum = -Infinity;
      for (const value of xs) if (value > maximum) maximum = value;
      if (maximum > 150) return "raman";
      if (maximum <= 150) return "drx";
    }
    return legacyMode;
  };

  const inferPhaseMode = (phase) => {
    if (phase?.sourceKind === "raman-spectrum" || /raman/i.test(phase?.metadata?.FILETYPE || "")) return "raman";
    if ((phase?.files || []).some((name) => /\.dif$/i.test(name))) return "drx";
    return legacyMode;
  };

  const splitPatterns = { drx: [], raman: [] };
  const splitPhases = { drx: [], raman: [] };
  legacyPatterns.forEach((pattern) => splitPatterns[inferPatternMode(pattern)].push(pattern));
  legacyPhases.forEach((phase) => splitPhases[inferPhaseMode(phase)].push(phase));

  const migrated = createEmptyProject(legacyMode);
  migrated.workspaces.drx = validateWorkspace({
    settings: legacyMode === "drx" ? input.settings : undefined,
    patterns: splitPatterns.drx,
    phases: splitPhases.drx,
    notes: legacyMode === "drx" ? legacyNotes : [],
    zones: [],
  }, "drx");
  migrated.workspaces.raman = validateWorkspace({
    settings: legacyMode === "raman" ? input.settings : undefined,
    patterns: splitPatterns.raman,
    phases: splitPhases.raman,
    notes: legacyMode === "raman" ? legacyNotes : [],
    zones: legacyZones,
  }, "raman");
  return migrated;
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
