import { createEmptyProject } from "./lib.js";

const SERIES = [
  { label: "0 h", value: 0, color: "#1d4ed8" },
  { label: "6 h", value: 6, color: "#0f766e" },
  { label: "24 h", value: 24, color: "#15803d" },
  { label: "3 j", value: 72, color: "#a16207" },
  { label: "7 j", value: 168, color: "#c2410c" },
  { label: "28 j", value: 672, color: "#b91c1c" },
];

const PHASES = {
  clinker: [[29.3, 72], [32.1, 100], [32.6, 84], [34.3, 52], [41.2, 34], [51.7, 28]],
  ettringite: [[9.1, 100], [15.8, 46], [18.9, 34], [22.9, 26], [31.1, 30]],
  portlandite: [[18.0, 72], [34.1, 100], [47.1, 38], [50.8, 32], [54.3, 24]],
  calcite: [[23.0, 18], [29.4, 100], [36.0, 14], [39.4, 18], [43.2, 16], [47.5, 17], [48.5, 18]],
};

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function peakProfile(x, center, height, fwhm, eta = 0.35) {
  const z = (2 * (x - center)) / fwhm;
  const gaussian = Math.exp(-Math.log(2) * z * z);
  const lorentzian = 1 / (1 + z * z);
  return height * ((1 - eta) * gaussian + eta * lorentzian);
}

function spectrum({ xmin, xmax, points, bands, baseline, noise = 0, seed = 1 }) {
  const random = seededRandom(seed);
  const x = new Array(points);
  const y = new Array(points);
  const step = (xmax - xmin) / (points - 1);
  for (let index = 0; index < points; index += 1) {
    const valueX = xmin + index * step;
    let valueY = baseline(valueX);
    for (const [center, height, fwhm, eta] of bands) {
      valueY += peakProfile(valueX, center, height, fwhm, eta);
    }
    valueY += (random() - 0.5) * 2 * noise;
    x[index] = Number(valueX.toFixed(4));
    y[index] = Number(Math.max(0, valueY).toFixed(5));
  }
  return { x, y };
}

function phaseBands(peaks, scale, fwhm, eta = 0.42) {
  return peaks.map(([center, intensity]) => [center, intensity * scale, fwhm, eta]);
}

function pattern(id, entry, data, mode) {
  return {
    id: `${mode}-pattern-${id}`,
    label: entry.label,
    fileName: `synthetic_${mode}_${entry.label.replaceAll(" ", "_")}`,
    ...data,
    visible: true,
    color: entry.color,
    yscale: 1,
    xoffset: 0,
    locked: false,
    userNotes: "Données synthétiques générées pour la démonstration.",
    orderValue: String(entry.value),
    groupType: "time",
    groupName: "Temps d’hydratation",
    groupValue: entry.label,
    importedAt: 0,
    ...(mode === "ir" ? { irQuantity: "absorbance" } : {}),
  };
}

function phase(id, name, abbrev, color, peaks, { annotation = false, panel = true } = {}) {
  return {
    id,
    name,
    abbrev,
    color,
    peaks,
    visible: true,
    inAnnot: annotation,
    inPanel: panel,
    files: ["Référence synthétique indicative"],
    sourceKind: "manual",
    labelOffsetX: 0,
    labelOffsetY: 0,
  };
}

function makeXrdPatterns() {
  const evolution = [
    { clinker: 1.00, ettringite: 0.05, portlandite: 0.02, calcite: 0.06, amorphous: 0.34 },
    { clinker: 0.82, ettringite: 0.42, portlandite: 0.18, calcite: 0.07, amorphous: 0.43 },
    { clinker: 0.63, ettringite: 0.62, portlandite: 0.48, calcite: 0.09, amorphous: 0.54 },
    { clinker: 0.46, ettringite: 0.52, portlandite: 0.72, calcite: 0.13, amorphous: 0.62 },
    { clinker: 0.34, ettringite: 0.42, portlandite: 0.84, calcite: 0.18, amorphous: 0.67 },
    { clinker: 0.22, ettringite: 0.30, portlandite: 0.90, calcite: 0.30, amorphous: 0.72 },
  ];
  return SERIES.map((entry, index) => {
    const state = evolution[index];
    const bands = [
      ...phaseBands(PHASES.clinker, state.clinker * 8.2, 0.22),
      ...phaseBands(PHASES.ettringite, state.ettringite * 5.8, 0.20),
      ...phaseBands(PHASES.portlandite, state.portlandite * 6.8, 0.18),
      ...phaseBands(PHASES.calcite, state.calcite * 6.2, 0.19),
      [29.5, state.amorphous * 95, 11.5, 0.08],
    ];
    return pattern(index + 1, entry, spectrum({
      xmin: 8,
      xmax: 58,
      points: 1251,
      bands,
      baseline: (x) => 38 + 20 * Math.exp(-(x - 8) / 22),
      noise: 4.5,
      seed: 100 + index,
    }), "drx");
  });
}

function makeRamanPatterns() {
  const evolution = [0.08, 0.18, 0.38, 0.58, 0.76, 0.92];
  return SERIES.map((entry, index) => {
    const hydration = evolution[index];
    const bands = [
      [460, 62 * (1 - 0.35 * hydration), 25, 0.28],
      [520, 95 * (1 - 0.55 * hydration), 18, 0.30],
      [670, 75 * (1 - 0.45 * hydration), 28, 0.32],
      [850, 30 + 45 * hydration, 32, 0.28],
      [965, 42 + 66 * hydration, 24, 0.32],
      [990, 20 + 58 * Math.exp(-Math.pow(hydration - 0.35, 2) / 0.08), 18, 0.34],
      [1085, 12 + 62 * hydration, 20, 0.34],
    ];
    return pattern(index + 1, entry, spectrum({
      xmin: 100,
      xmax: 1250,
      points: 1151,
      bands,
      baseline: (x) => 34 + 0.025 * (x - 100) + 22 * Math.exp(-Math.pow((x - 760) / 430, 2)),
      noise: 2.4,
      seed: 200 + index,
    }), "raman");
  });
}

function makeIrPatterns() {
  const evolution = [0.05, 0.16, 0.36, 0.58, 0.76, 0.94];
  return SERIES.map((entry, index) => {
    const hydration = evolution[index];
    const bands = [
      [460, 0.11 + 0.12 * hydration, 55, 0.22],
      [970, 0.30 + 0.48 * hydration, 115, 0.25],
      [1110, 0.08 + 0.22 * Math.exp(-Math.pow(hydration - 0.35, 2) / 0.09), 75, 0.24],
      [1420, 0.05 + 0.22 * hydration, 100, 0.25],
      [1640, 0.08 + 0.30 * hydration, 130, 0.18],
      [3440, 0.12 + 0.46 * hydration, 520, 0.12],
      [3642, 0.03 + 0.16 * hydration, 42, 0.30],
    ];
    return pattern(index + 1, entry, spectrum({
      xmin: 400,
      xmax: 4000,
      points: 1801,
      bands,
      baseline: (x) => 0.035 + 0.000006 * (4000 - x),
      noise: 0.005,
      seed: 300 + index,
    }), "ir");
  });
}

function zone(id, name, xmin, xmax, color) {
  return { id, name, xmin, xmax, color, opacity: 0.07, visible: true };
}

export function makeSampleProject() {
  const project = createEmptyProject("drx", {
    id: "synthetic-hydration-sample",
    name: "Hydratation d’un liant — exemple synthétique",
    description: "Projet généré localement, sans mesures expérimentales ni spectres de référence tiers.",
  });

  project.workspaces.drx = {
    ...project.workspaces.drx,
    settings: {
      ...project.workspaces.drx.settings,
      title: "Suivi d’hydratation — DRX synthétique",
      xmin: 8,
      xmax: 58,
      layoutMode: "stacked",
      vstep: 1.05,
      lineWidth: 1.15,
      showFill: false,
      useCustomColors: true,
      showPatternLabels: true,
      showAnnotations: true,
      showAbbrevKey: false,
      showPdfPanel: true,
      showPdfLegend: true,
      showRowSubtitles: false,
      rightMargin: 135,
      fileName: "sample_hydration_xrd",
    },
    patterns: makeXrdPatterns(),
    phases: [
      phase("xrd-ettringite", "Ettringite — référence indicative", "Ett", "#2563eb", PHASES.ettringite, { annotation: true }),
      phase("xrd-portlandite", "Portlandite — référence indicative", "CH", "#dc2626", PHASES.portlandite, { annotation: true }),
      phase("xrd-calcite", "Calcite — référence indicative", "Cc", "#15803d", PHASES.calcite),
      phase("xrd-clinker", "Silicates anhydres — référence indicative", "Anh", "#a16207", PHASES.clinker),
    ],
  };

  project.workspaces.raman = {
    ...project.workspaces.raman,
    settings: {
      ...project.workspaces.raman.settings,
      title: "Suivi d’hydratation — Raman synthétique",
      xmin: 100,
      xmax: 1250,
      layoutMode: "stacked",
      vstep: 1.05,
      lineWidth: 1.15,
      showFill: false,
      useCustomColors: true,
      showPatternLabels: true,
      showAnnotations: false,
      showPdfPanel: false,
      rightMargin: 120,
      fileName: "sample_hydration_raman",
    },
    patterns: makeRamanPatterns(),
    phases: [
      phase("raman-silicate", "Réseau silicaté — bandes indicatives", "Si–O", "#2563eb", [[460, 60], [520, 100], [670, 72], [850, 45], [965, 82]]),
      phase("raman-sulfate", "Sulfate — bande indicative", "SO₄", "#c2410c", [[990, 100]]),
      phase("raman-carbonate", "Carbonate — bande indicative", "CO₃", "#15803d", [[1085, 100]]),
    ],
    zones: [
      zone("raman-zone-silicate", "Silicates", 820, 980, "#2563eb"),
      zone("raman-zone-sulfate", "Sulfates", 980, 1020, "#c2410c"),
      zone("raman-zone-carbonate", "Carbonates", 1060, 1110, "#15803d"),
    ],
  };

  project.workspaces.ir = {
    ...project.workspaces.ir,
    settings: {
      ...project.workspaces.ir.settings,
      title: "Suivi d’hydratation — IR synthétique",
      layoutMode: "stacked",
      vstep: 0.82,
      lineWidth: 1.15,
      showFill: false,
      useCustomColors: true,
      showPatternLabels: true,
      showAnnotations: false,
      showPdfPanel: false,
      rightMargin: 120,
      fileName: "sample_hydration_ir",
    },
    patterns: makeIrPatterns(),
    phases: [
      phase("ir-water", "Eau liée et hydroxyles — bandes indicatives", "OH", "#2563eb", [[1640, 62], [3440, 100], [3642, 36]]),
      phase("ir-silicate", "Silicates — bandes indicatives", "Si–O", "#c2410c", [[460, 35], [970, 100]]),
      phase("ir-carbonate", "Carbonates — bandes indicatives", "CO₃", "#15803d", [[1420, 100]]),
    ],
    zones: [
      zone("ir-zone-silicate", "Si–O", 850, 1050, "#c2410c"),
      zone("ir-zone-carbonate", "CO₃²⁻", 1350, 1500, "#15803d"),
      zone("ir-zone-water", "H₂O liée", 1580, 1700, "#2563eb"),
      zone("ir-zone-oh", "Étirement O–H", 3000, 3700, "#0f766e"),
    ],
  };

  return project;
}
