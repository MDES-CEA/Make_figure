import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useHistoryState from "./useHistoryState";
import { translate, translateMessage, defaultAxisLabels, STOCK_AXIS_LABELS } from "./i18n.js";
import { exportScaleLimits, serializeSvgForExport, svgDataUrl } from "./exportUtils.js";
import { isPhaseDashed } from "./phaseStyles.js";
import { canUpdatePatternField } from "./patternEditing.js";
import {
  CMAPS,
  PHASE_COLORS,
  averagePatterns,
  buildPdfFromJpeg,
  cardNumber,
  deleteStoredProject,
  duplicateProject,
  cmapGradient,
  computeTicks,
  computeAxisWindowDrag,
  createEmptyProject,
  createWorkspace,
  detectedPeaksToCsv,
  downloadBlob,
  encodeTiffRgba,
  estimateCorrelationShift,
  loadAutosave,
  listStoredProjects,
  loadStoredProject,
  mergeDedupPeaks,
  nearestValue,
  newId,
  parseDIFBinary,
  parseManualPeaks,
  parseReferenceText,
  extractRamanReferencePeaks,
  formatManualPeaks,
  parseXYText,
  patternColor,
  processPatterns,
  processedPatternsToCsv,
  saveStoredProject,
  validateProject,
  calculateCifPattern,
  convertDrxX,
  estimateZeroShiftFromPhase,
  fitDrxPeak,
  invertDrxX,
  drxAxisWindowFromTwoTheta,
  drxAxisWindowToTwoTheta,
  parseCIFText,
  parseTrackingTargets,
  trackDrxSeries,
  trackingRowsToCsv,
  MODES,
  MODES_WITH_ZONES,
  IR_Y_LABELS,
  resolveMode,
  modeLabel,
  isOpusXmlText,
  parseOpusXml,
  pickOpusBlock,
  isOpusBinary,
  parseOpusBinary,
  isXrdmlText,
  parseXrdml,
  computeZoneAreas,
  zoneAreasToCsv,
  fitMultiPeaks,
  multiPeakFitToCsv,
  makeSampleData,
  svgToVectorPdf,
} from "./lib";

const EMPTY_PROJECT = createEmptyProject();

function updateWorkspaceProject(project, mode, updater) {
  const resolvedMode = resolveMode(mode);
  const currentWorkspace = project.workspaces?.[resolvedMode] || createWorkspace(resolvedMode);
  const nextWorkspace = typeof updater === "function" ? updater(currentWorkspace) : { ...currentWorkspace, ...updater };
  return {
    ...project,
    version: 18,
    updatedAt: Date.now(),
    workspaces: {
      ...(project.workspaces || {}),
      [resolvedMode]: nextWorkspace,
    },
  };
}

// Applique un jeu de réglages (gabarit de revue, style enregistré) à tous les
// espaces de travail, quel que soit leur nombre.
function applySettingsToAllWorkspaces(workspaces, settings) {
  const next = { ...(workspaces || {}) };
  for (const mode of MODES) {
    const workspace = next[mode] || createWorkspace(mode);
    next[mode] = { ...workspace, settings: { ...workspace.settings, ...settings } };
  }
  return next;
}

function defaultPhaseSubtitle(phase) {
  const rruff = phase?.metadata?.RRUFFID;
  const wavelength = phase?.metadata?.["RAMAN WAVELENGTH"];
  if (rruff) return `${rruff}${wavelength ? ` · ${wavelength} nm` : ""}`;
  if (phase?.sourceKind === "manual") return "saisie manuelle";
  return (phase?.files || []).map(cardNumber).join(", ");
}

function phaseSubtitle(phase) {
  return String(phase?.subtitle ?? defaultPhaseSubtitle(phase)).trim();
}

function truncateLabel(value, maxLength) {
  const text = String(value || "");
  const limit = Math.max(0, Math.round(Number(maxLength) || 0));
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

const NORMALIZATION_OPTIONS = [
  ["minmax", "Min–max par patron"],
  ["max", "Maximum par patron"],
  ["area", "Aire par patron"],
  ["referencePeak", "Pic de référence"],
  ["none", "Aucune — échelle globale"],
];

const BASELINE_OPTIONS = [
  ["none", "Aucune"],
  ["linear", "Linéaire — extrémités"],
  ["rolling", "Rolling minimum"],
  ["snip", "SNIP"],
  ["rubberband", "Rubber band"],
  ["polynomial", "Polynôme robuste"],
  ["als", "ALS asymétrique"],
];

const LAYOUT_OPTIONS = [
  ["stacked", "Empilement"],
  ["overlay", "Superposition"],
  ["waterfall", "Waterfall"],
  ["difference", "Différence à une référence"],
];

const FIGURE_LAYOUT_OPTIONS = [
  ["single", "Figure unique"],
  ["grid", "Petits multiples"],
  ["sideBySide", "Comparaison côte à côte"],
  ["beforeAfter", "Avant / après traitement"],
  ["differenceRatio", "Différence / rapport"],
];

const RADIATION_PRESETS = {
  CuKa1: { label: "Cu Kα₁", wavelength: 1.5406, ka2Wavelength: 1.54439, ka2Ratio: 0.5 },
  CuKa: { label: "Cu Kα moyen", wavelength: 1.54184, ka2Wavelength: 1.54439, ka2Ratio: 0.5 },
  CoKa1: { label: "Co Kα₁", wavelength: 1.78897, ka2Wavelength: 1.79285, ka2Ratio: 0.5 },
  MoKa1: { label: "Mo Kα₁", wavelength: 0.70932, ka2Wavelength: 0.71361, ka2Ratio: 0.5 },
  CrKa1: { label: "Cr Kα₁", wavelength: 2.2897, ka2Wavelength: 2.29361, ka2Ratio: 0.5 },
  custom: { label: "Personnalisé", wavelength: 1.5406, ka2Wavelength: 1.54439, ka2Ratio: 0.5 },
};

const JOURNAL_PRESETS = {
  nature1: { label: "Nature · 1 colonne (89 mm)", figWidth: 1051, exportDpi: 300, axisFontSize: 12, tickFontSize: 10, titleFontSize: 14, lineWidth: 1 },
  nature2: { label: "Nature · 2 colonnes (183 mm)", figWidth: 2161, exportDpi: 300, axisFontSize: 20, tickFontSize: 16, titleFontSize: 23, lineWidth: 1.6 },
  acs1: { label: "ACS · 1 colonne (85 mm)", figWidth: 1004, exportDpi: 300, axisFontSize: 12, tickFontSize: 10, titleFontSize: 14, lineWidth: 1 },
  elsevier2: { label: "Elsevier · 2 colonnes (190 mm)", figWidth: 2244, exportDpi: 300, axisFontSize: 20, tickFontSize: 16, titleFontSize: 24, lineWidth: 1.6 },
};

const PRESETS = {
  article1: { label: "Article · 1 colonne", figWidth: 1004, axisFontSize: 13, tickFontSize: 11, titleFontSize: 15, lineWidth: 1 },
  article2: { label: "Article · 2 colonnes", figWidth: 2126, axisFontSize: 22, tickFontSize: 18, titleFontSize: 26, lineWidth: 1.8 },
  presentation: { label: "Présentation", figWidth: 1600, axisFontSize: 20, tickFontSize: 16, titleFontSize: 24, lineWidth: 1.6 },
  compact: { label: "Écran compact", figWidth: 900, axisFontSize: 12, tickFontSize: 10, titleFontSize: 14, lineWidth: 0.8 },
};

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeNoteModel(note, xmin = 0, xmax = 1) {
  const fallbackX = (finiteNumber(xmin, 0) + finiteNumber(xmax, 1)) / 2;
  return {
    ...note,
    x: finiteNumber(note?.x, fallbackX),
    yFrac: clamp(finiteNumber(note?.yFrac, 0.72), 0, 1),
    text: String(note?.text ?? "Annotation"),
    color: /^#[0-9a-f]{6}$/i.test(String(note?.color || "")) ? String(note.color) : "#2d333b",
    fontSize: clamp(finiteNumber(note?.fontSize, 10), 5, 60),
    bold: Boolean(note?.bold),
    rotation: clamp(finiteNumber(note?.rotation, 0), -180, 180),
    vline: Boolean(note?.vline),
    // Extension du trait, en fraction de la hauteur tracée (0 = bas du cadre,
    // 1 = haut). Par défaut le trait traverse toute la zone.
    vlineTopFrac: clamp(finiteNumber(note?.vlineTopFrac, 1), 0, 1),
    vlineBottomFrac: clamp(finiteNumber(note?.vlineBottomFrac, 0), 0, 1),
    anchorLine: Boolean(note?.anchorLine),
    // Number(null) vaut 0 : sans test d'existence, une accroche jamais placée
    // partait à x = 0, hors de la fenêtre affichée.
    anchorX: note?.anchorX !== null && note?.anchorX !== undefined && Number.isFinite(Number(note.anchorX)) ? Number(note.anchorX) : null,
    anchorYFrac: clamp(finiteNumber(note?.anchorYFrac, 0.5), 0, 1),
    visible: note?.visible !== false,
  };
}

function extractOrderValue(value) {
  const matches = String(value || "").match(/[-+]?\d+(?:[.,]\d+)?/g);
  if (!matches?.length) return null;
  const parsed = Number(matches.at(-1).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} o`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} ko`;
  return `${(value / 1024 ** 2).toFixed(1)} Mo`;
}

function orderedGroups(patterns, groupBy) {
  if (groupBy === "none") return [{ key: "all", label: "", items: patterns }];
  const buckets = new Map();
  patterns.forEach((pattern) => {
    let value = "Sans groupe";
    if (groupBy === "group") value = pattern.groupName || "Sans groupe";
    else if (groupBy === "sample") value = pattern.groupType === "sample" ? (pattern.groupName || pattern.groupValue || "Sans échantillon") : "Sans échantillon";
    else if (groupBy === "time") value = pattern.groupType === "time" ? (pattern.groupName || pattern.groupValue || "Sans temps") : "Sans temps";
    else if (groupBy === "temperature") value = pattern.groupType === "temperature" ? (pattern.groupName || pattern.groupValue || "Sans température") : "Sans température";
    else if (groupBy === "treatment") value = pattern.groupType === "treatment" ? (pattern.groupName || pattern.groupValue || "Sans traitement") : "Sans traitement";
    if (!buckets.has(value)) buckets.set(value, []);
    buckets.get(value).push(pattern);
  });
  return [...buckets.entries()].map(([key, items]) => ({ key, label: key, items }));
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[\s_\-+()\[\]{}./,;:]+/g, " ")
    .trim();
}

function extractFormulaElements(formula) {
  const text = String(formula ?? "");
  const matches = text.match(/[A-Z][a-z]?/g) || [];
  return [...new Set(matches.map((item) => item.toLocaleUpperCase("fr")))];
}

function scoreRamanDatabaseEntry(entry, query, selectedElements) {
  const normalizedQuery = normalizeSearchText(query);
  const name = normalizeSearchText(entry?.name || "");
  const formula = normalizeSearchText(entry?.formula || "");
  const metadataText = normalizeSearchText(Object.values(entry?.metadata || {}).join(" "));
  const allText = `${name} ${formula} ${metadataText}`.trim();
  const entryElements = new Set(extractFormulaElements(entry?.formula || "").map((item) => item.toLocaleLowerCase("fr")));
  const queryTokens = normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : [];
  const elementTokens = queryTokens.filter((token) => /^[a-z]{1,2}$/.test(token));
  const textTokens = queryTokens.filter((token) => !elementTokens.includes(token));
  const matchedElements = selectedElements.filter((element) => entryElements.has(element.toLocaleLowerCase("fr")));
  let score = 0;

  if (!normalizedQuery && !selectedElements.length) return { score: 0, matchedElements: [] };
  if (normalizedQuery) {
    if (name === normalizedQuery) score += 120;
    if (name.startsWith(normalizedQuery)) score += 70;
    if (name.includes(normalizedQuery)) score += 45;
    if (formula.includes(normalizedQuery)) score += 25;
    if (allText.includes(normalizedQuery)) score += 10;
    if (textTokens.length) {
      score += textTokens.reduce((sum, token) => sum + (allText.includes(token) ? 6 : 0), 0);
    }
  }
  if (selectedElements.length) {
    if (matchedElements.length === selectedElements.length) score += 50 + matchedElements.length * 10;
    else score -= 1000;
  }
  if (elementTokens.length) {
    const elementMatches = elementTokens.filter((token) => entryElements.has(token));
    score += elementMatches.length * 20;
  }
  return { score, matchedElements };
}

function readLocalSetting(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch { return fallback; }
}

function writeLocalSetting(key, value) {
  try { window.localStorage.setItem(key, String(value)); } catch { /* stockage indisponible */ }
}

function Icon({ name, size = 16 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  const paths = {
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/></>,
    download: <><path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></>,
    save: <><path d="M5 3h12l2 2v16H5z"/><path d="M8 3v7h8V3"/><path d="M8 21v-7h8v7"/></>,
    folder: <><path d="M3 6h7l2 2h9v11H3z"/></>,
    undo: <><path d="m9 7-5 5 5 5"/><path d="M4 12h9a6 6 0 0 1 6 6"/></>,
    redo: <><path d="m15 7 5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0-6 6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></>,
    preview: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16.5" cy="8.5" r="1.5"/></>,
    eyeOff: <><path d="m3 3 18 18"/><path d="M10.5 6.1A11.8 11.8 0 0 1 12 6c6.5 0 10 6 10 6a15.2 15.2 0 0 1-2.2 2.8"/><path d="M6.6 6.6C3.6 8.4 2 12 2 12s3.5 6 10 6c1.8 0 3.3-.4 4.6-1"/></>,
    chevronDown: <path d="m7 10 5 5 5-5"/>,
    chevronRight: <path d="m10 7 5 5-5 5"/>,
    grip: <><circle cx="9" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/></>,
    zoomIn: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M10.5 7.5v7M7.5 10.5h6"/></>,
    zoomOut: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M7.5 10.5h6"/></>,
    fit: <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></>,
    hand: <><path d="M7 11V7a1.5 1.5 0 0 1 3 0v3-5a1.5 1.5 0 0 1 3 0v5-4a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v5c0 4-2.5 7-7 7h-1c-2 0-3.5-.8-4.8-2.3L3.5 15a1.7 1.7 0 0 1 2.5-2.3z"/></>,
    cursor: <><path d="m5 3 12 10-6 1 3 6-2 1-3-6-4 4z"/></>,
    close: <><path d="M6 6l12 12M18 6 6 18"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
    note: <><path d="M5 4h14v12l-5 5H5z"/><path d="M14 21v-5h5"/></>,
    csv: <><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 12h8M8 16h8"/></>,
    reset: <><path d="M4 4v7h6"/><path d="M5.5 15a7 7 0 1 0 .6-7.7L4 10"/></>,
    sparkles: <><path d="m12 3 1.2 3.1L16 7.5l-2.8 1.4L12 12l-1.2-3.1L8 7.5l2.8-1.4z"/><path d="m18.5 13 .8 2 1.7.8-1.7.9-.8 2-.8-2-1.7-.9 1.7-.8z"/><path d="m5.5 14 .7 1.8 1.6.7-1.6.8-.7 1.8-.7-1.8-1.6-.8 1.6-.7z"/></>,
    motion: <><path d="M3 8h7M3 12h11M3 16h7"/><path d="m15 7 5 5-5 5"/></>,
    motionOff: <><path d="M3 8h4M3 12h7M3 16h4"/><path d="m13 7 5 5-5 5"/><path d="M4 4l16 16"/></>,
    waveform: <><path d="M3 13h3l2-7 3 13 3-10 2 7h5"/></>,
    xray: <><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4v16M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6"/></>,
    infrared: <><path d="M5 19V5"/><path d="M9 8.5a5.5 5.5 0 0 1 0 7"/><path d="M13 5.5a10.5 10.5 0 0 1 0 13"/><path d="M17 2.5a15.5 15.5 0 0 1 0 19"/></>,
    phase: <><path d="M4 19V5M4 19h16"/><path d="M7 18v-4M11 18V8M15 18v-7M19 18V5"/></>,
    zone: <><rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></>,
    average: <><path d="M4 8h16M4 16h16"/><path d="m7 5-3 3 3 3M17 13l3 3-3 3"/></>,
    duplicate: <><rect x="8" y="8" width="11" height="11"/><path d="M16 8V5H5v11h3"/></>,
    selectAll: <><rect x="7" y="7" width="10" height="10"/><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></>,
    panelLeft: <><rect x="3" y="4" width="18" height="16"/><path d="M9 4v16"/></>,
    panelRight: <><rect x="3" y="4" width="18" height="16"/><path d="M15 4v16"/></>,
    layout: <><rect x="3" y="4" width="18" height="16"/><path d="M8 4v16M16 4v16"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    unlock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M9 10V7a4 4 0 0 1 7.5-2"/></>,
    sort: <><path d="M8 6h10M8 12h7M8 18h4"/><path d="m3 7 2-2 2 2M5 5v14M3 17l2 2 2-2"/></>,
    ruler: <><path d="M4 17 17 4l3 3L7 20z"/><path d="m11 10 3 3M8 13l2 2M14 7l2 2"/></>,
    magnet: <><path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h4M14 8h4"/></>,
    fullscreen: <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></>,
    fullscreenExit: <><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></>,
    compare: <><rect x="3" y="5" width="8" height="14"/><rect x="13" y="5" width="8" height="14"/><path d="M7 9v6M17 8v8"/></>,
    zoomRect: <><rect x="4" y="4" width="11" height="11" strokeDasharray="2 2"/><circle cx="15.5" cy="15.5" r="4.5"/><path d="m19 19 2 2"/></>,
    group: <><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20a5 5 0 0 1 10 0M11 20a5 5 0 0 1 10 0"/></>,
    tag: <><path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8" cy="8" r="1.5"/></>,
  };
  return <svg {...common}>{paths[name] || paths.more}</svg>;
}

function Logo() {
  return (
    <div className="app-logo" aria-hidden="true">
      <span className="app-logo__halo" />
      <svg width="36" height="32" viewBox="0 0 36 32">
        <defs>
          <linearGradient id="logoGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7b6cff" />
            <stop offset="0.52" stopColor="#d85ca4" />
            <stop offset="1" stopColor="#f0a366" />
          </linearGradient>
        </defs>
        <circle className="app-logo__orbit" cx="18" cy="16" r="13" fill="none" stroke="url(#logoGradient)" strokeWidth=".8" strokeDasharray="3 5" />
        {[0, 1, 2].map((index) => (
          <path
            className={`app-logo__trace app-logo__trace--${index + 1}`}
            key={index}
            d={`M3 ${25 - index * 7} L10 ${25 - index * 7} L13 ${12 - index * 7 + 4} L16 ${25 - index * 7} L23 ${25 - index * 7} L26 ${18 - index * 7 + 2} L29 ${25 - index * 7} L33 ${25 - index * 7}`}
            fill="none"
            stroke="url(#logoGradient)"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        ))}
        <circle className="app-logo__spark" cx="30" cy="6" r="1.7" fill="#f6b77f" />
      </svg>
    </div>
  );
}

const WORKSPACE_ASSET_COLORS = {
  drx: ["#e39a62", "#7d6dff"],
  raman: ["#7c6cff", "#d55aa3"],
  ir: ["#3fb8a6", "#4a8fd6"],
};

function WorkspaceIllustration({ mode = "drx", compact = false }) {
  const resolvedMode = resolveMode(mode);
  const [colorFrom, colorTo] = WORKSPACE_ASSET_COLORS[resolvedMode];
  return (
    <svg className={`workspace-asset ${compact ? "is-compact" : ""}`} viewBox="0 0 320 170" aria-hidden="true">
      <defs>
        <linearGradient id={`assetGradient-${resolvedMode}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={colorFrom} />
          <stop offset="1" stopColor={colorTo} />
        </linearGradient>
        <radialGradient id={`assetGlow-${resolvedMode}`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={colorFrom} stopOpacity=".32" />
          <stop offset="1" stopColor={colorFrom} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="workspace-asset__glow" cx="160" cy="88" rx="120" ry="65" fill={`url(#assetGlow-${resolvedMode})`} />
      <path className="workspace-asset__grid" d="M35 132H286M35 100H286M35 68H286M76 35V143M126 35V143M176 35V143M226 35V143M276 35V143" />
      <path className="workspace-asset__axis" d="M35 30V143H291" />
      {resolvedMode === "raman" && (
        <>
          <path className="workspace-asset__signal workspace-asset__signal--back" d="M38 126C54 124 61 116 72 119c13 4 20 8 31-10 13-22 24-5 35-7 13-2 15-29 28-29 15 0 15 46 32 42 12-2 15-17 28-17 13 0 17 23 31 19 11-3 13-14 29-12" />
          <path className="workspace-asset__signal" stroke={`url(#assetGradient-${resolvedMode})`} d="M38 131C57 128 62 122 75 124c15 2 20 0 29-15 12-20 23-3 35-6 14-3 14-45 30-45 16 0 14 56 33 51 14-3 15-25 30-23 14 2 16 31 32 22 8-5 13-11 23-8" />
          <circle className="workspace-asset__particle workspace-asset__particle--1" cx="169" cy="58" r="3" />
          <circle className="workspace-asset__particle workspace-asset__particle--2" cx="232" cy="86" r="2.4" />
        </>
      )}
      {resolvedMode === "drx" && (
        <>
          {[58, 84, 112, 144, 169, 213, 251, 276].map((x, index) => (
            <line key={x} className="workspace-asset__stick" x1={x} x2={x} y1="132" y2={132 - [22, 46, 29, 79, 36, 62, 27, 45][index]} stroke={`url(#assetGradient-${resolvedMode})`} />
          ))}
          <path className="workspace-asset__signal" stroke={`url(#assetGradient-${resolvedMode})`} d="M38 130 52 129 58 108 63 129 79 128 84 87 90 129 107 128 112 103 117 129 139 128 144 52 150 129 164 128 169 96 175 129 207 128 213 68 220 129 246 128 251 104 257 129 271 128 276 88 282 130" />
        </>
      )}
      {resolvedMode === "ir" && (
        // Allure d’un spectre en transmittance : ligne de base haute, bandes vers le bas.
        <>
          <path className="workspace-asset__signal workspace-asset__signal--back" d="M38 52c22 1 30 3 44 5 12 2 16 34 27 34 12 0 14-30 25-29 15 1 12 12 24 13 14 1 18 46 31 46 12 0 13-44 26-45 15-1 16 22 30 23 13 1 19 12 36 11" />
          <path className="workspace-asset__signal" stroke={`url(#assetGradient-${resolvedMode})`} d="M38 48c22 1 31 2 45 4 12 2 15 41 27 41 13 0 14-35 26-34 15 1 12 14 25 15 14 1 17 54 31 54 13 0 13-51 27-52 15-1 16 26 30 27 13 1 20 13 37 12" />
          <circle className="workspace-asset__particle workspace-asset__particle--1" cx="161" cy="112" r="3" />
          <circle className="workspace-asset__particle workspace-asset__particle--2" cx="219" cy="110" r="2.4" />
        </>
      )}
      <g className="workspace-asset__labels">
        {/* En IR le haut du cadre est occupé par la ligne de base : badge en bas à gauche. */}
        <rect x="43" y={resolvedMode === "ir" ? 112 : 40} width="62" height="18" rx="9" />
        <text x="74" y={resolvedMode === "ir" ? 124 : 52} textAnchor="middle">{modeLabel(resolvedMode).toUpperCase()}</text>
        <rect x="218" y="141" width="65" height="14" rx="7" />
      </g>
    </svg>
  );
}

function MiniAsset({ kind = "pattern" }) {
  const icon = kind === "phase" ? "phase" : kind === "zone" ? "zone" : kind === "note" ? "note" : kind === "selection" ? "cursor" : "waveform";
  return <span className={`mini-asset mini-asset--${kind}`}><Icon name={icon} size={20} /><i /><b /></span>;
}

function Button({ children, icon, variant = "ghost", active = false, disabled = false, title, onClick, className = "" }) {
  return (
    <button
      type="button"
      className={`button button--${variant} ${active ? "is-active" : ""} ${className}`}
      title={tr(title)}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      {children && <span>{typeof children === "string" ? tr(children) : children}</span>}
    </button>
  );
}

function IconButton({ icon, title, active = false, disabled = false, danger = false, onClick }) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "is-active" : ""} ${danger ? "is-danger" : ""}`}
      title={tr(title)}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

// Langue de l'interface. Les composants partagés étant recréés à chaque rendu
// de App, la variable est positionnée en tête de rendu et lue par tr().
let UI_LANGUAGE = "fr";
const tr = (text) => translate(text, UI_LANGUAGE);
// Locale de formatage des nombres et des dates, alignée sur la langue.
const uiLocale = () => (UI_LANGUAGE === "en" ? "en-GB" : "fr-FR");

function Section({ title, children, defaultOpen = true, badge, targetId }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`property-section ${open ? "is-open" : ""}`} data-context-target={targetId || undefined}>
      <button type="button" className="property-section__header" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="property-section__chevron"><Icon name="chevronRight" size={14} /></span>
        <span>{tr(title)}</span>
        {badge !== undefined && <span className="property-section__badge">{badge}</span>}
      </button>
      <div className="property-section__collapsible" aria-hidden={!open}>
        <div><div className="property-section__body">{children}</div></div>
      </div>
    </section>
  );
}

function Field({ label, children, hint, targetId }) {
  return (
    <label className="field" data-context-target={targetId || undefined}>
      <span className="field__label">{tr(label)}</span>
      {children}
      {hint && <span className="field__hint">{tr(hint)}</span>}
    </label>
  );
}

function formatNumericDraft(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

function parseNumericDraft(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function NumericInput({ value, onCommit, min, max, step = 1, className = "", ariaLabel }) {
  const [draft, setDraft] = useState(() => formatNumericDraft(value));
  const [editing, setEditing] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(formatNumericDraft(value));
  }, [editing, value]);

  const commitDraft = useCallback(() => {
    const parsed = parseNumericDraft(draft);
    if (parsed === null) {
      setDraft(formatNumericDraft(value));
      setEditing(false);
      return;
    }
    const next = clamp(parsed, min ?? -Infinity, max ?? Infinity);
    const accepted = onCommit?.(next);
    setDraft(accepted === false ? formatNumericDraft(value) : formatNumericDraft(next));
    setEditing(false);
  }, [draft, max, min, onCommit, value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`numeric-input ${className}`.trim()}
      aria-label={ariaLabel}
      value={draft}
      onFocus={() => { cancelRef.current = false; setEditing(true); }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelRef.current) {
          cancelRef.current = false;
          setDraft(formatNumericDraft(value));
          setEditing(false);
          return;
        }
        commitDraft();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelRef.current = true;
          setDraft(formatNumericDraft(value));
          event.currentTarget.blur();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const parsedDraft = parseNumericDraft(draft);
          const externalValue = Number(value);
          const base = parsedDraft ?? (Number.isFinite(externalValue) ? externalValue : 0);
          const delta = (Number(step) || 1) * (event.key === "ArrowUp" ? 1 : -1);
          setDraft(formatNumericDraft(clamp(base + delta, min ?? -Infinity, max ?? Infinity)));
        }
      }}
    />
  );
}

function NumberField({ label, value, onChange, min, max, step = 1, suffix, compact = false, targetId, hint }) {
  return (
    <Field label={label} targetId={targetId} hint={hint}>
      <div className={`input-with-suffix ${compact ? "is-compact" : ""}`}>
        <NumericInput value={value} min={min} max={max} step={step} onCommit={onChange} ariaLabel={tr(label)} />
        {suffix && <span>{suffix}</span>}
      </div>
    </Field>
  );
}

function SliderField({ label, value, onChange, min, max, step = 1, suffix, targetId }) {
  const commitRange = (event) => {
    const number = Number.parseFloat(event.target.value);
    if (Number.isFinite(number)) onChange(number);
  };
  return (
    <Field label={label} targetId={targetId}>
      <div className="slider-field">
        <input type="range" value={value} min={min} max={max} step={step} onChange={commitRange} />
        <div className="input-with-suffix is-compact">
          <NumericInput value={value} min={min} max={max} step={step} onCommit={onChange} ariaLabel={tr(label)} />
          {suffix && <span>{suffix}</span>}
        </div>
      </div>
    </Field>
  );
}

function TextField({ label, value, onChange, placeholder, targetId }) {
  return (
    <Field label={label} targetId={targetId}>
      <input type="text" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function TextAreaField({ label, value, onChange, placeholder, hint, rows = 4, targetId }) {
  return (
    <Field label={label} hint={hint} targetId={targetId}>
      <textarea rows={rows} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function SelectField({ label, value, onChange, options, targetId }) {
  return (
    <Field label={label} targetId={targetId}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option];
          return <option key={optionValue} value={optionValue}>{tr(optionLabel)}</option>;
        })}
      </select>
    </Field>
  );
}

function Toggle({ label, checked, onChange, description }) {
  return (
    <button type="button" className="toggle-row" onClick={() => onChange(!checked)}>
      <span>
        <span className="toggle-row__label">{tr(label)}</span>
        {description && <span className="toggle-row__description">{tr(description)}</span>}
      </span>
      <span className={`switch ${checked ? "is-on" : ""}`}><span /></span>
    </button>
  );
}

function EmptyPanel({ title, body, kind = "pattern" }) {
  return (
    <div className={`empty-panel empty-panel--${kind}`}>
      <MiniAsset kind={kind} />
      <strong>{tr(title)}</strong>
      <p>{tr(body)}</p>
    </div>
  );
}

function PatternItem({
  pattern, index, color, selected, onSelect, onUpdate, onDelete, onDragStart, onDrop,
  averageSelectable = false, averageChecked = false, onAverageToggle,
}) {
  const meta = pattern.isAverage
    ? `${pattern.replicateCount || pattern.sourcePatternIds?.length || 0} ${tr("acquisitions moyennées")} · ${pattern.x.length.toLocaleString(uiLocale())} ${tr("points")}`
    : `${pattern.x.length.toLocaleString(uiLocale())} ${tr("points")} · #${index + 1}`;
  return (
    <article
      className={`data-item ${selected ? "is-selected" : ""} ${!pattern.visible ? "is-hidden" : ""} ${pattern.isAverage ? "is-average" : ""} ${pattern.locked ? "is-locked" : ""}`}
      draggable={!pattern.locked}
      onDragStart={(event) => onDragStart(event, pattern.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, pattern.id)}
      onClick={onSelect}
    >
      <span className="data-item__grip"><Icon name="grip" size={15} /></span>
      <span className="data-item__swatch" style={{ background: color }} />
      <div className="data-item__content">
        <input
          className="data-item__name"
          value={pattern.label}
          disabled={pattern.locked}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate("label", event.target.value)}
        />
        <span className="data-item__meta">{meta}{pattern.orderValue !== undefined && pattern.orderValue !== null ? ` · ${tr("ordre")} ${pattern.orderValue}` : ""}{pattern.groupName ? ` · ${pattern.groupName}` : ""}</span>
        {averageSelectable && (
          <label className={`average-pick ${averageChecked ? "is-checked" : ""}`} onClick={(event) => event.stopPropagation()}>
            <input type="checkbox" checked={averageChecked} onChange={(event) => onAverageToggle?.(event.target.checked)} />
            <span>{tr("Inclure dans la moyenne")}</span>
          </label>
        )}
        <div className="data-item__chips">
          {pattern.isAverage ? <span className="derived-badge"><Icon name="average" size={10} /> patron moyen</span> : <span className="type-badge"><Icon name="waveform" size={10} /> acquisition</span>}
          {pattern.locked && <span className="type-badge type-badge--locked"><Icon name="lock" size={10} /> verrouillé</span>}
          {pattern.processingOverrides?.enabled && <span className="type-badge"><Icon name="sparkles" size={10} /> traitement individuel</span>}
        </div>
      </div>
      <div className="data-item__actions">
        <IconButton icon={pattern.locked ? "lock" : "unlock"} title={pattern.locked ? "Déverrouiller" : "Verrouiller"} active={pattern.locked} onClick={(event) => { event?.stopPropagation?.(); onUpdate("locked", !pattern.locked); }} />
        <IconButton icon={pattern.visible ? "eye" : "eyeOff"} title={pattern.visible ? "Masquer" : "Afficher"} onClick={(event) => { event?.stopPropagation?.(); onUpdate("visible", !pattern.visible); }} />
        <IconButton icon="trash" title={pattern.locked ? "Déverrouiller avant suppression" : "Supprimer"} disabled={pattern.locked} danger onClick={(event) => { event?.stopPropagation?.(); onDelete(); }} />
      </div>
    </article>
  );
}

function PhaseItem({ phase, annotationsVisible, panelVisible, selected, onSelect, onUpdate, onDelete, onAppend, onDragStart, onDrop }) {
  const annotationActive = Boolean(annotationsVisible && phase.inAnnot);
  const panelActive = Boolean(panelVisible && phase.inPanel);
  return (
    <article
      className={`data-item data-item--phase ${selected ? "is-selected" : ""} ${!phase.visible ? "is-hidden" : ""}`}
      draggable
      onDragStart={(event) => onDragStart(event, phase.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, phase.id)}
      onClick={onSelect}
    >
      <span className="data-item__grip"><Icon name="grip" size={15} /></span>
      <input
        type="color"
        value={phase.color}
        className="color-dot"
        title="Couleur de la phase"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onUpdate("color", event.target.value)}
      />
      <div className="data-item__content">
        <input
          className="data-item__name"
          value={phase.name}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate("name", event.target.value)}
        />
        <span className="data-item__meta">{phase.peaks.length} {tr("pics")} · {truncateLabel(phaseSubtitle(phase), 44)}</span>
        <div className="data-item__chips">
          <span className="type-badge"><Icon name="phase" size={10} /> {phase.sourceKind === "manual" ? "manuel" : phase.sourceKind === "raman-spectrum" ? "RRUFF" : "référence"}</span>
          <button type="button" className={annotationActive ? "chip is-on" : "chip"} title={!annotationsVisible && phase.inAnnot ? tr("L’affichage global est désactivé. Cliquer pour le réactiver.") : undefined} onClick={(event) => { event.stopPropagation(); onUpdate("inAnnot", !annotationActive); }}>{tr("annotation")}</button>
          <button type="button" className={panelActive ? "chip is-on" : "chip"} title={!panelVisible && phase.inPanel ? tr("L’affichage global du panneau est désactivé. Cliquer pour le réactiver.") : undefined} onClick={(event) => { event.stopPropagation(); onUpdate("inPanel", !panelActive); }}>{tr("panneau")}</button>
          <button type="button" className={phase.inOverlay ? "chip is-on" : "chip"} title="Superposer les bâtonnets directement sur la figure" onClick={(event) => { event.stopPropagation(); onUpdate("inOverlay", !phase.inOverlay); }}>figure</button>
          <button type="button" className="chip chip--action" onClick={(event) => { event.stopPropagation(); onAppend(); }}>{tr("+ fiche")}</button>
        </div>
      </div>
      <div className="data-item__actions">
        <IconButton icon={phase.visible ? "eye" : "eyeOff"} title={phase.visible ? "Masquer" : "Afficher"} onClick={(event) => { event?.stopPropagation?.(); onUpdate("visible", !phase.visible); }} />
        <IconButton icon="trash" title="Supprimer" danger onClick={(event) => { event?.stopPropagation?.(); onDelete(); }} />
      </div>
    </article>
  );
}

function NoteItem({ note, selected, onSelect, onUpdate, onDelete }) {
  const safe = safeNoteModel(note);
  return (
    <article className={`data-item data-item--note ${selected ? "is-selected" : ""} ${safe.visible === false ? "is-hidden" : ""}`} onClick={onSelect}>
      <span className="data-item__swatch" style={{ background: safe.color }} />
      <div className="data-item__content">
        <input className="data-item__name" value={safe.text} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdate("text", event.target.value)} />
        <span className="data-item__meta">x = {safe.x.toLocaleString(uiLocale(), { maximumFractionDigits: 3 })} · y = {Math.round(safe.yFrac * 100)} %</span>
      </div>
      <div className="data-item__actions"><IconButton icon={safe.visible === false ? "eyeOff" : "eye"} title={safe.visible === false ? "Afficher" : "Masquer"} onClick={(event) => { event?.stopPropagation?.(); onUpdate("visible", safe.visible === false); }} /><IconButton icon="trash" title="Supprimer" danger onClick={(event) => { event?.stopPropagation?.(); onDelete(); }} /></div>
    </article>
  );
}

function PhasePeaksEditor({ phase, onApply }) {
  const [text, setText] = useState(() => formatManualPeaks(phase.peaks));
  useEffect(() => setText(formatManualPeaks(phase.peaks)), [phase.id, phase.peaks]);
  const apply = () => {
    const peaks = parseManualPeaks(text);
    if (peaks.length) onApply(peaks);
  };
  return (
    <div className="peak-editor">
      <TextAreaField
        label="Pics de la phase"
        value={text}
        onChange={setText}
        rows={5}
        placeholder="107:40; 280:100; 713:65"
        hint="Format position:intensité. L’intensité est facultative ; elle vaut alors 100 %."
      />
      <div className="inline-actions"><Button variant="secondary" onClick={apply}>Appliquer la liste</Button></div>
    </div>
  );
}

function ZoneItem({ zone, selected, onSelect, onUpdate, onDelete }) {
  return (
    <article className={`data-item data-item--zone ${selected ? "is-selected" : ""} ${!zone.visible ? "is-hidden" : ""}`} onClick={onSelect}>
      <input type="color" value={zone.color} className="color-dot" title="Couleur de la zone" onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdate("color", event.target.value)} />
      <div className="data-item__content">
        <input className="data-item__name" value={zone.name} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdate("name", event.target.value)} />
        <span className="data-item__meta">{Number(zone.xmin).toLocaleString(uiLocale())}–{Number(zone.xmax).toLocaleString(uiLocale())} cm⁻¹</span>
      </div>
      <div className="data-item__actions">
        <IconButton icon={zone.visible ? "eye" : "eyeOff"} title={zone.visible ? "Masquer" : "Afficher"} onClick={(event) => { event?.stopPropagation?.(); onUpdate("visible", !zone.visible); }} />
        <IconButton icon="trash" title="Supprimer" danger onClick={(event) => { event?.stopPropagation?.(); onDelete(); }} />
      </div>
    </article>
  );
}

function Resizer({ side, onResize, onReset }) {
  const start = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = onResize.currentWidth();
    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      onResize.apply(side === "left" ? startWidth + delta : startWidth - delta);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const keyboardResize = (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const delta = direction * (event.shiftKey ? 40 : 10) * (side === 'left' ? 1 : -1);
    onResize.apply(onResize.currentWidth() + delta);
  };
  return <div className={`panel-resizer panel-resizer--${side}`} role="separator" aria-orientation="vertical" tabIndex="0" onKeyDown={keyboardResize} onDoubleClick={onReset} onPointerDown={start} />;
}

function ProjectSwitcher({ project, entries, open, search, setSearch, onToggle, onSwitch, onCreate, onRename, onDuplicate, onDelete, onExport, menuRef }) {
  const normalized = search.trim().toLocaleLowerCase('fr');
  const filtered = normalized ? entries.filter((entry) => entry.name.toLocaleLowerCase('fr').includes(normalized)) : entries;
  return (
    <div className="project-switcher" ref={menuRef}>
      <button type="button" className={`project-switcher__trigger ${open ? 'is-open' : ''}`} onClick={onToggle} aria-expanded={open}>
        <span className="project-switcher__kicker">{tr("Projet actif")}</span>
        <strong title={project.name}>{project.name || 'Projet sans titre'}</strong>
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div className="project-menu" role="dialog" aria-label={tr("Bibliothèque de projets")}>
          <div className="project-menu__header">
            <div><span>Bibliothèque locale</span><strong>{entries.length} projet(s)</strong></div>
            <IconButton icon="close" title="Fermer" onClick={onToggle} />
          </div>
          <div className="project-menu__search"><Icon name="folder" size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un projet…" /></div>
          <div className="project-menu__list">
            {filtered.map((entry) => (
              <button type="button" key={entry.id} className={`project-row ${entry.id === project.id ? 'is-active' : ''}`} onClick={() => onSwitch(entry.id)}>
                <span className="project-row__mark">{entry.id === project.id ? <Icon name="check" size={12} /> : null}</span>
                <span className="project-row__copy"><strong>{entry.name}</strong><small>{entry.drxCount} DRX · {entry.ramanCount} Raman · {entry.irCount || 0} IR · {new Date(entry.updatedAt).toLocaleDateString('fr-FR')}</small></span>
              </button>
            ))}
            {!filtered.length && <div className="project-menu__empty">Aucun projet correspondant.</div>}
          </div>
          <div className="project-menu__actions">
            <Button icon="plus" variant="primary" onClick={onCreate}>Nouveau</Button>
            <Button icon="duplicate" variant="secondary" onClick={onDuplicate}>Dupliquer</Button>
            <Button variant="secondary" onClick={onRename}>Renommer</Button>
            <Button icon="save" variant="secondary" onClick={onExport}>Exporter</Button>
            <Button icon="trash" variant="ghost" className="button--danger" onClick={onDelete}>Supprimer</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BulkActionBar({ count, onSelectAll, onShow, onHide, onDuplicate, onLock, onUnlock, onDelete, onClear }) {
  if (!count) return null;
  return (
    <div className="bulk-bar">
      <div className="bulk-bar__count"><strong>{count}</strong><span>{tr(count > 1 ? "sélectionnés" : "sélectionné")}</span></div>
      <div className="bulk-bar__actions">
        <IconButton icon="selectAll" title="Tout sélectionner · Ctrl+A" onClick={onSelectAll} />
        <IconButton icon="eye" title="Afficher" onClick={onShow} />
        <IconButton icon="eyeOff" title="Masquer" onClick={onHide} />
        <IconButton icon="duplicate" title="Dupliquer" onClick={onDuplicate} />
        {onLock && <IconButton icon="lock" title="Verrouiller les patrons sélectionnés" onClick={onLock} />}
        {onUnlock && <IconButton icon="unlock" title="Déverrouiller les patrons sélectionnés" onClick={onUnlock} />}
        <IconButton icon="trash" title="Supprimer" danger onClick={onDelete} />
        <IconButton icon="close" title="Désélectionner" onClick={onClear} />
      </div>
    </div>
  );
}

function RangeNavigator({ patterns, fullRange, xmin, xmax, axisMode = "native", wavelength = 1.5406, unitLabel = "", reversed = false, onPreview, onCommit, onCancel }) {
  const ref = useRef(null);
  const dragRef = useRef(null);
  const draftRef = useRef(null);
  const [draft, setDraft] = useState(null);
  const view = draft || { xmin, xmax };
  const isConvertedDrxAxis = axisMode === "d" || axisMode === "q";
  const toAxisValue = useCallback((value) => isConvertedDrxAxis ? convertDrxX(value, axisMode, wavelength) : Number(value), [axisMode, isConvertedDrxAxis, wavelength]);
  const axisWindow = useCallback((nativeMin, nativeMax) => isConvertedDrxAxis
    ? drxAxisWindowFromTwoTheta(nativeMin, nativeMax, axisMode, wavelength)
    : { minimum: Number(nativeMin), maximum: Number(nativeMax) }, [axisMode, isConvertedDrxAxis, wavelength]);
  const toNativeWindow = useCallback((minimum, maximum) => isConvertedDrxAxis
    ? drxAxisWindowToTwoTheta(minimum, maximum, axisMode, wavelength)
    : { xmin: Number(minimum), xmax: Number(maximum) }, [axisMode, isConvertedDrxAxis, wavelength]);
  const fullAxisRange = axisWindow(fullRange.minimum, fullRange.maximum);
  const viewAxisRange = axisWindow(view.xmin, view.xmax);
  const axisWidth = Math.max(1e-12, fullAxisRange.maximum - fullAxisRange.minimum);
  // Le navigateur reproduit le sens de l’axe de la figure.
  const toPct = (axisValue) => {
    const percent = ((axisValue - fullAxisRange.minimum) / axisWidth) * 100;
    return reversed ? 100 - percent : percent;
  };
  const formatAxis = (value) => {
    if (!Number.isFinite(value)) return "—";
    if (axisMode === "d" || axisMode === "q") return value.toFixed(2);
    return value.toFixed(1);
  };

  useEffect(() => {
    if (!dragRef.current) {
      draftRef.current = null;
      setDraft(null);
    }
  }, [xmin, xmax, fullRange.minimum, fullRange.maximum, axisMode, wavelength]);

  useEffect(() => {
    const cancelWithEscape = (event) => {
      if (event.key !== "Escape" || !dragRef.current) return;
      event.preventDefault();
      const pointerId = dragRef.current.pointerId;
      try { ref.current?.releasePointerCapture?.(pointerId); } catch { /* no-op */ }
      dragRef.current = null;
      draftRef.current = null;
      setDraft(null);
      onPreview?.(null);
      onCancel?.();
    };
    window.addEventListener("keydown", cancelWithEscape);
    return () => window.removeEventListener("keydown", cancelWithEscape);
  }, [onCancel, onPreview]);

  const start = (event, action) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const initialAxis = axisWindow(xmin, xmax);
    dragRef.current = {
      action,
      startClientX: event.clientX,
      startMin: initialAxis.minimum,
      startMax: initialAxis.maximum,
      fullMin: fullAxisRange.minimum,
      fullMax: fullAxisRange.maximum,
      rectWidth: rect.width,
      pointerId: event.pointerId,
    };
    draftRef.current = { xmin: Number(xmin), xmax: Number(xmax) };
    setDraft(draftRef.current);
    ref.current?.setPointerCapture?.(event.pointerId);
  };

  const move = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const fullWidth = Math.max(1e-12, drag.fullMax - drag.fullMin);
    const minimumSpan = Math.max(fullWidth * 0.002, 1e-9);
    const delta = ((event.clientX - drag.startClientX) / Math.max(1, drag.rectWidth)) * fullWidth * (reversed ? -1 : 1);
    let nextMin = drag.startMin;
    let nextMax = drag.startMax;

    if (drag.action === "left") {
      nextMin = clamp(drag.startMin + delta, drag.fullMin, drag.startMax - minimumSpan);
    } else if (drag.action === "right") {
      nextMax = clamp(drag.startMax + delta, drag.startMin + minimumSpan, drag.fullMax);
    } else {
      const span = drag.startMax - drag.startMin;
      nextMin = drag.startMin + delta;
      nextMax = drag.startMax + delta;
      if (nextMin < drag.fullMin) {
        nextMin = drag.fullMin;
        nextMax = drag.fullMin + span;
      }
      if (nextMax > drag.fullMax) {
        nextMax = drag.fullMax;
        nextMin = drag.fullMax - span;
      }
    }

    const native = toNativeWindow(nextMin, nextMax);
    if (!native || !(native.xmax > native.xmin)) return;
    draftRef.current = native;
    setDraft(native);
    onPreview?.(native.xmin, native.xmax, drag.action);
  };

  const finish = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    try { ref.current?.releasePointerCapture?.(drag.pointerId); } catch { /* no-op */ }
    const finalDraft = draftRef.current;
    dragRef.current = null;
    draftRef.current = null;
    setDraft(null);
    onPreview?.(null);
    if (finalDraft) onCommit(finalDraft.xmin, finalDraft.xmax);
    event?.stopPropagation?.();
  };

  const overview = patterns.filter((pattern) => pattern.visible !== false).slice(0, 8).map((pattern) => {
    const points = [];
    const stride = Math.max(1, Math.ceil((pattern.x?.length || 0) / 260));
    let min = Infinity; let max = -Infinity;
    for (let i = 0; i < pattern.y.length; i += stride) { min = Math.min(min, pattern.y[i]); max = Math.max(max, pattern.y[i]); }
    const range = max - min || 1;
    for (let i = 0; i < pattern.x.length; i += stride) {
      const nativeX = pattern.x[i] + (Number(pattern.xoffset) || 0);
      const x = toPct(toAxisValue(nativeX));
      const y = 36 - ((pattern.y[i] - min) / range) * 25;
      points.push(`${points.length ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return { id: pattern.id, path: points.join("") };
  });

  // Position à l’écran des deux bornes : sur un axe inversé, le minimum est à droite.
  const minPct = clamp(toPct(viewAxisRange.minimum), 0, 100);
  const maxPct = clamp(toPct(viewAxisRange.maximum), 0, 100);
  const leftPct = Math.min(minPct, maxPct);
  const rightPct = Math.max(minPct, maxPct);
  return (
    <div
      className={`range-navigator ${draft ? "is-dragging" : ""}`}
      ref={ref}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" aria-label={tr("Navigateur de plage X")}>
        {overview.map((item, index) => <path key={item.id} d={item.path} fill="none" stroke="currentColor" opacity={0.14 + index * 0.04} strokeWidth="0.45" />)}
        <rect x="0" y="1" width={Math.max(0, leftPct)} height="40" className="range-navigator__outside" />
        <rect x={rightPct} y="1" width={Math.max(0, 100 - rightPct)} height="40" className="range-navigator__outside" />
        <rect x={leftPct} y="1" width={Math.max(0.5, rightPct - leftPct)} height="40" className="range-navigator__selection" onPointerDown={(event) => start(event, "move")} />
        <g className="range-navigator__grip" onPointerDown={(event) => start(event, "left")}>
          <rect x={minPct - 1.4} y="1" width="2.8" height="40" rx="0.7" />
          <line x1={minPct} x2={minPct} y1="4" y2="38" />
        </g>
        <g className="range-navigator__grip" onPointerDown={(event) => start(event, "right")}>
          <rect x={maxPct - 1.4} y="1" width="2.8" height="40" rx="0.7" />
          <line x1={maxPct} x2={maxPct} y1="4" y2="38" />
        </g>
      </svg>
      <span>{formatAxis(reversed ? fullAxisRange.maximum : fullAxisRange.minimum)}</span><strong>{formatAxis(viewAxisRange.minimum)} — {formatAxis(viewAxisRange.maximum)}{unitLabel && <small>{unitLabel}</small>}</strong><span>{formatAxis(reversed ? fullAxisRange.minimum : fullAxisRange.maximum)}</span>
    </div>
  );
}

function RawComparisonPreview({ data, colors, width, height, xmin, xmax }) {
  const margin = { left: 48, right: 90, top: 34, bottom: 42 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  let minimum = Infinity; let maximum = -Infinity;
  data.forEach((pattern) => pattern.py.forEach((value) => { minimum = Math.min(minimum, value + pattern.stackOffset); maximum = Math.max(maximum, value + pattern.stackOffset); }));
  if (!Number.isFinite(minimum) || maximum <= minimum) { minimum = 0; maximum = 1; }
  const xTo = (x) => margin.left + ((x - xmin) / (xmax - xmin)) * plotWidth;
  const yTo = (y) => margin.top + plotHeight - ((y - minimum) / (maximum - minimum)) * plotHeight;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" className="raw-comparison-svg">
      <rect width={width} height={height} fill="#fff" />
      <text x={margin.left} y="21" fontSize="12" fontWeight="700" fill="#303743">{tr("DONNÉES BRUTES")}</text>
      <defs><clipPath id="raw-compare-clip"><rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} /></clipPath></defs>
      <g clipPath="url(#raw-compare-clip)">{data.map((pattern) => {
        const path = pattern.px.map((x, index) => `${index ? "L" : "M"}${xTo(x).toFixed(2)},${yTo(pattern.py[index] + pattern.stackOffset).toFixed(2)}`).join("");
        return <path key={pattern.id} d={path} fill="none" stroke={colors.get(pattern.id) || "#111"} strokeWidth="0.9" />;
      })}</g>
      <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotHeight} stroke="#222" />
      <line x1={margin.left} x2={margin.left + plotWidth} y1={margin.top + plotHeight} y2={margin.top + plotHeight} stroke="#222" />
    </svg>
  );
}


function interpolateSeriesLocal(xs, ys, target) {
  if (!xs?.length || target < xs[0] || target > xs.at(-1)) return null;
  let low = 0; let high = xs.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (xs[middle] < target) low = middle + 1; else high = middle; }
  if (low === 0 || xs[low] === target) return ys[low];
  const left = low - 1; const fraction = (target - xs[left]) / (xs[low] - xs[left] || 1);
  return ys[left] + (ys[low] - ys[left]) * fraction;
}

function FigureLayoutLayer({ mode, processed, rawProcessed, activePatternId, settings, colors, bounds, xmin, xmax, onTextSelect }) {
  if (!processed.length || mode === "single") return null;
  const { x, y, width, height } = bounds;
  const gap = Math.max(8, Number(settings.panelGap) || 24);
  const panelLetterStart = String(settings.panelLetterStart || "a").toLowerCase().charCodeAt(0) || 97;
  const selectedA = processed.find((pattern) => pattern.id === settings.comparisonPatternAId) || processed.find((pattern) => pattern.id === activePatternId) || processed[0];
  const selectedB = processed.find((pattern) => pattern.id === settings.comparisonPatternBId && pattern.id !== selectedA?.id) || processed.find((pattern) => pattern.id !== selectedA?.id) || selectedA;
  let panels = [];
  if (mode === "grid") panels = processed.map((pattern) => ({ title: pattern.label, series: [{ ...pattern, values: pattern.displayY }] }));
  if (mode === "sideBySide") panels = [selectedA, selectedB].filter(Boolean).map((pattern) => ({ title: pattern.label, series: [{ ...pattern, values: pattern.displayY }] }));
  if (mode === "beforeAfter" && selectedA) {
    const raw = rawProcessed.find((pattern) => pattern.id === selectedA.id) || selectedA;
    panels = [{ title: `${selectedA.label} · brut`, series: [{ ...raw, values: raw.displayY }] }, { title: `${selectedA.label} · traité`, series: [{ ...selectedA, values: selectedA.displayY }] }];
  }
  if (mode === "differenceRatio" && selectedA && selectedB) {
    const xValues = selectedA.sourceX.filter((value) => value >= xmin && value <= xmax);
    const difference = []; const ratio = [];
    xValues.forEach((value, index) => {
      const a = interpolateSeriesLocal(selectedA.sourceX, selectedA.processedY, value) ?? 0;
      const b = interpolateSeriesLocal(selectedB.sourceX, selectedB.processedY, value) ?? 0;
      difference.push(a - b); ratio.push(a / (Math.abs(b) > Number(settings.ratioEpsilon || 1e-6) ? b : Number(settings.ratioEpsilon || 1e-6)));
    });
    panels = [
      { title: `${selectedA.label} − ${selectedB.label}`, zero: true, series: [{ id: "difference", sourceX: xValues, values: difference, label: "Différence", syntheticColor: colors.get(selectedA.id) || "#333" }] },
      { title: `${selectedA.label} / ${selectedB.label}`, zero: false, series: [{ id: "ratio", sourceX: xValues, values: ratio, label: "Rapport", syntheticColor: colors.get(selectedB.id) || "#555" }] },
    ];
  }
  if (!panels.length) return null;
  const columns = mode === "grid" ? Math.max(1, Math.min(4, Math.round(Number(settings.gridColumns) || 2))) : 2;
  const rows = Math.ceil(panels.length / columns);
  const panelWidth = (width - gap * (columns - 1)) / columns;
  const panelHeight = (height - gap * (rows - 1)) / rows;
  return <g className="figure-layout-layer">
    {panels.map((panel, panelIndex) => {
      const column = panelIndex % columns; const row = Math.floor(panelIndex / columns);
      const px = x + column * (panelWidth + gap); const py = y + row * (panelHeight + gap);
      const inner = { left: px + 40, right: px + panelWidth - 10, top: py + 24, bottom: py + panelHeight - 30 };
      let yMin = Infinity; let yMax = -Infinity;
      panel.series.forEach((series) => (series.values || []).forEach((value) => { if (Number.isFinite(value)) { yMin = Math.min(yMin, value); yMax = Math.max(yMax, value); } }));
      if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax <= yMin) { yMin = 0; yMax = 1; }
      const yPad = Math.max(1e-9, (yMax - yMin) * 0.08); yMin -= yPad; yMax += yPad;
      const xTo = (value) => {
        const position = inner.left + ((value - xmin) / Math.max(1e-12, xmax - xmin)) * (inner.right - inner.left);
        // Les panneaux suivent le sens de l’axe X de la figure principale.
        return settings.reverseXAxis ? inner.left + inner.right - position : position;
      };
      const yTo = (value) => inner.bottom - ((value - yMin) / Math.max(1e-12, yMax - yMin)) * (inner.bottom - inner.top);
      return <g key={`${mode}-${panelIndex}`}>
        <rect x={px} y={py} width={panelWidth} height={panelHeight} fill="none" stroke="#aeb4bc" strokeWidth="0.7" />
        <line x1={inner.left} x2={inner.left} y1={inner.top} y2={inner.bottom} stroke="#20252b" strokeWidth="0.8" />
        <line x1={inner.left} x2={inner.right} y1={inner.bottom} y2={inner.bottom} stroke="#20252b" strokeWidth="0.8" />
        {panel.zero && yMin < 0 && yMax > 0 && <line x1={inner.left} x2={inner.right} y1={yTo(0)} y2={yTo(0)} stroke="#697482" strokeDasharray="3 3" strokeWidth="0.7" />}
        {panel.series.map((series) => {
          const xs = series.sourceX || series.displayX || [];
          const values = series.values || [];
          let path = "";
          xs.forEach((value, index) => { if (value >= xmin && value <= xmax && Number.isFinite(values[index])) path += `${path ? "L" : "M"}${xTo(value).toFixed(2)},${yTo(values[index]).toFixed(2)}`; });
          return <path key={series.id} d={path} fill="none" stroke={series.syntheticColor || colors.get(series.id) || "#222"} strokeWidth={settings.lineWidth || 1} vectorEffect="non-scaling-stroke" />;
        })}
        <text x={px + 8} y={py + 16} fontSize={settings.panelTitleFontSize || 10} fontWeight={settings.panelTitleFontBold ? "700" : "400"} fill="#20252b" style={{ cursor: "pointer" }} onClick={(event) => onTextSelect?.(event, { kind: "settings", label: "Titres des panneaux", sizeKey: "panelTitleFontSize", boldKey: "panelTitleFontBold" })}>{settings.panelLettering !== false ? `(${String.fromCharCode(panelLetterStart + panelIndex)}) ` : ""}{truncateLabel(panel.title, 42)}</text>
        <text x={(inner.left + inner.right) / 2} y={py + panelHeight - 7} textAnchor="middle" fontSize={settings.panelAxisFontSize || 9} fontWeight={settings.panelAxisFontBold ? "700" : "400"} fill="#343a40" style={{ cursor: "pointer" }} onClick={(event) => onTextSelect?.(event, { kind: "settings", label: "Axes des panneaux", sizeKey: "panelAxisFontSize", boldKey: "panelAxisFontBold" })}>{settings.mode === "drx" ? "2θ (°)" : settings.mode === "ir" ? "Nombre d’onde (cm⁻¹)" : "Raman shift (cm⁻¹)"}</text>
      </g>;
    })}
    {settings.sharedPatternLegend && <g>
      {processed.slice(0, 8).map((pattern, index) => <g key={`shared-${pattern.id}`} transform={`translate(${x + width - 150},${y + 12 + index * Math.max(14, Number(settings.curveLegendFontSize) + 5 || 15)})`}><line x1="0" x2="18" y1="-3" y2="-3" stroke={colors.get(pattern.id) || "#222"} strokeWidth="2"/><text x="24" y="0" fontSize={settings.curveLegendFontSize || 10} fontWeight={settings.curveLegendFontBold ? "700" : "400"} fill="#20252b" style={{ cursor: "pointer" }} onClick={(event) => onTextSelect?.(event, { kind: "settings", label: "Légende des courbes", sizeKey: "curveLegendFontSize", boldKey: "curveLegendFontBold" })}>{truncateLabel(pattern.label, 22)}</text></g>)}
    </g>}
  </g>;
}

export default function App() {
  const history = useHistoryState(EMPTY_PROJECT);
  const project = history.value;
  const activeMode = resolveMode(project.activeMode);
  const workspace = project.workspaces?.[activeMode] || createWorkspace(activeMode);
  const { settings: S, patterns, phases, notes, zones = [] } = workspace;
  const isIr = activeMode === "ir";
  const supportsZones = MODES_WITH_ZONES.includes(activeMode);
  // La moyenne de réplicats a du sens pour les spectroscopies, pas pour la DRX.
  const supportsAveraging = activeMode !== "drx";
  // Grandeur portée en ordonnée pour l’infrarouge.
  const irQuantity = S.irYQuantity === "transmittance" ? "transmittance" : "absorbance";
  const workspaceOptions = useMemo(() => MODES.map((mode) => [mode, modeLabel(mode)]), []);
  const workspaceStats = useMemo(() => {
    const summarize = (mode) => {
      const value = project.workspaces?.[mode] || createWorkspace(mode);
      return {
        patterns: value.patterns.length,
        phases: value.phases.length,
        notes: value.notes.length,
        zones: value.zones.length,
        total: value.patterns.length + value.phases.length + value.notes.length + value.zones.length,
      };
    };
    return Object.fromEntries(MODES.map((mode) => [mode, summarize(mode)]));
  }, [project.workspaces]);

  const [leftTab, setLeftTab] = useState("patterns");
  const [rightTab, setRightTab] = useState("inspector");
  const [composerTab, setComposerTab] = useState("references");
  const [appearanceLevel, setAppearanceLevel] = useState(() => readLocalSetting("make-figure-appearance-level", "essential") === "advanced" ? "advanced" : "essential");
  const [leftWidth, setLeftWidth] = useState(() => Number(readLocalSetting("make-figure-left-width")) || 310);
  const [rightWidth, setRightWidth] = useState(() => Number(readLocalSetting("make-figure-right-width")) || 350);
  const [leftCollapsed, setLeftCollapsed] = useState(() => readLocalSetting("make-figure-left-collapsed", "false") === "true");
  const [rightCollapsed, setRightCollapsed] = useState(() => readLocalSetting("make-figure-right-collapsed", "false") === "true");
  const [uiDensity, setUiDensity] = useState(() => readLocalSetting("make-figure-density", "standard"));
  const [projectIndex, setProjectIndex] = useState([]);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [listFilter, setListFilter] = useState("");
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState([]);
  const [addNoteMode, setAddNoteMode] = useState(false);
  const [tool, setTool] = useState("cursor");
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [contextTarget, setContextTarget] = useState(null);
  const [textTarget, setTextTarget] = useState(null);
  const [snapToPeak, setSnapToPeak] = useState(() => readLocalSetting("make-figure-snap-to-peak", "true") === "true");
  const [magnetAlign, setMagnetAlign] = useState(() => readLocalSetting("make-figure-magnet-align", "true") === "true");
  const [showNavigator, setShowNavigator] = useState(() => readLocalSetting("make-figure-show-navigator", "true") === "true");
  const [comparisonView, setComparisonView] = useState(false);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [workspaceSize, setWorkspaceSize] = useState({ width: 1200, height: 800 });
  const [patternSort, setPatternSort] = useState({ key: "manual", direction: "asc" });
  const [groupViewBy, setGroupViewBy] = useState("none");
  const [batchRename, setBatchRename] = useState({ mode: "prefix", find: "", replace: "", value: "" });
  const [batchGroup, setBatchGroup] = useState({ type: "sample", name: "", value: "" });
  const [dropActive, setDropActive] = useState(false);
  const [autosaveState, setAutosaveState] = useState("loading");
  const [isExporting, setIsExporting] = useState(false);
  const [exportPreview, setExportPreview] = useState({ open: false, format: "png", serialized: "" });
  const [ramanAverageSelection, setRamanAverageSelection] = useState([]);
  const [ramanAverageLabel, setRamanAverageLabel] = useState("");
  const [manualPhase, setManualPhase] = useState({ name: "", abbrev: "", peaks: "", color: PHASE_COLORS[0] });
  const [zoneDraft, setZoneDraft] = useState({ name: "", xmin: 500, xmax: 700, color: "#7c5cff", opacity: 0.12 });
  const [peakFitResult, setPeakFitResult] = useState(null);
  const [multiFitResult, setMultiFitResult] = useState(null);
  const [multiFitDraft, setMultiFitDraft] = useState({ xmin: "", xmax: "", centers: "", model: "pseudoVoigt" });
  const [zoneSignal, setZoneSignal] = useState("corrected");
  const [zoneRatio, setZoneRatio] = useState({ a: "", b: "" });
  const [alignmentPreview, setAlignmentPreview] = useState(null);
  const [ramanDatabaseQuery, setRamanDatabaseQuery] = useState("");
  const [ramanDatabaseSelectedElements, setRamanDatabaseSelectedElements] = useState([]);
  const [ramanDatabaseSeed, setRamanDatabaseSeed] = useState([]);
  const [ramanDatabaseStatus, setRamanDatabaseStatus] = useState("idle");
  const [phaseLibrary, setPhaseLibrary] = useState(() => {
    try { return JSON.parse(readLocalSetting("make-figure-drx-phase-library", "[]")) || []; } catch { return []; }
  });
  const [styleTemplates, setStyleTemplates] = useState(() => {
    try { return JSON.parse(readLocalSetting("make-figure-style-templates", "[]")) || []; } catch { return []; }
  });
  const [templateName, setTemplateName] = useState("");
  // Langue de l'interface, persistée hors projet : elle relève du poste de
  // travail, pas de la figure.
  const [language, setLanguage] = useState(() => (readLocalSetting("make-figure-language") === "en" ? "en" : "fr"));
  UI_LANGUAGE = language;
  useEffect(() => { writeLocalSetting("make-figure-language", language); }, [language]);
  useEffect(() => { writeLocalSetting("make-figure-appearance-level", appearanceLevel); }, [appearanceLevel]);

  useEffect(() => {
    if (activeMode !== "raman" || rightTab !== "compose" || composerTab !== "references" || ramanDatabaseStatus !== "idle") return undefined;
    setRamanDatabaseStatus("loading");
    import("./ramanDatabaseSeed.json")
      .then((module) => {
        setRamanDatabaseSeed(Array.isArray(module.default) ? module.default : []);
        setRamanDatabaseStatus("ready");
      })
      .catch(() => setRamanDatabaseStatus("error"));
    return undefined;
  }, [activeMode, composerTab, ramanDatabaseStatus, rightTab]);

  // Les libellés d'axes jamais personnalisés suivent la langue de l'interface ;
  // ceux saisis par l'utilisateur ne sont jamais écrasés.
  useEffect(() => {
    history.set((current) => {
      if (!current?.workspaces) return current;
      let changed = false;
      // Nom de projet resté au libellé par défaut : il suit aussi la langue.
      let name = current.name;
      const stockNames = [["Premier projet", "First project"], ["Projet", "Project"]];
      for (const [fr, en] of stockNames) {
        const source = language === "en" ? fr : en;
        const target = language === "en" ? en : fr;
        if (name === source) { name = target; changed = true; break; }
        const numbered = new RegExp(`^${source} (\\d+)$`);
        const match = numbered.exec(name || "");
        if (match) { name = `${target} ${match[1]}`; changed = true; break; }
      }
      const workspaces = { ...current.workspaces };
      for (const mode of MODES) {
        const workspace = workspaces[mode];
        if (!workspace?.settings) continue;
        const quantity = workspace.settings.irYQuantity === "transmittance" ? "transmittance" : "absorbance";
        const defaults = defaultAxisLabels(mode, language, quantity);
        const next = { ...workspace.settings };
        if (STOCK_AXIS_LABELS.x.includes(next.xlabel) && next.xlabel !== defaults.xlabel) { next.xlabel = defaults.xlabel; changed = true; }
        if (STOCK_AXIS_LABELS.y.includes(next.ylabel) && next.ylabel !== defaults.ylabel) { next.ylabel = defaults.ylabel; changed = true; }
        if (changed) workspaces[mode] = { ...workspace, settings: next };
      }
      return changed ? { ...current, name, workspaces } : current;
    }, { replace: true });
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  const [reduceMotion, setReduceMotion] = useState(() => {
    try {
      const stored = readLocalSetting("make-figure-reduce-motion");
      if (stored !== null) return stored === "true";
      return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    } catch { return false; }
  });

  const normalizedListFilter = listFilter.trim().toLocaleLowerCase("fr");
  const filteredPatterns = useMemo(() => normalizedListFilter ? patterns.filter((item) => `${item.label || ""} ${item.fileName || ""}`.toLocaleLowerCase("fr").includes(normalizedListFilter)) : patterns, [patterns, normalizedListFilter]);
  const filteredPhases = useMemo(() => normalizedListFilter ? phases.filter((item) => `${item.name || ""} ${phaseSubtitle(item)}`.toLocaleLowerCase("fr").includes(normalizedListFilter)) : phases, [phases, normalizedListFilter]);
  const filteredZones = useMemo(() => normalizedListFilter ? zones.filter((item) => `${item.name || ""}`.toLocaleLowerCase("fr").includes(normalizedListFilter)) : zones, [zones, normalizedListFilter]);
  const filteredNotes = useMemo(() => normalizedListFilter ? notes.filter((item) => `${item.text || ""}`.toLocaleLowerCase("fr").includes(normalizedListFilter)) : notes, [notes, normalizedListFilter]);
  const patternGroups = useMemo(() => orderedGroups(filteredPatterns, groupViewBy), [filteredPatterns, groupViewBy]);
  const ramanDatabaseElements = useMemo(() => [...new Set(ramanDatabaseSeed.flatMap((entry) => extractFormulaElements(entry?.formula || "")))].sort(), []);
  const ramanDatabaseMatches = useMemo(() => {
    const normalizedQuery = normalizeSearchText(ramanDatabaseQuery);
    const normalizedElements = ramanDatabaseSelectedElements.map((element) => element.toLocaleLowerCase("fr"));
    const candidates = ramanDatabaseSeed
      .map((entry) => {
        const { score, matchedElements } = scoreRamanDatabaseEntry(entry, normalizedQuery, normalizedElements);
        return { ...entry, score, matchedElements };
      })
      .filter((entry) => {
        if (!normalizedQuery && !normalizedElements.length) return false;
        return entry.score > 0;
      })
      .sort((a, b) => b.score - a.score || (a.name || "").localeCompare(b.name || ""))
      .slice(0, 25);
    return candidates;
  }, [ramanDatabaseQuery, ramanDatabaseSelectedElements]);

  const svgRef = useRef(null);
  const workspaceRef = useRef(null);
  const patternInputRef = useRef(null);
  const phaseInputRef = useRef(null);
  const sessionInputRef = useRef(null);
  const appendPhaseInputRef = useRef(null);
  const appendTargetRef = useRef(null);
  const draggedRef = useRef(null);
  const autosaveLoadedRef = useRef(false);
  const selectionAnchorRef = useRef(null);
  const projectMenuRef = useRef(null);
  const panRef = useRef(null);
  const interactionRef = useRef(null);
  const suppressClickRef = useRef(false);

  const openContextOptions = useCallback((event, { tab = "inspector", type = null, id = null, target = null } = {}) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (type && id) {
      setSelection([{ type, id }]);
      selectionAnchorRef.current = { type, id };
    }
    setRightCollapsed(false);
    if (tab === "references" || tab === "appearance") {
      setComposerTab(tab);
      setRightTab("compose");
    } else {
      setRightTab(tab);
    }
    setContextTarget(target || null);
  }, []);

  useEffect(() => {
    if (!contextTarget) return undefined;
    let secondFrame = null;
    const firstFrame = requestAnimationFrame(() => {
      const element = document.querySelector(`[data-context-target="${contextTarget}"]`);
      if (!element) { setContextTarget(null); return; }
      const section = element.matches?.(".property-section") ? element : element.closest?.(".property-section");
      if (section && !section.classList.contains("is-open")) section.querySelector(".property-section__header")?.click();
      secondFrame = requestAnimationFrame(() => {
        element.scrollIntoView?.({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
        const focusable = element.matches?.("input, textarea, select, button") ? element : element.querySelector?.("input, textarea, select, button");
        focusable?.focus?.({ preventScroll: true });
        if (focusable?.select && ["text", "number"].includes(focusable.type)) focusable.select();
        setContextTarget(null);
      });
    });
    return () => { cancelAnimationFrame(firstFrame); if (secondFrame) cancelAnimationFrame(secondFrame); };
  }, [composerTab, contextTarget, rightTab, selection, reduceMotion]);

  const patchSettings = useCallback((key, value, options) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      settings: { ...currentWorkspace.settings, [key]: value },
    })), { coalesceKey: `settings:${activeMode}:${key}`, ...options });
  }, [activeMode, history]);

  const patchSettingsValues = useCallback((values, options) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      settings: { ...currentWorkspace.settings, ...values },
    })), options);
  }, [activeMode, history]);

  // Bascule absorbance ↔ transmittance : la conversion des spectres est faite
  // par le pipeline de traitement, on n’ajuste ici que le libellé d’axe et le
  // cadrage vertical, qui ne sont plus valables dans la nouvelle grandeur.
  const setIrQuantity = useCallback((value) => {
    const target = value === "transmittance" ? "transmittance" : "absorbance";
    const isDefaultLabel = Object.values(IR_Y_LABELS).includes(S.ylabel);
    patchSettingsValues({
      irYQuantity: target,
      viewYMin: null,
      viewYMax: null,
      ...(isDefaultLabel ? { ylabel: IR_Y_LABELS[target] } : {}),
    });
  }, [S.ylabel, patchSettingsValues]);

  const updatePattern = useCallback((id, key, value) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((pattern) => pattern.id === id
        ? (canUpdatePatternField(pattern, key) ? { ...pattern, [key]: value } : pattern)
        : pattern),
    })), { coalesceKey: `pattern:${id}:${key}` });
  }, [activeMode, history]);


  const updatePhase = useCallback((id, key, value) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      settings: key === "inAnnot" && value
        ? { ...currentWorkspace.settings, showAnnotations: true }
        : key === "inPanel" && value
          ? { ...currentWorkspace.settings, showPdfPanel: true }
        : currentWorkspace.settings,
      phases: currentWorkspace.phases.map((phase) => phase.id === id ? { ...phase, [key]: value } : phase),
    })), { coalesceKey: `phase:${id}:${key}` });
  }, [activeMode, history]);

  const setPhaseAnnotationsVisible = useCallback((visible) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => {
      const hasVisibleAnnotatedPhase = currentWorkspace.phases.some((phase) => phase.visible && phase.inAnnot);
      return {
        ...currentWorkspace,
        settings: { ...currentWorkspace.settings, showAnnotations: visible },
        phases: visible && !hasVisibleAnnotatedPhase
          ? currentWorkspace.phases.map((phase) => phase.visible ? { ...phase, inAnnot: true } : phase)
          : currentWorkspace.phases,
      };
    }), { coalesceKey: `settings:${activeMode}:showAnnotations` });
  }, [activeMode, history]);

  const setReferencePanelVisible = useCallback((visible) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => {
      const hasVisiblePanelPhase = currentWorkspace.phases.some((phase) => phase.visible && phase.inPanel);
      return {
        ...currentWorkspace,
        settings: { ...currentWorkspace.settings, showPdfPanel: visible },
        phases: visible && !hasVisiblePanelPhase
          ? currentWorkspace.phases.map((phase) => phase.visible ? { ...phase, inPanel: true } : phase)
          : currentWorkspace.phases,
      };
    }), { coalesceKey: `settings:${activeMode}:showPdfPanel` });
  }, [activeMode, history]);

  const updateNote = useCallback((id, key, value) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      notes: currentWorkspace.notes.map((note) => note.id === id ? { ...note, [key]: value } : note),
    })), { coalesceKey: `note:${id}:${key}` });
  }, [activeMode, history]);

  const updateZone = useCallback((id, key, value) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      zones: currentWorkspace.zones.map((zone) => zone.id === id ? { ...zone, [key]: value } : zone),
    })), { coalesceKey: `zone:${id}:${key}` });
  }, [activeMode, history]);

  const activateTextTarget = useCallback((event, target) => {
    event?.stopPropagation?.();
    setTextTarget(target);
  }, []);

  const textTargetStyle = useMemo(() => {
    if (!textTarget) return null;
    let item = null;
    if (textTarget.kind === "pattern") item = patterns.find((entry) => entry.id === textTarget.id);
    else if (textTarget.kind === "phase") item = phases.find((entry) => entry.id === textTarget.id);
    else if (textTarget.kind === "note") item = notes.find((entry) => entry.id === textTarget.id);
    else if (textTarget.kind === "zone") item = zones.find((entry) => entry.id === textTarget.id);
    const source = textTarget.kind === "settings" ? S : item;
    if (!source) return null;
    const size = finiteNumber(source[textTarget.sizeKey], finiteNumber(S[textTarget.fallbackSizeKey], 10));
    const boldSource = source[textTarget.boldKey];
    const bold = boldSource === undefined ? Boolean(S[textTarget.fallbackBoldKey]) : Boolean(boldSource);
    return { size, bold };
  }, [S, notes, patterns, phases, textTarget, zones]);

  const updateTextTargetStyle = useCallback((field, value) => {
    if (!textTarget) return;
    const key = field === "size" ? textTarget.sizeKey : textTarget.boldKey;
    if (textTarget.kind === "settings") patchSettings(key, value);
    else if (textTarget.kind === "pattern") updatePattern(textTarget.id, key, value);
    else if (textTarget.kind === "phase") updatePhase(textTarget.id, key, value);
    else if (textTarget.kind === "note") updateNote(textTarget.id, key, value);
    else if (textTarget.kind === "zone") updateZone(textTarget.id, key, value);
  }, [patchSettings, textTarget, updateNote, updatePattern, updatePhase, updateZone]);

  const moveItemToWorkspace = useCallback((type, id, targetMode) => {
    const destination = resolveMode(targetMode);
    if (destination === activeMode || !["pattern", "phase"].includes(type)) return;
    const key = type === "pattern" ? "patterns" : "phases";
    history.set((current) => {
      const sourceWorkspace = current.workspaces?.[activeMode] || createWorkspace(activeMode);
      const item = sourceWorkspace[key].find((entry) => entry.id === id);
      if (!item) return current;
      if (type === "pattern" && item.locked) return current;
      let next = updateWorkspaceProject(current, activeMode, (value) => ({
        ...value,
        [key]: value[key].filter((entry) => entry.id !== id),
      }));
      next = updateWorkspaceProject(next, destination, (value) => ({
        ...value,
        [key]: [...value[key], item],
      }));
      return next;
    });
    setSelection([]); selectionAnchorRef.current = null;
    setMessage(`${type === "pattern" ? "Patron" : "Phase"} déplacé vers l’espace ${modeLabel(destination)}.`);
  }, [activeMode, history]);

  const refreshProjectIndex = useCallback(async () => {
    const entries = await listStoredProjects();
    setProjectIndex(entries);
    return entries;
  }, []);

  useEffect(() => {
    if (autosaveLoadedRef.current) return;
    autosaveLoadedRef.current = true;
    (async () => {
      try {
        const entries = await listStoredProjects();
        let restored = null;
        const preferredId = readLocalSetting("make-figure-active-project");
        const preferred = entries.find((entry) => entry.id === preferredId) || entries[0];
        if (preferred) restored = await loadStoredProject(preferred.id);
        if (!restored) {
          const legacy = await loadAutosave();
          restored = legacy ? validateProject(legacy) : createEmptyProject("drx", { name: tr("Premier projet") });
          await saveStoredProject(restored);
        }
        history.replace(restored);
        writeLocalSetting("make-figure-active-project", restored.id);
        setProjectIndex(await listStoredProjects());
        setMessage(entries.length ? `Projet « ${restored.name} » restauré.` : "Bibliothèque locale initialisée.");
        setAutosaveState("saved");
      } catch (error) {
        console.error(error);
        setAutosaveState("error");
      }
    })();
  }, [history]);

  useEffect(() => {
    if (autosaveState === "loading" || !project?.id) return undefined;
    setAutosaveState("saving");
    const timer = window.setTimeout(() => {
      saveStoredProject(project)
        .then(async () => {
          writeLocalSetting("make-figure-active-project", project.id);
          // Signale aux autres onglets qu'une sauvegarde vient d'écraser ce projet.
          try { tabChannelRef.current?.postMessage({ projectId: project.id, tabId: tabIdRef.current }); } catch { /* canal indisponible */ }
          await refreshProjectIndex();
          setAutosaveState("saved");
        })
        .catch(() => setAutosaveState("error"));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [project, autosaveState === "loading", refreshProjectIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Détection de conflit : un autre onglet enregistre le même projet.
  const tabIdRef = useRef(newId("tab"));
  const tabChannelRef = useRef(null);
  const tabWarningRef = useRef(0);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return undefined;
    const channel = new BroadcastChannel("make-figure-tabs");
    tabChannelRef.current = channel;
    channel.onmessage = (event) => {
      const data = event?.data;
      if (!data || data.tabId === tabIdRef.current) return;
      if (data.projectId !== projectIdRef.current) return;
      const now = Date.now();
      if (now - tabWarningRef.current < 60000) return;
      tabWarningRef.current = now;
      setMessage("Ce projet est aussi ouvert dans un autre onglet : les sauvegardes automatiques s'écrasent mutuellement. Fermer l'un des deux onglets.");
    };
    return () => { channel.close(); tabChannelRef.current = null; };
  }, []);
  const projectIdRef = useRef(null);
  useEffect(() => { projectIdRef.current = project?.id || null; }, [project?.id]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const eligible = new Set(patterns.filter((pattern) => !pattern.isAverage).map((pattern) => pattern.id));
    setRamanAverageSelection((current) => {
      const filtered = current.filter((id) => eligible.has(id));
      return filtered.length === current.length && filtered.every((id, index) => id === current[index]) ? current : filtered;
    });
  }, [patterns]);

  useEffect(() => {
    writeLocalSetting("make-figure-reduce-motion", reduceMotion)
  }, [reduceMotion]);

  useEffect(() => {
    writeLocalSetting("make-figure-snap-to-peak", snapToPeak);
    writeLocalSetting("make-figure-show-navigator", showNavigator);
    writeLocalSetting("make-figure-magnet-align", magnetAlign);
  }, [snapToPeak, showNavigator, magnetAlign]);

  useEffect(() => {
    writeLocalSetting("make-figure-drx-phase-library", JSON.stringify(phaseLibrary));
  }, [phaseLibrary]);

  useEffect(() => {
    writeLocalSetting("make-figure-style-templates", JSON.stringify(styleTemplates));
  }, [styleTemplates]);

  useEffect(() => {
    writeLocalSetting("make-figure-left-width", leftWidth);
    writeLocalSetting("make-figure-right-width", rightWidth);
    writeLocalSetting("make-figure-left-collapsed", leftCollapsed);
    writeLocalSetting("make-figure-right-collapsed", rightCollapsed);
    writeLocalSetting("make-figure-density", uiDensity);
  }, [leftWidth, rightWidth, leftCollapsed, rightCollapsed, uiDensity]);

  useEffect(() => {
    if (!projectMenuOpen) return undefined;
    const close = (event) => {
      if (!projectMenuRef.current?.contains(event.target)) setProjectMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [projectMenuOpen]);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setWorkspaceSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [leftCollapsed, rightCollapsed, showNavigator, editorFullscreen]);

  const axisPreviewActive = ["xAxisWindow", "rangeNavigator"].includes(dragPreview?.type)
    && Number.isFinite(dragPreview.xmin)
    && Number.isFinite(dragPreview.xmax)
    && dragPreview.xmax > dragPreview.xmin;
  const viewXMin = axisPreviewActive ? dragPreview.xmin : S.xmin;
  const viewXMax = axisPreviewActive ? dragPreview.xmax : S.xmax;
  const plotSettings = useMemo(() => (axisPreviewActive
    ? { ...S, xmin: viewXMin, xmax: viewXMax }
    : S), [S, axisPreviewActive, viewXMin, viewXMax]);

  const processed = useMemo(() => processPatterns(patterns, plotSettings), [patterns, plotSettings]);
  const rawProcessed = useMemo(() => processPatterns(patterns, {
    ...plotSettings,
    smoothW: 1,
    clipPct: 100,
    baselineMode: "none",
    baselineClamp: false,
    showDetectedPeaks: false,
  }), [patterns, plotSettings]);
  const visibleCount = processed.length;

  const fullXRange = useMemo(() => {
    let minimum = Infinity;
    let maximum = -Infinity;
    patterns.filter((pattern) => pattern.visible !== false).forEach((pattern) => {
      const offset = Number(pattern.xoffset) || 0;
      pattern.x?.forEach((value) => {
        const shifted = value + offset;
        if (Number.isFinite(shifted)) {
          minimum = Math.min(minimum, shifted);
          maximum = Math.max(maximum, shifted);
        }
      });
    });
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return { minimum: S.xmin, maximum: S.xmax };
    const padding = Math.max((maximum - minimum) * 0.01, activeMode === "drx" ? 0.05 : 1);
    return { minimum: Math.min(S.xmin, minimum - padding), maximum: Math.max(S.xmax, maximum + padding) };
  }, [activeMode, patterns, S.xmin, S.xmax]);

  const colorMap = useMemo(() => {
    const result = new Map();
    processed.forEach((pattern, index) => result.set(pattern.id, patternColor(pattern, index, visibleCount, S)));
    return result;
  }, [processed, visibleCount, S]);

  const primarySelection = selection.length ? selection[selection.length - 1] : null;
  const selectionKey = useCallback((type, id) => `${type}:${id}`, []);
  const selectedKeySet = useMemo(() => new Set(selection.map((item) => selectionKey(item.type, item.id))), [selection, selectionKey]);
  const selectedByType = useMemo(() => {
    const result = { pattern: new Set(), phase: new Set(), note: new Set(), zone: new Set() };
    selection.forEach((item) => result[item.type]?.add(item.id));
    return result;
  }, [selection]);
  const isSelected = useCallback((type, id) => selectedKeySet.has(selectionKey(type, id)), [selectedKeySet, selectionKey]);
  const activePattern = primarySelection?.type === "pattern" ? patterns.find((pattern) => pattern.id === primarySelection.id) : null;
  const activePhase = primarySelection?.type === "phase" ? phases.find((phase) => phase.id === primarySelection.id) : null;
  const activeNote = primarySelection?.type === "note" ? notes.find((note) => note.id === primarySelection.id) : null;
  const activeZone = primarySelection?.type === "zone" ? zones.find((zone) => zone.id === primarySelection.id) : null;
  // Fiche OPUS du patron inspecté, à défaut du premier spectre IR importé.
  const activeIrMetadata = isIr
    ? (activePattern?.irMetadata || patterns.find((pattern) => pattern.irMetadata)?.irMetadata || null)
    : null;
  const selectionCount = selection.length;

  const idsForType = useCallback((type) => {
    if (type === "pattern") return filteredPatterns.map((item) => item.id);
    if (type === "phase") return filteredPhases.map((item) => item.id);
    if (type === "zone") return filteredZones.map((item) => item.id);
    if (type === "note") return filteredNotes.map((item) => item.id);
    return [];
  }, [filteredPatterns, filteredPhases, filteredZones, filteredNotes]);

  const selectItem = useCallback((event, type, id) => {
    const additive = Boolean(event?.ctrlKey || event?.metaKey);
    const ranged = Boolean(event?.shiftKey);
    const nextItem = { type, id };
    setSelection((current) => {
      if (ranged && selectionAnchorRef.current?.type === type) {
        const ids = idsForType(type);
        const start = ids.indexOf(selectionAnchorRef.current.id);
        const end = ids.indexOf(id);
        if (start >= 0 && end >= 0) {
          const range = ids.slice(Math.min(start, end), Math.max(start, end) + 1).map((rangeId) => ({ type, id: rangeId }));
          if (!additive) return range;
          const existing = new Map(current.map((item) => [selectionKey(item.type, item.id), item]));
          range.forEach((item) => existing.set(selectionKey(item.type, item.id), item));
          return [...existing.values()];
        }
      }
      if (additive) {
        const key = selectionKey(type, id);
        const exists = current.some((item) => selectionKey(item.type, item.id) === key);
        if (exists) return current.filter((item) => selectionKey(item.type, item.id) !== key);
        return [...current, nextItem];
      }
      return [nextItem];
    });
    selectionAnchorRef.current = nextItem;
    setRightTab("inspector");
  }, [idsForType, selectionKey]);

  const clearSelection = useCallback(() => {
    setSelection([]);
    selectionAnchorRef.current = null;
  }, []);

  const selectAllCurrentTab = useCallback(() => {
    const type = leftTab === "patterns" ? "pattern" : leftTab === "phases" ? "phase" : leftTab === "zones" ? "zone" : "note";
    const ids = idsForType(type);
    setSelection(ids.map((id) => ({ type, id })));
    selectionAnchorRef.current = ids.length ? { type, id: ids[ids.length - 1] } : null;
    if (ids.length) setRightTab("inspector");
  }, [idsForType, leftTab]);

  const readPhaseFile = async (file) => {
    const fallbackName = file.name.replace(/\.(dif|cif|txt|csv|dat)$/i, "").replace(/^PDF\s*/i, "");
    if (/\.cif$/i.test(file.name)) {
      const cif = parseCIFText(await file.text(), fallbackName);
      const calculated = calculateCifPattern(cif, { wavelength: Number(S.wavelength) || 1.5406, xmin: Math.min(3, Number(S.xmin) || 10), xmax: Math.max(100, Number(S.xmax) || 80), maxIndex: 12 });
      return { kind: "cif-calculated", peaks: calculated.map(([x, intensity]) => [x, intensity]), metadata: { CIF_FORMULA: cif.formula, CIF_CELL: cif.cell }, name: cif.name || fallbackName, cif };
    }
    if (/\.dif$/i.test(file.name)) {
      const buffer = await file.arrayBuffer();
      let peaks = parseDIFBinary(buffer);
      if (!peaks.length) {
        try {
          const decoded = new TextDecoder("latin1").decode(buffer);
          const reference = parseReferenceText(decoded, { fallbackName });
          peaks = reference.peaks;
        } catch { peaks = []; }
      }
      return { kind: "peak-list", peaks, metadata: {}, name: fallbackName };
    }
    return parseReferenceText(await file.text(), { fallbackName });
  };

  const importPatterns = useCallback(async (files) => {
    const additionsByMode = Object.fromEntries(MODES.map((mode) => [mode, []]));
    const warnings = [];
    const basePattern = (file, label, x, y) => ({
      id: newId("pattern"),
      label,
      fileName: file.name,
      x,
      y,
      visible: true,
      color: "#111111",
      yscale: 1,
      xoffset: 0,
      locked: false,
      userNotes: "",
      orderValue: extractOrderValue(file.name),
      groupType: "",
      groupName: "",
      groupValue: "",
      importedAt: Date.now(),
      fileMetadata: {
        size: Number(file.size) || 0,
        type: String(file.type || "text/plain"),
        lastModified: Number(file.lastModified) || null,
      },
    });

    for (const file of files) {
      try {
        // OPUS binaire (.0, .1, …) : détection par nombre magique.
        if (/\.\d{1,4}$/.test(file.name) || /\.opus$/i.test(file.name)) {
          const buffer = await file.arrayBuffer();
          if (isOpusBinary(buffer)) {
            const opus = parseOpusBinary(buffer, { fallbackName: file.name.replace(/\.\d+$/, "") });
            const block = pickOpusBlock(opus.blocks, "absorbance");
            if (!block) { warnings.push(`${file.name}: aucun bloc absorbance ou transmittance`); continue; }
            additionsByMode.ir.push({
              ...basePattern(file, opus.name || file.name, block.x, block.y),
              irQuantity: block.quantity === "transmittance" ? "transmittance" : "absorbance",
              irBlock: block.key,
              irBlocks: opus.blocks.map(({ key, label: blockLabel, quantity, pointCount }) => ({ key, label: blockLabel, quantity, pointCount })),
              irMetadata: opus.metadata,
            });
            continue;
          }
        }
        const text = await file.text();

        // Panalytical .xrdml : diffractogramme(s), dirigé(s) vers l'espace DRX.
        if (/\.xrdml$/i.test(file.name) || isXrdmlText(text)) {
          const scans = parseXrdml(text, file.name.replace(/\.xrdml$/i, ""));
          scans.forEach((scan) => {
            additionsByMode.drx.push(basePattern(file, scan.name, scan.x, scan.y));
          });
          continue;
        }

        // Export XML Bruker OPUS : spectre infrarouge, dirigé vers l’espace IR.
        if (isOpusXmlText(text)) {
          const opus = parseOpusXml(text, { fallbackName: file.name.replace(/\.xml$/i, "") });
          const block = pickOpusBlock(opus.blocks, "absorbance");
          if (!block) {
            warnings.push(`${file.name}: aucun bloc absorbance ou transmittance`);
            continue;
          }
          const label = opus.name || file.name.replace(/\.xml$/i, "");
          additionsByMode.ir.push({
            ...basePattern(file, label, block.x, block.y),
            irQuantity: block.quantity === "transmittance" ? "transmittance" : "absorbance",
            irBlock: block.key,
            irBlocks: opus.blocks.map(({ key, label: blockLabel, quantity, pointCount }) => ({ key, label: blockLabel, quantity, pointCount })),
            irMetadata: opus.metadata,
          });
          continue;
        }

        const parsed = parseXYText(text);
        if (parsed.x.length < 5) {
          warnings.push(`${file.name}: moins de 5 points valides`);
          continue;
        }
        additionsByMode[activeMode].push(basePattern(file, file.name.replace(/\.(xy|txt|csv|dat)$/i, ""), parsed.x, parsed.y));
        if (parsed.ignored) warnings.push(`${file.name}: ${parsed.ignored} ligne(s) ignorée(s)`);
      } catch (error) {
        warnings.push(`${file.name}: ${error?.message || "lecture impossible"}`);
      }
    }

    const importedModes = MODES.filter((mode) => additionsByMode[mode].length);
    if (importedModes.length) {
      const primaryMode = importedModes.includes(activeMode) ? activeMode : importedModes[0];
      history.set((current) => {
        let next = current;
        for (const mode of importedModes) {
          next = updateWorkspaceProject(next, mode, (currentWorkspace) => ({
            ...currentWorkspace,
            patterns: [...currentWorkspace.patterns, ...additionsByMode[mode]],
          }));
        }
        return { ...next, activeMode: primaryMode };
      });
      setLeftTab("patterns");
      const selectedId = additionsByMode[primaryMode][0].id;
      setSelection([{ type: "pattern", id: selectedId }]); selectionAnchorRef.current = { type: "pattern", id: selectedId };
      const summary = importedModes.map((mode) => `${additionsByMode[mode].length} vers ${modeLabel(mode)}`).join(" · ");
      setMessage(`Patrons importés : ${summary}${warnings.length ? ` · ${warnings.join(" · ")}` : ""}`);
    } else if (warnings.length) setMessage(warnings.join(" · "));
  }, [activeMode, history]);

  const importPhases = useCallback(async (files) => {
    const additionsByMode = Object.fromEntries(MODES.map((mode) => [mode, []]));
    const warnings = [];
    for (const file of files) {
      try {
        const reference = await readPhaseFile(file);
        if (!reference.peaks.length) {
          warnings.push(`${file.name}: aucun pic significatif détecté`);
          continue;
        }
        const detectedMode = reference.kind === "raman-spectrum"
          || /raman/i.test(reference.metadata?.FILETYPE || "")
          ? "raman"
          : (/\.(dif|cif)$/i.test(file.name) ? "drx" : activeMode);
        const targetPhases = project.workspaces?.[detectedMode]?.phases || [];
        const bucket = additionsByMode[detectedMode];
        const name = reference.name || file.name.replace(/\.(dif|cif|txt|csv|dat)$/i, "").replace(/^PDF\s*/i, "");
        const candidate = {
          id: newId("phase"),
          name,
          abbrev: name.slice(0, 3),
          color: PHASE_COLORS[(targetPhases.length + bucket.length) % PHASE_COLORS.length],
          peaks: reference.peaks,
          files: [file.name],
          visible: true,
          inAnnot: true,
          inPanel: true,
          sourceKind: reference.kind,
          metadata: reference.metadata || {},
          referenceSpectrum: reference.spectrum || null,
          ramanOptions: reference.ramanOptions || null,
          cifData: reference.cif || null,
        };
        candidate.subtitle = defaultPhaseSubtitle(candidate);
        const rruffId = candidate.metadata?.RRUFFID;
        const duplicateIndex = rruffId ? bucket.findIndex((phase) => phase.metadata?.RRUFFID === rruffId) : -1;
        if (duplicateIndex >= 0) {
          const previous = bucket[duplicateIndex];
          const candidateProcessed = /processed/i.test(candidate.metadata?.FILETYPE || "");
          const previousProcessed = /processed/i.test(previous.metadata?.FILETYPE || "");
          bucket[duplicateIndex] = candidateProcessed || !previousProcessed
            ? { ...candidate, id: previous.id, color: previous.color, files: [...previous.files, file.name] }
            : { ...previous, files: [...previous.files, file.name] };
        } else bucket.push(candidate);
      } catch {
        warnings.push(`${file.name}: lecture impossible`);
      }
    }

    const importedModes = MODES.filter((mode) => additionsByMode[mode].length);
    if (importedModes.length) {
      const primaryMode = importedModes.length === 1 ? importedModes[0] : activeMode;
      history.set((current) => {
        let next = current;
        for (const mode of importedModes) {
          next = updateWorkspaceProject(next, mode, (currentWorkspace) => ({
            ...currentWorkspace,
            phases: [...currentWorkspace.phases, ...additionsByMode[mode]],
          }));
        }
        return { ...next, activeMode: primaryMode };
      });
      setLeftTab("phases");
      { const selectedId = additionsByMode[primaryMode][0]?.id || additionsByMode[importedModes[0]][0].id; setSelection([{ type: "phase", id: selectedId }]); selectionAnchorRef.current = { type: "phase", id: selectedId }; }
      const summary = importedModes.map((mode) => `${additionsByMode[mode].length} vers ${modeLabel(mode)}`).join(" · ");
      setMessage(`Phases importées : ${summary}${warnings.length ? ` · ${warnings.join(" · ")}` : ""}`);
    } else if (warnings.length) setMessage(warnings.join(" · "));
  }, [activeMode, history, project.workspaces]);

  const appendPhaseFile = async (files) => {
    const targetId = appendTargetRef.current;
    if (!targetId || !files.length) return;
    const file = files[0];
    const reference = await readPhaseFile(file);
    if (!reference.peaks.length) {
      setMessage(`Aucun pic valide dans ${file.name}.`);
      return;
    }
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      phases: currentWorkspace.phases.map((phase) => phase.id === targetId
        ? {
          ...phase,
          peaks: mergeDedupPeaks(phase.peaks, reference.peaks),
          files: [...phase.files, file.name],
          metadata: { ...(phase.metadata || {}), ...(reference.metadata || {}) },
        }
        : phase),
    })));
    setMessage(`Fiche ${file.name} fusionnée.`);
  };

  const createManualPhase = () => {
    const name = manualPhase.name.trim();
    const peaks = parseManualPeaks(manualPhase.peaks);
    if (!name) {
      setMessage("Saisir le nom de la phase.");
      return;
    }
    if (!peaks.length) {
      setMessage("Saisir au moins une position de pic valide.");
      return;
    }
    const phase = {
      id: newId("phase"),
      name,
      abbrev: manualPhase.abbrev.trim() || name.slice(0, 3),
      color: manualPhase.color,
      peaks,
      files: ["saisie manuelle"],
      visible: true,
      inAnnot: true,
      inPanel: true,
      sourceKind: "manual",
      metadata: {},
      subtitle: "saisie manuelle",
      showSubtitle: true,
    };
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      phases: [...currentWorkspace.phases, phase],
    })));
    setManualPhase({ name: "", abbrev: "", peaks: "", color: PHASE_COLORS[(phases.length + 1) % PHASE_COLORS.length] });
    setSelection([{ type: "phase", id: phase.id }]); selectionAnchorRef.current = { type: "phase", id: phase.id };
    setRightTab("inspector");
    setMessage(`Phase « ${name} » ajoutée avec ${peaks.length} pic(s).`);
  };

  const recalculateRamanPhase = (phase) => {
    if (!phase?.referenceSpectrum?.x?.length) {
      setMessage("Cette phase ne contient pas de spectre Raman source.");
      return;
    }
    const peaks = extractRamanReferencePeaks(
      phase.referenceSpectrum.x,
      phase.referenceSpectrum.y,
      phase.ramanOptions || {},
    );
    if (!peaks.length) {
      setMessage("Aucun pic détecté avec ces paramètres.");
      return;
    }
    updatePhase(phase.id, "peaks", peaks);
    setMessage(`${peaks.length} pics Raman recalculés pour « ${phase.name} ».`);
  };

  const createZone = () => {
    const name = zoneDraft.name.trim();
    const xmin = Number(zoneDraft.xmin);
    const xmax = Number(zoneDraft.xmax);
    if (!name || !Number.isFinite(xmin) || !Number.isFinite(xmax) || xmax <= xmin) {
      setMessage("La zone nécessite un nom et des limites X valides.");
      return;
    }
    const zone = {
      id: newId("zone"),
      name, xmin, xmax,
      color: zoneDraft.color,
      opacity: Number(zoneDraft.opacity) || 0.12,
      visible: true,
      showLabel: true,
    };
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      zones: [...currentWorkspace.zones, zone],
    })));
    setZoneDraft((current) => ({ ...current, name: "" }));
    setSelection([{ type: "zone", id: zone.id }]); selectionAnchorRef.current = { type: "zone", id: zone.id };
    setRightTab("inspector");
    setMessage(`Zone « ${name} » ajoutée à l’espace ${modeLabel(activeMode)}.`);
  };

  const toggleRamanAveragePattern = (id, checked) => {
    setRamanAverageSelection((current) => checked
      ? (current.includes(id) ? current : [...current, id])
      : current.filter((value) => value !== id));
  };

  const createRamanAverage = () => {
    const selected = patterns.filter((pattern) => ramanAverageSelection.includes(pattern.id) && !pattern.isAverage);
    if (selected.length < 2) {
      setMessage("Sélectionner au moins deux acquisitions.");
      return;
    }
    try {
      const averaged = averagePatterns(selected, {
        label: ramanAverageLabel || `Moyenne ${modeLabel(activeMode)} · ${selected.length} acquisitions`,
        method: S.ramanAverageMethod,
        normalizeMode: S.ramanAverageNormalize,
      });
      history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
        ...currentWorkspace,
        patterns: [
          ...currentWorkspace.patterns.map((pattern) => (
            S.ramanAverageHideSources && ramanAverageSelection.includes(pattern.id)
              ? { ...pattern, visible: false }
              : pattern
          )),
          averaged,
        ],
      })));
      setRamanAverageSelection([]);
      setRamanAverageLabel("");
      setSelection([{ type: "pattern", id: averaged.id }]); selectionAnchorRef.current = { type: "pattern", id: averaged.id };
      setRightTab("inspector");
      setMessage(`Patron moyen créé à partir de ${selected.length} acquisitions.`);
    } catch (error) {
      setMessage(error.message || "Impossible de calculer la moyenne.");
    }
  };

  const setMode = (mode) => {
    const resolvedMode = resolveMode(mode);
    if (resolvedMode === activeMode) return;
    history.set((current) => ({ ...current, activeMode: resolvedMode }), { replace: true });
    setSelection([]); selectionAnchorRef.current = null;
    setTextTarget(null);
    setCursor(null);
    if (!MODES_WITH_ZONES.includes(resolvedMode) && leftTab === "zones") setLeftTab("patterns");
    setMessage(`Espace ${modeLabel(resolvedMode)} actif. Les données des autres espaces restent conservées.`);
  };

  const removeItems = useCallback((items) => {
    if (!items?.length) return;
    const ids = { pattern: new Set(), phase: new Set(), note: new Set(), zone: new Set() };
    items.forEach((item) => ids[item.type]?.add(item.id));
    const lockedCount = patterns.filter((item) => ids.pattern.has(item.id) && item.locked).length;
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.filter((item) => !ids.pattern.has(item.id) || item.locked),
      phases: currentWorkspace.phases.filter((item) => !ids.phase.has(item.id)),
      notes: currentWorkspace.notes.filter((item) => !ids.note.has(item.id)),
      zones: currentWorkspace.zones.filter((item) => !ids.zone.has(item.id)),
    })));
    clearSelection();
    if (lockedCount) setMessage(`${lockedCount} patron(s) verrouillé(s) conservé(s).`);
  }, [activeMode, clearSelection, history, patterns]);

  const removeSelection = useCallback(() => removeItems(selection), [removeItems, selection]);

  const setSelectedVisibility = useCallback((visible) => {
    if (!selection.length) return;
    const ids = { pattern: selectedByType.pattern, phase: selectedByType.phase, note: selectedByType.note, zone: selectedByType.zone };
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((item) => ids.pattern.has(item.id) && !item.locked ? { ...item, visible } : item),
      phases: currentWorkspace.phases.map((item) => ids.phase.has(item.id) ? { ...item, visible } : item),
      notes: currentWorkspace.notes.map((item) => ids.note.has(item.id) ? { ...item, visible } : item),
      zones: currentWorkspace.zones.map((item) => ids.zone.has(item.id) ? { ...item, visible } : item),
    })));
  }, [activeMode, history, selectedByType, selection.length]);

  const duplicateSelection = useCallback(() => {
    if (!selection.length) return;
    const cloneItem = (item, type, nameKey) => {
      const id = newId(type);
      return {
        ...item,
        id,
        [nameKey]: `${item[nameKey] || type} — copie`,
        x: Array.isArray(item.x) ? item.x.slice() : item.x,
        y: Array.isArray(item.y) ? item.y.slice() : item.y,
        stdY: Array.isArray(item.stdY) ? item.stdY.slice() : item.stdY,
        peaks: Array.isArray(item.peaks) ? item.peaks.map((peak) => [...peak]) : item.peaks,
        files: Array.isArray(item.files) ? item.files.slice() : item.files,
      };
    };
    const patternClones = patterns.filter((item) => selectedByType.pattern.has(item.id)).map((item) => ({ ...cloneItem(item, "pattern", "label"), locked: false }));
    const phaseClones = phases.filter((item) => selectedByType.phase.has(item.id)).map((item) => cloneItem(item, "phase", "name"));
    const noteClones = notes.filter((item) => selectedByType.note.has(item.id)).map((item) => cloneItem(item, "note", "text"));
    const zoneClones = zones.filter((item) => selectedByType.zone.has(item.id)).map((item) => cloneItem(item, "zone", "name"));
    const clonedSelection = [
      ...patternClones.map((item) => ({ type: "pattern", id: item.id })),
      ...phaseClones.map((item) => ({ type: "phase", id: item.id })),
      ...zoneClones.map((item) => ({ type: "zone", id: item.id })),
      ...noteClones.map((item) => ({ type: "note", id: item.id })),
    ];
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: [...currentWorkspace.patterns, ...patternClones],
      phases: [...currentWorkspace.phases, ...phaseClones],
      notes: [...currentWorkspace.notes, ...noteClones],
      zones: [...currentWorkspace.zones, ...zoneClones],
    })));
    if (clonedSelection.length) {
      setSelection(clonedSelection);
      selectionAnchorRef.current = clonedSelection[clonedSelection.length - 1];
      setRightTab("inspector");
      setMessage(`${clonedSelection.length} élément(s) dupliqué(s).`);
    }
  }, [activeMode, history, notes, patterns, phases, selectedByType, selection.length, zones]);

  const moveSelectionToWorkspace = useCallback((targetMode) => {
    const destination = resolveMode(targetMode);
    if (destination === activeMode) return;
    const movable = selection.filter((item) => item.type === "pattern" || item.type === "phase");
    if (!movable.length) return;
    history.set((current) => {
      const source = current.workspaces?.[activeMode] || createWorkspace(activeMode);
      const target = current.workspaces?.[destination] || createWorkspace(destination);
      const patternIds = new Set(movable.filter((item) => item.type === "pattern").map((item) => item.id));
      const phaseIds = new Set(movable.filter((item) => item.type === "phase").map((item) => item.id));
      const movedPatterns = source.patterns.filter((item) => patternIds.has(item.id) && !item.locked);
      movedPatterns.forEach((item) => patternIds.add(item.id));
      source.patterns.filter((item) => item.locked).forEach((item) => patternIds.delete(item.id));
      const movedPhases = source.phases.filter((item) => phaseIds.has(item.id));
      return {
        ...current,
        workspaces: {
          ...current.workspaces,
          [activeMode]: {
            ...source,
            patterns: source.patterns.filter((item) => !patternIds.has(item.id)),
            phases: source.phases.filter((item) => !phaseIds.has(item.id)),
          },
          [destination]: {
            ...target,
            patterns: [...target.patterns, ...movedPatterns],
            phases: [...target.phases, ...movedPhases],
          },
        },
      };
    });
    clearSelection();
    setMessage(`${movable.length} élément(s) déplacé(s) vers ${destination.toUpperCase()}.`);
  }, [activeMode, clearSelection, history, selection]);

  const resetSelectedPatternTransforms = useCallback(() => {
    if (!selectedByType.pattern.size) return;
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((item) => selectedByType.pattern.has(item.id) && !item.locked ? { ...item, yscale: 1, xoffset: 0, alignmentShift: 0 } : item),
    })));
  }, [activeMode, history, selectedByType.pattern]);

  const setSelectedLock = useCallback((locked) => {
    if (!selectedByType.pattern.size) return;
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((item) => selectedByType.pattern.has(item.id) ? { ...item, locked } : item),
    })));
    setMessage(`${selectedByType.pattern.size} patron(s) ${locked ? "verrouillé(s)" : "déverrouillé(s)"}.`);
  }, [activeMode, history, selectedByType.pattern]);

  const applyBatchRename = useCallback(() => {
    if (!selectedByType.pattern.size) return;
    let regex = null;
    if (batchRename.mode === "regex") {
      try { regex = new RegExp(batchRename.find, "g"); }
      catch { setMessage("Expression régulière invalide."); return; }
    }
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((item) => {
        if (!selectedByType.pattern.has(item.id) || item.locked) return item;
        let label = String(item.label || "");
        if (batchRename.mode === "prefix") label = `${batchRename.value}${label}`;
        else if (batchRename.mode === "suffix") label = `${label}${batchRename.value}`;
        else label = label.replace(regex, batchRename.replace);
        return { ...item, label };
      }),
    })));
    setMessage(`Renommage appliqué à ${selectedByType.pattern.size} patron(s) non verrouillé(s).`);
  }, [activeMode, batchRename, history, selectedByType.pattern]);

  const applyBatchGroup = useCallback(() => {
    if (!selectedByType.pattern.size) return;
    const name = batchGroup.name.trim() || batchGroup.value.trim();
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((item) => selectedByType.pattern.has(item.id) && !item.locked ? {
        ...item,
        groupType: batchGroup.type,
        groupName: name,
        groupValue: batchGroup.value.trim(),
      } : item),
    })));
    setMessage(`Groupe « ${name || batchGroup.type} » appliqué.`);
  }, [activeMode, batchGroup, history, selectedByType.pattern]);

  const extractSelectedOrder = useCallback(() => {
    if (!selectedByType.pattern.size) return;
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((item) => selectedByType.pattern.has(item.id) && !item.locked
        ? { ...item, orderValue: extractOrderValue(item.fileName || item.label) }
        : item),
    })));
    setMessage("Valeurs d’ordre extraites depuis les noms de fichiers.");
  }, [activeMode, history, selectedByType.pattern]);

  const sortPatterns = useCallback(() => {
    if (patternSort.key === "manual") return;
    const direction = patternSort.direction === "desc" ? -1 : 1;
    const valueOf = (item) => {
      if (patternSort.key === "filename") return String(item.fileName || item.label || "").toLocaleLowerCase("fr");
      if (patternSort.key === "date") return Number(item.fileMetadata?.lastModified || item.importedAt || 0);
      if (patternSort.key === "numeric") return Number.isFinite(Number(item.orderValue)) ? Number(item.orderValue) : Number.POSITIVE_INFINITY;
      if (patternSort.key === "group") return String(item.groupName || "").toLocaleLowerCase("fr");
      return String(item.label || "").toLocaleLowerCase("fr");
    };
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: (() => {
        const unlocked = currentWorkspace.patterns
          .filter((item) => !item.locked)
          .map((item, index) => ({ item, index }))
          .sort((a, b) => {
            const av = valueOf(a.item); const bv = valueOf(b.item);
            if (typeof av === "number" && typeof bv === "number") return ((av - bv) || (a.index - b.index)) * direction;
            return (String(av).localeCompare(String(bv), "fr", { numeric: true }) || (a.index - b.index)) * direction;
          })
          .map(({ item }) => item);
        let cursorIndex = 0;
        return currentWorkspace.patterns.map((item) => item.locked ? item : unlocked[cursorIndex++]);
      })(),
    })));
    setMessage("Patrons triés.");
  }, [activeMode, history, patternSort]);

  const saveSessionFile = useCallback(() => {
    const payload = JSON.stringify({ ...project, version: 17 }, null, 2);
    const safeName = String(project.name || S.fileName || "make_figure_project").replace(/[\/:*?"<>|]/g, "_");
    downloadBlob(payload, "application/json", `${safeName}_session.json`);
    setMessage("Session JSON exportée.");
  }, [project, S.fileName]);

  const loadSessionFile = async (files) => {
    if (!files.length) return;
    try {
      const parsed = validateProject(JSON.parse(await files[0].text()));
      const imported = duplicateProject(parsed, parsed.name || "Projet importé");
      history.replace(imported);
      clearSelection();
      setZoom(1);
      await saveStoredProject(imported);
      await refreshProjectIndex();
      writeLocalSetting("make-figure-active-project", imported.id);
      setMessage(`Projet « ${imported.name} » importé dans la bibliothèque locale.`);
    } catch (error) {
      setMessage(`Session invalide : ${error.message}`);
    }
  };

  const createNewProject = async () => {
    const defaultName = `${tr("Projet")} ${projectIndex.length + 1}`;
    const name = window.prompt("Nom du nouveau projet", defaultName);
    if (name === null) return;
    const next = createEmptyProject(activeMode, { name: name.trim() || defaultName });
    history.replace(next);
    clearSelection();
    setZoom(1);
    setLeftTab("patterns");
    setComposerTab("appearance");
    setRightTab("compose");
    await saveStoredProject(next);
    await refreshProjectIndex();
    writeLocalSetting("make-figure-active-project", next.id);
    setProjectMenuOpen(false);
    setMessage(`Projet « ${next.name} » créé.`);
  };

  const switchProject = async (id) => {
    if (!id || id === project.id) { setProjectMenuOpen(false); return; }
    try {
      await saveStoredProject(project);
      const next = await loadStoredProject(id);
      if (!next) throw new Error("Projet introuvable");
      history.replace(next);
      clearSelection();
      setZoom(1);
      setCursor(null);
      writeLocalSetting("make-figure-active-project", next.id);
      setProjectMenuOpen(false);
      setMessage(`Projet « ${next.name} » ouvert.`);
    } catch (error) {
      setMessage(`Ouverture impossible : ${error.message}`);
    }
  };

  const renameCurrentProject = async () => {
    const name = window.prompt("Nouveau nom du projet", project.name || "Projet sans titre");
    if (name === null || !name.trim()) return;
    history.set((current) => ({ ...current, name: name.trim(), updatedAt: Date.now() }), { replace: true });
    setProjectMenuOpen(false);
    setMessage(`Projet renommé « ${name.trim()} ».`);
  };

  const duplicateCurrentProject = async () => {
    const copy = duplicateProject(project);
    history.replace(copy);
    clearSelection();
    await saveStoredProject(copy);
    await refreshProjectIndex();
    writeLocalSetting("make-figure-active-project", copy.id);
    setProjectMenuOpen(false);
    setMessage(`Copie créée : « ${copy.name} ».`);
  };

  const deleteCurrentProject = async () => {
    if (!window.confirm(`Supprimer définitivement le projet local « ${project.name} » ?`)) return;
    await deleteStoredProject(project.id);
    const remaining = await refreshProjectIndex();
    const loaded = remaining.length ? await loadStoredProject(remaining[0].id) : null;
    const next = loaded || createEmptyProject("drx", { name: "Nouveau projet" });
    if (!loaded) await saveStoredProject(next);
    history.replace(next);
    clearSelection();
    setZoom(1);
    writeLocalSetting("make-figure-active-project", next.id);
    setProjectMenuOpen(false);
    setMessage("Projet supprimé de la bibliothèque locale.");
  };

  const resetLayout = useCallback(() => {
    setLeftWidth(310);
    setRightWidth(350);
    setLeftCollapsed(false);
    setRightCollapsed(false);
    setUiDensity("standard");
    setMessage("Disposition de l’interface réinitialisée.");
  }, []);

  const reorder = (type, draggedId, targetId) => {
    if (!draggedId || draggedId === targetId) return;
    const key = type === "pattern" ? "patterns" : "phases";
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => {
      const list = currentWorkspace[key].slice();
      const from = list.findIndex((item) => item.id === draggedId);
      const to = list.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return currentWorkspace;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      return { ...currentWorkspace, [key]: list };
    }));
  };

  const handleDataDragStart = (event, type, id) => {
    draggedRef.current = { type, id };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };

  const handleDataDrop = (event, type, targetId) => {
    event.preventDefault();
    const dragged = draggedRef.current;
    if (dragged?.type === type) reorder(type, dragged.id, targetId);
    draggedRef.current = null;
  };

  const handleFileDrop = async (event) => {
    event.preventDefault();
    setDropActive(false);
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    const phaseFiles = [];
    const patternFiles = [];
    for (const file of files) {
      if (/\.(dif|cif)$/i.test(file.name)) {
        phaseFiles.push(file);
        continue;
      }
      if (/\.(txt|csv|dat)$/i.test(file.name)) {
        try {
          const prefix = (await file.text()).slice(0, 6000);
          if (/##RRUFFID=|##FILETYPE=Raman/i.test(prefix)) {
            phaseFiles.push(file);
            continue;
          }
        } catch { /* imported as an experimental pattern below */ }
      }
      patternFiles.push(file);
    }
    if (patternFiles.length) await importPatterns(patternFiles);
    if (phaseFiles.length) await importPhases(phaseFiles);
  };

  const selectedVisibleIndex = processed.findIndex((pattern) => pattern.id === activePattern?.id);

  const applyPreset = (presetKey) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      settings: { ...currentWorkspace.settings, ...preset },
    })));
    setMessage(`Preset « ${preset.label} » appliqué.`);
  };

  const exportProcessedCsv = () => {
    if (!processed.length) {
      setMessage("Aucun patron visible à exporter.");
      return;
    }
    downloadBlob(`\ufeff${processedPatternsToCsv(processed)}`, "text/csv;charset=utf-8", `${S.fileName || "figure"}_processed.csv`);
    setMessage("Données traitées exportées en CSV.");
  };

  const exportDetectedPeaksCsv = () => {
    const peakCount = processed.reduce((sum, pattern) => sum + (pattern.detectedPeaks?.length || 0), 0);
    if (!peakCount) {
      setMessage("Aucun pic détecté avec les seuils actuels.");
      return;
    }
    downloadBlob(`\ufeff${detectedPeaksToCsv(processed)}`, "text/csv;charset=utf-8", `${S.fileName || "figure"}_peaks.csv`);
    setMessage(`${peakCount} pic(s) exporté(s) en CSV.`);
  };

  const exportZonesCsv = () => {
    if (!zones.length) {
      setMessage("Aucune zone à exporter.");
      return;
    }
    const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = ["name,xmin_cm-1,xmax_cm-1,color,opacity,visible"];
    zones.forEach((zone) => rows.push([
      escape(zone.name),
      Number(zone.xmin),
      Number(zone.xmax),
      escape(zone.color),
      Number(zone.opacity ?? 0.12),
      zone.visible !== false,
    ].join(",")));
    downloadBlob(`\ufeff${rows.join("\n")}`, "text/csv;charset=utf-8", `${S.fileName || "figure"}_${activeMode}_zones.csv`);
    setMessage(`${zones.length} zone(s) exportée(s) en CSV.`);
  };

  const previewVisiblePatternAlignment = () => {
    const visible = patterns.filter((pattern) => pattern.visible);
    if (visible.length < 2) {
      setMessage("L’alignement de série nécessite au moins deux patrons visibles.");
      return;
    }
    const referenceId = S.alignmentReferenceId || activePattern?.id || visible[0].id;
    const reference = visible.find((pattern) => pattern.id === referenceId) || visible[0];
    const hasRequestedMin = S.alignmentXMin !== null && S.alignmentXMin !== "" && Number.isFinite(Number(S.alignmentXMin));
    const hasRequestedMax = S.alignmentXMax !== null && S.alignmentXMax !== "" && Number.isFinite(Number(S.alignmentXMax));
    const rangeMin = hasRequestedMin ? Number(S.alignmentXMin) : S.xmin;
    const rangeMax = hasRequestedMax && Number(S.alignmentXMax) > rangeMin ? Number(S.alignmentXMax) : S.xmax;
    const alignmentSettings = { ...S, xmin: rangeMin, xmax: rangeMax };
    const results = visible.map((pattern) => {
      if (pattern.id === reference.id) return { id: pattern.id, label: pattern.label, shift: 0, score: 1, reference: true, locked: Boolean(pattern.locked) };
      const result = estimateCorrelationShift(reference, pattern, alignmentSettings);
      return { id: pattern.id, label: pattern.label, shift: Number(result.shift) || 0, score: result.score, reference: false, locked: Boolean(pattern.locked) };
    });
    setAlignmentPreview({ referenceId: reference.id, referenceLabel: reference.label, xmin: rangeMin, xmax: rangeMax, results });
    setMessage(`Prévisualisation calculée sur ${rangeMin.toFixed(activeMode === "drx" ? 3 : 1)}–${rangeMax.toFixed(activeMode === "drx" ? 3 : 1)} pour ${results.length - 1} patron(s).`);
  };

  const applyAlignmentPreview = () => {
    if (!alignmentPreview?.results?.length) {
      setMessage("Calculer d’abord une prévisualisation d’alignement.");
      return;
    }
    const byId = new Map(alignmentPreview.results.map((result) => [result.id, result]));
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((pattern) => {
        const result = byId.get(pattern.id);
        if (!result || result.reference || result.locked) return pattern;
        return {
          ...pattern,
          xoffset: (Number(pattern.xoffset) || 0) + result.shift,
          alignmentScore: result.score,
          alignmentShift: (Number(pattern.alignmentShift) || 0) + result.shift,
          alignmentReference: alignmentPreview.referenceId,
        };
      }),
      settings: { ...currentWorkspace.settings, alignmentReferenceId: alignmentPreview.referenceId },
    })));
    const applied = alignmentPreview.results.filter((result) => !result.reference && !result.locked).length;
    setAlignmentPreview(null);
    setMessage(`Alignement de série appliqué à ${applied} patron(s).`);
  };

  const removeAutomaticAlignment = () => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((pattern) => pattern.locked ? pattern : ({ ...pattern, xoffset: (Number(pattern.xoffset) || 0) - (Number(pattern.alignmentShift) || 0), alignmentShift: 0, alignmentScore: undefined, alignmentReference: undefined })),
    })));
    setAlignmentPreview(null);
    setMessage("Alignements automatiques retirés ; les décalages manuels sont conservés.");
  };

  const insetEnabled = S.figureLayoutMode === "single" && S.showInset;
  const insetPlacementMode = S.insetPlacementMode || "overlay";
  const insetDockRight = insetEnabled && insetPlacementMode === "dock-right";
  const insetDockTop = insetEnabled && insetPlacementMode === "dock-top";
  const insetDockRightWidth = insetDockRight ? Math.max(190, S.figWidth * clamp(Number(S.insetWidthPct) || 34, 15, 70) / 100 + 22) : 0;
  const insetDockTopHeight = insetDockTop ? Math.max(145, Math.min(420, S.figWidth * 0.32 * clamp(Number(S.insetHeightPct) || 34, 15, 70) / 100 + 26)) : 0;
  const M = { left: S.figureLayoutMode === "single" ? (S.showYAxisTicks ? 82 : 62) : 22, right: S.figureLayoutMode === "single" ? S.rightMargin : 22, top: (S.title ? 48 : 22) + insetDockTopHeight, gap: 10, axisHeight: S.figureLayoutMode === "single" ? 50 : 10 };
  const curveMinimum = processed.length
    ? Math.min(...processed.map((pattern) => pattern.stackOffset + pattern.displayMinimum))
    : 0;
  const curveMaximum = processed.length
    ? Math.max(...processed.map((pattern) => pattern.stackOffset + pattern.displayMaximum))
    : 1;
  const curvePadding = Math.max(0.12, (curveMaximum - curveMinimum) * 0.06);
  const annotationBase = curveMaximum + S.annotGap;
  const hasAnnotations = S.figureLayoutMode === "single" && S.showAnnotations && phases.some((phase) => phase.visible && phase.inAnnot);
  const automaticYMinimum = Math.min(-0.15, curveMinimum - curvePadding);
  const automaticYMaximum = hasAnnotations
    ? annotationBase + S.tickScale + 0.65
    : Math.max(curveMaximum + curvePadding, automaticYMinimum + 1.2);
  const yMinimum = Number.isFinite(S.viewYMin) ? S.viewYMin : automaticYMinimum;
  const yMaximum = Number.isFinite(S.viewYMax) && S.viewYMax > yMinimum ? S.viewYMax : automaticYMaximum;
  const mainHeight = Math.max(270, (yMaximum - yMinimum) * S.pxPerUnit);
  const panelPhases = phases.filter((phase) => phase.visible && phase.inPanel);
  const panelHeight = S.figureLayoutMode === "single" && S.showPdfPanel && panelPhases.length ? S.pdfPanelH : 0;
  const W = S.figWidth + insetDockRightWidth;
  const H = M.top + mainHeight + (panelHeight ? M.gap + panelHeight : 0) + M.axisHeight;
  const displayZoom = comparisonView
    ? clamp(Math.min(zoom, (workspaceSize.width - 110) / Math.max(1, W * 2), (workspaceSize.height - 90) / Math.max(1, H)), 0.2, 3)
    : zoom;
  const plotWidth = Math.max(120, S.figWidth - M.left - M.right);
  const panelTop = M.top + mainHeight + M.gap;
  const rowHeight = panelPhases.length ? panelHeight / panelPhases.length : 0;

  const drxAxisMode = activeMode === "drx" ? (S.xAxisMode || "2theta") : "native";
  const wavelength = Number(S.wavelength) || 1.5406;
  const figureFont = S.fontFamily || "Arial, Helvetica, sans-serif";
  const axisCoordinate = useCallback((x) => drxAxisMode === "native" ? Number(x) : convertDrxX(x, drxAxisMode, wavelength), [drxAxisMode, wavelength]);
  const primaryAxisWindow = useMemo(() => activeMode === "drx"
    ? drxAxisWindowFromTwoTheta(viewXMin, viewXMax, drxAxisMode, wavelength)
    : { minimum: viewXMin, maximum: viewXMax }, [activeMode, drxAxisMode, viewXMax, viewXMin, wavelength]);
  const primaryAxisUnit = activeMode === "drx"
    ? (drxAxisMode === "d" ? "Å" : drxAxisMode === "q" ? "Å⁻¹" : "°")
    : "cm⁻¹";
  const primaryAxisStep = activeMode === "drx" && ["d", "q"].includes(drxAxisMode) ? 0.01 : (activeMode === "drx" ? 0.1 : 1);
  const commitPrimaryAxisBound = useCallback((bound, value) => {
    const nextMinimum = bound === "minimum" ? Number(value) : primaryAxisWindow.minimum;
    const nextMaximum = bound === "maximum" ? Number(value) : primaryAxisWindow.maximum;
    if (!(Number.isFinite(nextMinimum) && Number.isFinite(nextMaximum) && nextMaximum > nextMinimum)) {
      setMessage("La valeur minimale doit rester inférieure à la valeur maximale.");
      return false;
    }
    const nativeWindow = activeMode === "drx"
      ? drxAxisWindowToTwoTheta(nextMinimum, nextMaximum, drxAxisMode, wavelength)
      : { xmin: nextMinimum, xmax: nextMaximum };
    if (!nativeWindow || !(nativeWindow.xmax > nativeWindow.xmin)) {
      setMessage("Cette plage n’est pas compatible avec l’unité sélectionnée.");
      return false;
    }
    patchSettingsValues({ xmin: nativeWindow.xmin, xmax: nativeWindow.xmax, viewYMin: null, viewYMax: null });
    return true;
  }, [activeMode, drxAxisMode, patchSettingsValues, primaryAxisWindow.maximum, primaryAxisWindow.minimum, wavelength]);
  const insetAxisWindow = useMemo(() => activeMode === "drx"
    ? drxAxisWindowFromTwoTheta(Number(S.insetXMin), Number(S.insetXMax), drxAxisMode, wavelength)
    : { minimum: Number(S.insetXMin), maximum: Number(S.insetXMax) }, [S.insetXMax, S.insetXMin, activeMode, drxAxisMode, wavelength]);
  const commitInsetAxisBound = useCallback((bound, value) => {
    const nextMinimum = bound === "minimum" ? Number(value) : insetAxisWindow.minimum;
    const nextMaximum = bound === "maximum" ? Number(value) : insetAxisWindow.maximum;
    if (!(Number.isFinite(nextMinimum) && Number.isFinite(nextMaximum) && nextMaximum > nextMinimum)) {
      setMessage("La plage de l’encart est invalide.");
      return false;
    }
    const nativeWindow = activeMode === "drx"
      ? drxAxisWindowToTwoTheta(nextMinimum, nextMaximum, drxAxisMode, wavelength)
      : { xmin: nextMinimum, xmax: nextMaximum };
    if (!nativeWindow || !(nativeWindow.xmax > nativeWindow.xmin)) return false;
    patchSettingsValues({ insetXMin: nativeWindow.xmin, insetXMax: nativeWindow.xmax });
    return true;
  }, [activeMode, drxAxisMode, insetAxisWindow.maximum, insetAxisWindow.minimum, patchSettingsValues, wavelength]);
  // La coupure vaut pour les trois espaces ; en DRX elle suppose l'axe 2θ,
  // les axes d et Q n'étant pas linéaires en 2θ.
  const breakActive = (activeMode !== "drx" || drxAxisMode === "2theta") && S.brokenAxisEnabled && Number(S.brokenAxisEnd) > Number(S.brokenAxisStart) && Number(S.brokenAxisStart) > viewXMin && Number(S.brokenAxisEnd) < viewXMax;
  // Axe X décroissant : miroir horizontal autour du centre de la zone tracée.
  // Appliqué en dernier, il vaut pour la courbe, les graduations, le curseur,
  // les annotations et l’export.
  const mirrorPx = useCallback(
    (px) => (S.reverseXAxis ? 2 * M.left + plotWidth - px : px),
    [M.left, S.reverseXAxis, plotWidth],
  );
  const xToPx = useCallback((x) => {
    if (breakActive) {
      const start = Number(S.brokenAxisStart); const end = Number(S.brokenAxisEnd); const gap = Math.max(8, Number(S.brokenAxisGapPx) || 18);
      const leftSpan = start - viewXMin; const rightSpan = viewXMax - end; const usable = Math.max(1, plotWidth - gap); const total = Math.max(1e-12, leftSpan + rightSpan);
      const leftWidth = usable * leftSpan / total;
      if (x <= start) return mirrorPx(M.left + ((x - viewXMin) / Math.max(1e-12, leftSpan)) * leftWidth);
      if (x >= end) return mirrorPx(M.left + leftWidth + gap + ((x - end) / Math.max(1e-12, rightSpan)) * (usable - leftWidth));
      return mirrorPx(M.left + leftWidth + gap / 2);
    }
    const current = axisCoordinate(x);
    return mirrorPx(M.left + ((current - primaryAxisWindow.minimum) / Math.max(1e-12, primaryAxisWindow.maximum - primaryAxisWindow.minimum)) * plotWidth);
  }, [M.left, S.brokenAxisEnd, S.brokenAxisGapPx, S.brokenAxisStart, axisCoordinate, breakActive, mirrorPx, plotWidth, primaryAxisWindow.maximum, primaryAxisWindow.minimum, viewXMax, viewXMin]);
  const pxToDataX = useCallback((px) => {
    const bounded = mirrorPx(clamp(Number(px), M.left, M.left + plotWidth));
    if (breakActive) {
      const start = Number(S.brokenAxisStart);
      const end = Number(S.brokenAxisEnd);
      const gap = Math.max(8, Number(S.brokenAxisGapPx) || 18);
      const leftSpan = start - viewXMin;
      const rightSpan = viewXMax - end;
      const usable = Math.max(1, plotWidth - gap);
      const total = Math.max(1e-12, leftSpan + rightSpan);
      const leftWidth = usable * leftSpan / total;
      const local = bounded - M.left;
      if (local <= leftWidth) return viewXMin + (local / Math.max(1e-12, leftWidth)) * leftSpan;
      if (local >= leftWidth + gap) return end + ((local - leftWidth - gap) / Math.max(1e-12, usable - leftWidth)) * rightSpan;
      return local < leftWidth + gap / 2 ? start : end;
    }
    const fraction = (bounded - M.left) / Math.max(1e-12, plotWidth);
    const coordinate = primaryAxisWindow.minimum + fraction * (primaryAxisWindow.maximum - primaryAxisWindow.minimum);
    if (activeMode !== "drx" || drxAxisMode === "native" || drxAxisMode === "2theta") return coordinate;
    return invertDrxX(coordinate, drxAxisMode, wavelength);
  }, [M.left, S.brokenAxisEnd, S.brokenAxisGapPx, S.brokenAxisStart, activeMode, breakActive, drxAxisMode, mirrorPx, plotWidth, primaryAxisWindow.maximum, primaryAxisWindow.minimum, viewXMax, viewXMin, wavelength]);
  const yToPx = useCallback((y) => M.top + mainHeight - ((y - yMinimum) / (yMaximum - yMinimum)) * mainHeight, [M.top, mainHeight, yMinimum, yMaximum]);

  /**
   * Ordonnée en pixels du sommet des courbes au voisinage d'une abscisse :
   * maximum du signal affiché (empilement compris) dans une fenêtre centrée
   * sur x. Renvoie null si aucune courbe visible ne couvre cette abscisse.
   * Sert à poser les valeurs des pics de référence au-dessus du pic mesuré
   * plutôt qu'au-dessus du bâtonnet.
   */
  const curveTopPxNear = useCallback((x, halfWindow, invert = false) => {
    let best = null;
    for (const pattern of processed) {
      const sourceX = pattern.sourceX;
      const values = pattern.displayY;
      if (!sourceX?.length || !values?.length) continue;
      if (x < sourceX[0] - halfWindow || x > sourceX[sourceX.length - 1] + halfWindow) continue;
      const offset = pattern.stackOffset || 0;
      // Recherche dichotomique de la fenêtre, les abscisses étant croissantes.
      let low = 0;
      let high = sourceX.length - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (sourceX[middle] < x - halfWindow) low = middle + 1; else high = middle;
      }
      // En transmittance la bande est un minimum : on cherche l'extremum du
      // bon côté, et l'on retient le point le plus bas plutôt que le plus haut.
      let extremum = null;
      for (let index = low; index < sourceX.length && sourceX[index] <= x + halfWindow; index += 1) {
        const value = values[index];
        if (!Number.isFinite(value)) continue;
        if (extremum === null || (invert ? value < extremum : value > extremum)) extremum = value;
      }
      if (extremum === null) continue;
      const py = yToPx(extremum + offset);
      if (best === null || (invert ? py > best : py < best)) best = py;
    }
    return best;
  }, [processed, yToPx]);
  const xTickObjects = useMemo(() => {
    if (activeMode !== "drx" || drxAxisMode === "2theta") return computeTicks(viewXMin, viewXMax, S.xTickStep).filter((tick) => !breakActive || tick <= Number(S.brokenAxisStart) || tick >= Number(S.brokenAxisEnd)).map((tick) => ({ x: tick, axisValue: tick, label: String(tick) }));
    return computeTicks(primaryAxisWindow.minimum, primaryAxisWindow.maximum, S.xTickStep)
      .map((value) => ({ x: invertDrxX(value, drxAxisMode, wavelength), axisValue: value, label: value.toFixed(2) }))
      .filter((tick) => Number.isFinite(tick.x) && tick.x >= viewXMin && tick.x <= viewXMax)
      .sort((left, right) => left.axisValue - right.axisValue);
  }, [S.brokenAxisEnd, S.brokenAxisStart, S.xTickStep, activeMode, breakActive, drxAxisMode, primaryAxisWindow.maximum, primaryAxisWindow.minimum, viewXMax, viewXMin, wavelength]);
  const buildCurvePath = useCallback((xs, ys, offset = 0) => {
    let path = ""; let drawing = false;
    for (let index = 0; index < xs.length; index += 1) {
      const x = xs[index];
      if (breakActive && x > Number(S.brokenAxisStart) && x < Number(S.brokenAxisEnd)) { drawing = false; continue; }
      path += `${drawing ? "L" : "M"}${xToPx(x).toFixed(2)},${yToPx(ys[index] + offset).toFixed(2)}`;
      drawing = true;
    }
    return path;
  }, [S.brokenAxisEnd, S.brokenAxisStart, breakActive, xToPx, yToPx]);
  const labelYForPattern = useCallback((pattern) => (
    S.layoutMode === "overlay" && visibleCount > 1
      ? curveMaximum - (pattern.stackIndex / (visibleCount - 1)) * Math.max(curveMaximum - curveMinimum, 0.8)
      : pattern.stackOffset + (pattern.displayMinimum + pattern.displayMaximum) * 0.5
  ), [S.layoutMode, curveMaximum, curveMinimum, visibleCount]);

  const activeProcessedPattern = useMemo(
    () => processed.find((pattern) => pattern.id === activePattern?.id) || processed[0] || null,
    [activePattern?.id, processed],
  );

  const applyRadiationPreset = useCallback((presetKey) => {
    const preset = RADIATION_PRESETS[presetKey] || RADIATION_PRESETS.custom;
    history.set((current) => updateWorkspaceProject(current, "drx", (currentWorkspace) => ({
      ...currentWorkspace,
      settings: {
        ...currentWorkspace.settings,
        radiationPreset: presetKey,
        wavelength: preset.wavelength,
        ka2Wavelength: preset.ka2Wavelength,
        ka2Ratio: preset.ka2Ratio,
        xlabel: `2θ (°, ${preset.label}, λ = ${preset.wavelength} Å)`,
      },
      phases: currentWorkspace.phases.map((phase) => phase.cifData ? {
        ...phase,
        peaks: calculateCifPattern(phase.cifData, { wavelength: preset.wavelength, xmin: 3, xmax: 120, maxIndex: 12 }).map(([x, intensity]) => [x, intensity]),
      } : phase),
    })));
    setMessage(`Rayonnement ${preset.label} appliqué ; les phases CIF ont été recalculées.`);
  }, [history]);

  const recalculateCifPhases = useCallback(() => {
    let count = 0;
    history.set((current) => updateWorkspaceProject(current, "drx", (currentWorkspace) => ({
      ...currentWorkspace,
      phases: currentWorkspace.phases.map((phase) => {
        if (!phase.cifData) return phase;
        count += 1;
        return { ...phase, peaks: calculateCifPattern(phase.cifData, { wavelength: Number(currentWorkspace.settings.wavelength) || 1.5406, xmin: 3, xmax: 120, maxIndex: 12 }).map(([x, intensity]) => [x, intensity]) };
      }),
    })));
    setMessage(count ? `${count} phase(s) CIF recalculée(s).` : "Aucune phase CIF dans le projet.");
  }, [history]);

  const applyZeroShift = useCallback(() => {
    const phase = phases.find((item) => item.id === S.zeroShiftReferencePhaseId) || phases.find((item) => item.visible);
    const targets = selectedByType.pattern.size
      ? patterns.filter((item) => selectedByType.pattern.has(item.id) && !item.locked)
      : patterns.filter((item) => item.visible && !item.locked);
    if (!phase || !targets.length) {
      setMessage("Sélectionner une phase de référence et au moins un patron déverrouillé.");
      return;
    }
    const results = new Map(targets.map((pattern) => [pattern.id, estimateZeroShiftFromPhase(pattern, phase, S)]));
    const valid = [...results.entries()].filter(([, result]) => result.matches.length >= 2 && Number.isFinite(result.shift));
    if (!valid.length) {
      setMessage("Correction zéro impossible : moins de deux correspondances fiables par patron.");
      return;
    }
    history.set((current) => updateWorkspaceProject(current, "drx", (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((pattern) => {
        const result = results.get(pattern.id);
        if (!result || result.matches.length < 2 || pattern.locked) return pattern;
        return { ...pattern, xoffset: (Number(pattern.xoffset) || 0) + result.shift, zeroShiftApplied: (Number(pattern.zeroShiftApplied) || 0) + result.shift, zeroShiftMatches: result.matches.length, zeroShiftScore: result.score };
      }),
      settings: { ...currentWorkspace.settings, zeroShiftReferencePhaseId: phase.id },
    })));
    const mean = valid.reduce((sum, [, result]) => sum + result.shift, 0) / valid.length;
    setMessage(`Décalage zéro corrigé sur ${valid.length} patron(s) · correction moyenne ${mean >= 0 ? "+" : ""}${mean.toFixed(4)}°.`);
  }, [S, history, patterns, phases, selectedByType.pattern]);

  const removeZeroShift = useCallback(() => {
    history.set((current) => updateWorkspaceProject(current, "drx", (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((pattern) => pattern.locked ? pattern : ({ ...pattern, xoffset: (Number(pattern.xoffset) || 0) - (Number(pattern.zeroShiftApplied) || 0), zeroShiftApplied: 0, zeroShiftMatches: undefined, zeroShiftScore: undefined })),
    })));
    setMessage("Corrections automatiques de décalage zéro retirées.");
  }, [history]);

  /** Déconvolution multi-pics du patron sélectionné sur la fenêtre indiquée. */
  const runMultiFit = useCallback(() => {
    if (!activeProcessedPattern) {
      setMessage("Sélectionner d'abord un patron.");
      return;
    }
    const centers = parseManualPeaks(multiFitDraft.centers).map(([position]) => position);
    if (centers.length < 1) {
      setMessage("Indiquer au moins un centre initial (ex. « 950; 962; 1005 »).");
      return;
    }
    const spread = Math.max(...centers) - Math.min(...centers);
    const margin = Math.max(spread * 0.3, activeMode === "drx" ? 0.5 : 20);
    const xmin = Number.isFinite(Number(multiFitDraft.xmin)) && multiFitDraft.xmin !== "" ? Number(multiFitDraft.xmin) : Math.min(...centers) - margin;
    const xmax = Number.isFinite(Number(multiFitDraft.xmax)) && multiFitDraft.xmax !== "" ? Number(multiFitDraft.xmax) : Math.max(...centers) + margin;
    const result = fitMultiPeaks(activeProcessedPattern.sourceX, activeProcessedPattern.processedY, { xmin, xmax, centers, model: multiFitDraft.model });
    if (!result) {
      setMessage("Ajustement impossible : fenêtre trop étroite ou données insuffisantes.");
      return;
    }
    setMultiFitResult({ patternId: activeProcessedPattern.id, ...result });
    setMessage(`Ajustement de ${result.components.length} pic(s) : R² = ${result.r2.toFixed(4)}, η = ${result.eta}.`);
  }, [activeMode, activeProcessedPattern, multiFitDraft]);

  const exportMultiFitCsv = useCallback(() => {
    if (!multiFitResult) return;
    downloadBlob(`\ufeff${multiPeakFitToCsv(multiFitResult)}`, "text/csv;charset=utf-8", `${S.fileName || "figure"}_multifit.csv`);
    setMessage("Résultats de l'ajustement multi-pics exportés.");
  }, [S.fileName, multiFitResult]);

  // Aires des zones nommées pour chaque patron visible (Raman / IR).
  const zoneAreaRows = useMemo(() => supportsZones && zones.length && processed.length
    ? computeZoneAreas(processed, zones, zoneSignal)
    : [], [supportsZones, zones, processed, zoneSignal]);

  const exportZoneAreasCsv = useCallback(() => {
    if (!zoneAreaRows.length) return;
    const zoneA = zones.find((zone) => zone.id === zoneRatio.a);
    const zoneB = zones.find((zone) => zone.id === zoneRatio.b);
    const ratio = zoneA && zoneB ? { zoneA: zoneA.id, zoneB: zoneB.id, label: `${zoneA.name}/${zoneB.name}` } : null;
    downloadBlob(`\ufeff${zoneAreasToCsv(zoneAreaRows, zones, ratio)}`, "text/csv;charset=utf-8", `${S.fileName || "figure"}_aires_zones.csv`);
    setMessage("Aires des zones exportées.");
  }, [S.fileName, zoneAreaRows, zoneRatio.a, zoneRatio.b, zones]);

  const runPeakFit = useCallback(() => {
    if (!activeProcessedPattern) {
      setMessage("Sélectionner un patron DRX visible.");
      return;
    }
    const result = fitDrxPeak(activeProcessedPattern, S, { center: S.peakFitCenter, window: S.peakFitWindow, model: S.peakFitModel });
    setPeakFitResult(result);
    setMessage(result ? `Pic ajusté à ${result.center.toFixed(4)}° · R² ${result.r2.toFixed(4)}.` : "Ajustement impossible : fenêtre insuffisante ou pic absent.");
  }, [S, activeProcessedPattern]);

  const fitDetectedPeak = useCallback((peak) => {
    if (!activeProcessedPattern || !peak) return;
    const center = Number(peak.x);
    const result = fitDrxPeak(activeProcessedPattern, S, { center, window: S.peakFitWindow, model: S.peakFitModel });
    patchSettings("peakFitCenter", center);
    setPeakFitResult(result);
    setMessage(result ? `Pic ajusté à ${result.center.toFixed(4)}° · R² ${result.r2.toFixed(4)}.` : "Ajustement impossible autour de ce maximum.");
  }, [S, activeProcessedPattern, patchSettings]);

  const addDetectedPeakToTracking = useCallback((peak, index) => {
    if (!peak) return;
    const label = `${activeProcessedPattern?.label || "Pic"}/pic ${index + 1}`;
    const entry = `${label}:${Number(peak.x).toFixed(activeMode === "drx" ? 4 : 1)}`;
    const current = String(S.trackingTargets || "").trim();
    patchSettings("trackingTargets", current ? `${current}; ${entry}` : entry);
    setMessage(`Pic à ${Number(peak.x).toFixed(activeMode === "drx" ? 4 : 1)} ajouté au suivi de série.`);
  }, [S.trackingTargets, activeMode, activeProcessedPattern, patchSettings]);

  const populateTrackingFromPhase = useCallback(() => {
    const phase = activePhase || phases.find((item) => item.visible);
    if (!phase?.peaks?.length) { setMessage("Sélectionner une phase contenant des pics."); return; }
    const strongest = [...phase.peaks].sort((a, b) => b[1] - a[1]).slice(0, 8).sort((a, b) => a[0] - b[0]);
    const text = strongest.map(([x], index) => `${phase.name}/pic ${index + 1}:${Number(x).toFixed(3)}`).join("; ");
    patchSettings("trackingTargets", text);
    setMessage(`${strongest.length} pics de « ${phase.name} » ajoutés au suivi de série.`);
  }, [activePhase, phases, patchSettings]);

  const exportTrackingCsv = useCallback(() => {
    const targets = parseTrackingTargets(S.trackingTargets);
    if (!targets.length || !processed.length) {
      setMessage("Définir au moins une position de suivi et charger des patrons visibles.");
      return;
    }
    const rows = trackDrxSeries(processed, targets, { window: S.trackingWindow, signal: S.trackingSignal });
    downloadBlob(`\ufeff${trackingRowsToCsv(rows)}`, "text/csv;charset=utf-8", `${S.fileName || "figure"}_series_tracking.csv`);
    setMessage(`${rows.length} mesure(s) de série exportée(s).`);
  }, [S, processed]);

  const saveSelectedPhasesToLibrary = useCallback(() => {
    const selected = selectedByType.phase.size ? phases.filter((phase) => selectedByType.phase.has(phase.id)) : phases.filter((phase) => phase.visible);
    if (!selected.length) { setMessage("Sélectionner au moins une phase."); return; }
    setPhaseLibrary((current) => {
      const map = new Map(current.map((phase) => [phase.libraryKey || `${phase.name}:${phase.metadata?.RRUFFID || phase.metadata?.CIF_FORMULA || "manual"}`, phase]));
      selected.forEach((phase) => {
        const libraryKey = `${phase.name}:${phase.metadata?.RRUFFID || phase.metadata?.CIF_FORMULA || phase.files?.[0] || "manual"}`;
        map.set(libraryKey, { ...phase, id: undefined, libraryKey, savedAt: Date.now() });
      });
      return [...map.values()];
    });
    setMessage(`${selected.length} phase(s) enregistrée(s) dans la bibliothèque locale.`);
  }, [phases, selectedByType.phase]);

  const addLibraryPhase = useCallback((entry, mode = activeMode) => {
    const targetMode = resolveMode(mode);
    const normalizedPeaks = Array.isArray(entry?.peaks)
      ? entry.peaks.map((peak) => [Number(peak?.[0]) || 0, Number(peak?.[1]) || 0]).filter((peak) => Number.isFinite(peak[0]) && Number.isFinite(peak[1]))
      : [];
    const phase = {
      ...entry,
      id: newId("phase"),
      name: String(entry?.name || "Phase sans nom"),
      abbrev: String(entry?.abbrev || entry?.name || "PH").slice(0, 3),
      color: entry?.color || PHASE_COLORS[(phases.length + 1) % PHASE_COLORS.length],
      peaks: normalizedPeaks,
      files: [...(entry?.files || []), "bibliothèque locale"],
      visible: entry?.visible !== false,
      inAnnot: entry?.inAnnot !== false,
      inPanel: entry?.inPanel !== false,
      sourceKind: entry?.sourceKind || "raman-database",
      metadata: entry?.metadata || {},
      subtitle: phaseSubtitle({ ...entry, subtitle: entry?.subtitle || defaultPhaseSubtitle(entry) }),
      showSubtitle: entry?.showSubtitle !== false,
      libraryKey: undefined,
      savedAt: undefined,
    };
    history.set((current) => updateWorkspaceProject(current, targetMode, (currentWorkspace) => ({ ...currentWorkspace, phases: [...currentWorkspace.phases, phase] })));
    setMessage(`Phase « ${phase.name} » ajoutée dans l’espace ${modeLabel(targetMode)}.`);
  }, [activeMode, history, phases.length]);

  const applyJournalPreset = useCallback((key) => {
    const preset = JOURNAL_PRESETS[key];
    if (!preset) return;
    history.set((current) => ({
      ...current,
      version: 18,
      workspaces: applySettingsToAllWorkspaces(current.workspaces, preset),
    }));
    setMessage(`Gabarit « ${preset.label} » appliqué à tous les espaces.`);
  }, [history]);

  const saveStyleTemplate = useCallback(() => {
    const name = templateName.trim();
    if (!name) { setMessage("Saisir un nom de style."); return; }
    const keys = ["figWidth", "axisFontSize", "axisFontBold", "tickFontSize", "tickFontBold", "titleFontSize", "titleFontBold", "panelTitleFontSize", "panelTitleFontBold", "panelAxisFontSize", "panelAxisFontBold", "lineWidth", "showFill", "fillAlpha", "cmap", "cmapMin", "cmapMax", "cmapReverse", "useCustomColors", "pageBackground", "rightMargin", "showPatternLabels", "patternLabelSize", "patternLabelBold", "peakLabelSize", "peakLabelBold", "pdfStickW", "annotFontSize", "annotFontBold", "abbrevKeyFontSize", "abbrevKeyFontBold", "zoneLabelFontSize", "zoneLabelFontBold", "referenceRowFontSize", "referenceRowFontBold", "referenceSubtitleFontSize", "referenceSubtitleFontBold", "insetLabelFontSize", "insetLabelFontBold", "insetRangeFontSize", "insetRangeFontBold", "phaseOverlayValueSize", "phaseOverlayValueBold", "overlayLegendFontSize", "overlayLegendFontBold", "curveLegendFontSize", "curveLegendFontBold", "phaseLegendFontSize", "phaseLegendFontBold", "figureLayoutMode", "gridColumns", "panelGap", "panelLettering", "sharedPatternLegend"];
    const settings = Object.fromEntries(keys.map((key) => [key, S[key]]));
    setStyleTemplates((current) => [...current.filter((entry) => entry.name !== name), { id: newId("style"), name, settings, savedAt: Date.now() }]);
    setTemplateName("");
    setMessage(`Style « ${name} » enregistré localement.`);
  }, [S, templateName]);

  const applyStyleTemplate = useCallback((entry) => {
    history.set((current) => ({
      ...current,
      workspaces: applySettingsToAllWorkspaces(current.workspaces, entry.settings),
    }));
    setMessage(`Style « ${entry.name} » appliqué à tous les espaces.`);
  }, [history]);


  const annotationData = useMemo(() => {
    if (!S.showAnnotations) return { ticks: [], labels: [] };
    const ticks = [];
    phases.forEach((phase) => {
      if (!phase.visible || !phase.inAnnot) return;
      phase.peaks.forEach(([x, intensity]) => {
        if (x >= viewXMin && x <= viewXMax && (!breakActive || x <= Number(S.brokenAxisStart) || x >= Number(S.brokenAxisEnd)) && intensity >= S.tickMinI) {
          ticks.push({
            x,
            intensity,
            abbreviation: phase.abbrev,
            color: phase.color,
            phaseId: phase.id,
            dashed: isPhaseDashed(phase, "annotation"),
            labelOffsetX: Number(phase.labelOffsetX) || 0,
            labelOffsetY: Number(phase.labelOffsetY) || 0,
          });
        }
      });
    });
    const pool = ticks.filter((tick) => tick.intensity >= S.labelMinI).sort((a, b) => b.intensity - a.intensity);
    const labels = [];
    pool.forEach((tick) => {
      if (labels.every((placed) => Math.abs(tick.x - placed.x) >= S.labelMinSep)) labels.push(tick);
    });
    labels.sort((a, b) => a.x - b.x);
    return { ticks, labels };
  }, [S.brokenAxisEnd, S.brokenAxisStart, S.labelMinI, S.labelMinSep, S.showAnnotations, S.tickMinI, breakActive, phases, viewXMax, viewXMin]);

  const serializeSvg = ({ transparent = S.transparentExport } = {}) => {
    if (!svgRef.current) return null;
    return serializeSvgForExport(svgRef.current, {
      width: W,
      height: H,
      transparent,
      background: S.pageBackground,
    });
  };

  const downloadSvg = () => {
    const serialized = serializeSvg();
    if (!serialized) return;
    downloadBlob(serialized, "image/svg+xml;charset=utf-8", `${S.fileName || "figure"}.svg`);
  };

  const rasterizeSvg = async (requestedScale, transparent = S.transparentExport) => {
    const serialized = serializeSvg({ transparent });
    if (!serialized) throw new Error("Figure SVG indisponible.");
    const scale = exportScaleLimits(W, H, requestedScale);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Échec du rendu SVG."));
      image.src = svgDataUrl(serialized);
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(W * scale));
    canvas.height = Math.max(1, Math.round(H * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D indisponible.");
    if (!transparent) {
      context.fillStyle = S.pageBackground;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, context, scale };
  };

  const downloadPng = async () => {
    try {
      setIsExporting(true);
      const { canvas } = await rasterizeSvg(S.pngScale, S.transparentExport);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Encodage PNG impossible.");
      downloadBlob(blob, "image/png", `${S.fileName || "figure"}.png`);
      setMessage("Figure PNG exportée.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsExporting(false);
    }
  };

  const downloadTiff = async () => {
    try {
      setIsExporting(true);
      const requestedScale = Math.max(1, S.exportDpi / 96);
      const { canvas, context, scale } = await rasterizeSvg(requestedScale, S.transparentExport);
      const effectiveDpi = Math.round(scale * 96);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const tiff = encodeTiffRgba(imageData, canvas.width, canvas.height, effectiveDpi);
      downloadBlob(tiff, "image/tiff", `${S.fileName || "figure"}.tiff`);
      setMessage(`Figure TIFF exportée à ${effectiveDpi} dpi${effectiveDpi < S.exportDpi ? " — résolution limitée par la taille du canvas" : ""}.`);
    } catch (error) {
      setMessage(`Échec TIFF : ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const downloadPdf = async () => {
    try {
      setIsExporting(true);
      // Export vectoriel : traits et textes restent éditables et nets à
      // toute échelle. Repli sur l'ancien pipeline raster en cas d'échec.
      const serialized = serializeSvg({ transparent: false });
      if (!serialized) throw new Error("Figure SVG indisponible.");
      const pdf = svgToVectorPdf(serialized, W, H);
      downloadBlob(pdf, "application/pdf", `${S.fileName || "figure"}.pdf`);
      setMessage("Figure PDF vectorielle exportée.");
    } catch (vectorError) {
      try {
        const requestedScale = Math.max(1, S.exportDpi / 96);
        const { canvas, scale } = await rasterizeSvg(requestedScale, false);
        const effectiveDpi = Math.round(scale * 96);
        const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.97));
        if (!jpegBlob) throw new Error("Encodage JPEG intermédiaire impossible.");
        const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
        const pdf = buildPdfFromJpeg(jpegBytes, canvas.width, canvas.height, effectiveDpi);
        downloadBlob(pdf, "application/pdf", `${S.fileName || "figure"}.pdf`);
        setMessage(`PDF raster exporté à ${effectiveDpi} dpi (conversion vectorielle indisponible : ${vectorError.message}).`);
      } catch (error) {
        setMessage(`Échec PDF : ${error.message}`);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const copyPngToClipboard = async () => {
    try {
      setIsExporting(true);
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("Copie d'image non prise en charge par ce navigateur.");
      }
      const { canvas } = await rasterizeSvg(S.pngScale, false);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Encodage PNG impossible.");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setMessage("Figure copiée dans le presse-papier.");
    } catch (error) {
      setMessage(`Échec de la copie : ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const openExportPreview = (format = "png") => {
    const serialized = serializeSvg();
    if (!serialized) {
      setMessage("Figure SVG indisponible.");
      return;
    }
    setExportPreview({ open: true, format, serialized });
  };

  const closeExportPreview = () => setExportPreview((current) => ({ ...current, open: false }));

  const downloadPreviewedFigure = async () => {
    const format = exportPreview.format;
    if (format === "svg") downloadSvg();
    else if (format === "pdf") await downloadPdf();
    else if (format === "tiff") await downloadTiff();
    else await downloadPng();
  };

  const fitToWorkspace = useCallback(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const availableWidth = element.clientWidth - 90;
    const availableHeight = element.clientHeight - 90;
    setZoom(clamp(Math.min(availableWidth / W, availableHeight / H), 0.2, 2));
    requestAnimationFrame(() => {
      element.scrollTo({ left: 0, top: 0, behavior: "smooth" });
    });
  }, [W, H]);

  const svgPoint = useCallback((event) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * W;
    const svgY = ((event.clientY - rect.top) / rect.height) * H;
    const insidePlot = svgX >= M.left && svgX <= M.left + plotWidth && svgY >= M.top && svgY <= M.top + mainHeight;
    const dataX = pxToDataX(svgX);
    const dataY = yMaximum - ((svgY - M.top) / mainHeight) * (yMaximum - yMinimum);
    return { svgX, svgY, dataX, dataY, insidePlot };
  }, [H, M.left, M.top, W, mainHeight, plotWidth, pxToDataX, yMaximum, yMinimum]);

  const snapX = useCallback((value) => {
    if (!snapToPeak || !processed.length) return value;
    const tolerance = ((S.xmax - S.xmin) / Math.max(1, plotWidth)) * 14;
    const candidates = activeProcessedPattern ? [activeProcessedPattern] : processed;
    let best = null;
    candidates.forEach((pattern) => {
      (pattern.detectedPeaks || []).forEach((peak) => {
        const x = Number(peak.displayX ?? peak.x);
        const distance = Math.abs(x - value);
        if (!best || distance < best.distance) best = { x, distance };
      });
      if (!(pattern.detectedPeaks || []).length) {
        const nearest = nearestValue(pattern, value);
        if (nearest) {
          const distance = Math.abs(nearest.x - value);
          if (!best || distance < best.distance) best = { x: nearest.x, distance };
        }
      }
    });
    return best && best.distance <= tolerance ? best.x : value;
  }, [S.xmax, S.xmin, activeProcessedPattern, plotWidth, processed, snapToPeak]);

  const commitCanvasReorder = useCallback((patternId, svgY) => {
    const dragged = processed.find((pattern) => pattern.id === patternId);
    if (!dragged) return;
    let target = dragged;
    let distance = Infinity;
    processed.forEach((pattern) => {
      const candidate = Math.abs(yToPx(labelYForPattern(pattern)) - svgY);
      if (candidate < distance) { distance = candidate; target = pattern; }
    });
    if (target.id === dragged.id) return;
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => {
      const source = currentWorkspace.patterns;
      const from = source.findIndex((item) => item.id === patternId);
      const to = source.findIndex((item) => item.id === target.id);
      if (from < 0 || to < 0 || source[from].locked) return currentWorkspace;
      const next = source.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { ...currentWorkspace, patterns: next };
    }));
    setMessage(`Courbe « ${dragged.label} » déplacée dans l’empilement.`);
  }, [activeMode, history, labelYForPattern, processed, yToPx]);

  const beginCanvasDrag = useCallback((event, type, payload = {}) => {
    if (!svgRef.current) return;
    const point = svgPoint(event);
    if (!point) return;
    event.stopPropagation();
    interactionRef.current = { type, pointerId: event.pointerId, start: point, payload, moved: false };
  }, [svgPoint]);

  const onSvgPointerDown = (event) => {
    if (tool !== "zoomRect") return;
    const point = svgPoint(event);
    if (!point?.insidePlot) return;
    beginCanvasDrag(event, "zoomRect", {});
  };

  const onSvgPointerMove = (event) => {
    const point = svgPoint(event);
    if (!point) return;
    const interaction = interactionRef.current;
    if (interaction) {
      if (!interaction.moved) {
        const distance = Math.hypot(point.svgX - interaction.start.svgX, point.svgY - interaction.start.svgY);
        if (distance < 2.5) return;
        interaction.moved = true;
        svgRef.current?.setPointerCapture?.(interaction.pointerId);
      }
      event.preventDefault();
      if (interaction.type === "note") {
        let x = clamp(point.dataX, S.xmin, S.xmax);
        let yFrac = clamp(1 - ((point.svgY - M.top) / mainHeight), 0, 1);
        const guides = [];
        if (magnetAlign) {
          const threshold = 6;
          // Candidats verticaux : X des autres notes visibles, centre et bords du tracé.
          const candidatesX = notes
            .filter((note) => note.id !== interaction.payload.id && note.visible !== false)
            .map((note) => xToPx(safeNoteModel(note, viewXMin, viewXMax).x));
          candidatesX.push(M.left + plotWidth / 2);
          const currentPx = xToPx(x);
          let bestX = null;
          candidatesX.forEach((candidate) => {
            const distance = Math.abs(candidate - currentPx);
            if (distance <= threshold && (!bestX || distance < bestX.distance)) bestX = { candidate, distance };
          });
          if (bestX) {
            x = clamp(pxToDataX(bestX.candidate), S.xmin, S.xmax);
            guides.push({ axis: "x", px: bestX.candidate });
          }
          // Candidats horizontaux : Y des autres notes, centre du tracé.
          const candidatesY = notes
            .filter((note) => note.id !== interaction.payload.id && note.visible !== false)
            .map((note) => M.top + mainHeight * (1 - safeNoteModel(note, viewXMin, viewXMax).yFrac));
          candidatesY.push(M.top + mainHeight / 2);
          const currentPy = M.top + mainHeight * (1 - yFrac);
          let bestY = null;
          candidatesY.forEach((candidate) => {
            const distance = Math.abs(candidate - currentPy);
            if (distance <= threshold && (!bestY || distance < bestY.distance)) bestY = { candidate, distance };
          });
          if (bestY) {
            yFrac = clamp(1 - ((bestY.candidate - M.top) / mainHeight), 0, 1);
            guides.push({ axis: "y", px: bestY.candidate });
          }
        }
        setDragPreview({ type: "note", id: interaction.payload.id, x, yFrac, fontSize: interaction.payload.fontSize, guides });
      } else if (interaction.type === "noteResize") {
        setDragPreview({ type: "noteResize", id: interaction.payload.id, fontSize: clamp(interaction.payload.fontSize + (point.svgX - interaction.start.svgX) / 4, 5, 60) });
      } else if (interaction.type === "patternLabel") {
        let dx = interaction.payload.dx + (point.svgX - interaction.start.svgX);
        let dy = interaction.payload.dy + (point.svgY - interaction.start.svgY);
        const guides = [];
        if (magnetAlign) {
          const threshold = 6;
          const defaultLabelX = M.left + plotWidth + 10;
          // Alignement horizontal : retour à la colonne par défaut des étiquettes.
          if (Math.abs(dx) <= threshold) {
            dx = 0;
            guides.push({ axis: "x", px: defaultLabelX });
          }
          // Alignement vertical : ligne de base d'une autre étiquette de courbe.
          const dragged = processed.find((pattern) => pattern.id === interaction.payload.id);
          if (dragged) {
            const currentY = yToPx(labelYForPattern(dragged)) + dy;
            let bestY = null;
            processed.forEach((other) => {
              if (other.id === dragged.id) return;
              const candidate = yToPx(labelYForPattern(other)) + (Number(other.labelDy) || 0);
              const distance = Math.abs(candidate - currentY);
              if (distance <= threshold && (!bestY || distance < bestY.distance)) bestY = { candidate, distance };
            });
            if (bestY) {
              dy += bestY.candidate - currentY;
              guides.push({ axis: "y", px: bestY.candidate });
            }
          }
        }
        setDragPreview({ type: "patternLabel", id: interaction.payload.id, dx, dy, fontSize: interaction.payload.fontSize, guides });
      } else if (interaction.type === "patternLabelResize") {
        setDragPreview({ type: "patternLabelResize", id: interaction.payload.id, fontSize: clamp(interaction.payload.fontSize + (point.svgX - interaction.start.svgX) / 4, 6, 42) });
      } else if (interaction.type === "phaseLegendMove") {
        setDragPreview({ type: "phaseLegendMove", x: interaction.payload.x + (point.svgX - interaction.start.svgX), y: interaction.payload.y + (point.svgY - interaction.start.svgY), width: interaction.payload.width });
      } else if (interaction.type === "annotationTickScale") {
        const dataY = yMinimum + ((M.top + mainHeight - point.svgY) / mainHeight) * (yMaximum - yMinimum);
        const unit = Math.max(1e-6, Number(interaction.payload.intensity) / 100);
        setDragPreview({ type: "annotationTickScale", scale: clamp((dataY - annotationBase) / unit, 0.05, 3) });
      } else if (interaction.type === "overlayValueMove") {
        let dx = interaction.payload.dx + (point.svgX - interaction.start.svgX);
        let dy = interaction.payload.dy + (point.svgY - interaction.start.svgY);
        let snapped = null;
        // Accrochage : près de l'ancrage courant (bâtonnet ou pic selon le mode),
        // le décalage s'annule ; près de la cible alternative, la valeur s'y colle.
        if (Math.hypot(dx, dy) < 12) { dx = 0; dy = 0; snapped = "anchor"; }
        else if (Number.isFinite(interaction.payload.altY)) {
          const targetDy = interaction.payload.altY - interaction.payload.stickY;
          if (Math.abs(targetDy) > 4 && Math.hypot(dx, dy - targetDy) < 12) { dx = 0; dy = targetDy; snapped = "alt"; }
        }
        setDragPreview({ type: "overlayValueMove", phaseId: interaction.payload.phaseId, x: interaction.payload.x, dx, dy, snapped, stickX: interaction.payload.stickX, stickY: interaction.payload.stickY });
      } else if (interaction.type === "phaseOverlayPeakScale") {
        // En transmittance les bâtonnets pendent depuis le haut du cadre : la
        // longueur se compte depuis M.top et non depuis la ligne de base.
        const dataY = interaction.payload.invert
          ? ((point.svgY - M.top) / mainHeight) * (yMaximum - yMinimum)
          : yMinimum + ((M.top + mainHeight - point.svgY) / mainHeight) * (yMaximum - yMinimum);
        const unit = Math.max(1e-6, Number(interaction.payload.unit));
        setDragPreview({ type: "phaseOverlayPeakScale", id: interaction.payload.id, x: interaction.payload.x, scale: clamp(dataY / unit, 0.005, 50) });
      } else if (interaction.type === "phaseOverlayScale") {
        const dataY = yMinimum + ((M.top + mainHeight - point.svgY) / mainHeight) * (yMaximum - yMinimum);
        const unit = Math.max(1e-6, Number(interaction.payload.unit));
        setDragPreview({ type: "phaseOverlayScale", id: interaction.payload.id, scale: clamp(dataY / unit, 0.005, 50) });
      } else if (interaction.type === "noteAnchorMove") {
        const snappedX = snapX(clamp(point.dataX, viewXMin, viewXMax));
        const yFrac = clamp(1 - ((point.svgY - M.top) / mainHeight), 0, 1);
        setDragPreview({ type: "noteAnchorMove", id: interaction.payload.id, x: Math.round(snappedX * 10000) / 10000, yFrac: Math.round(yFrac * 1000) / 1000 });
      } else if (interaction.type === "noteVlineTop" || interaction.type === "noteVlineBottom") {
        const frac = clamp(1 - ((point.svgY - M.top) / mainHeight), 0, 1);
        setDragPreview({ type: interaction.type, id: interaction.payload.id, frac: Math.round(frac * 1000) / 1000 });
      } else if (interaction.type === "overlayLegendMove") {
        setDragPreview({ type: "overlayLegendMove", x: interaction.payload.x + (point.svgX - interaction.start.svgX), y: interaction.payload.y + (point.svgY - interaction.start.svgY) });
      } else if (interaction.type === "curveLegendMove") {
        setDragPreview({ type: "curveLegendMove", x: interaction.payload.x + (point.svgX - interaction.start.svgX), y: interaction.payload.y + (point.svgY - interaction.start.svgY) });
      } else if (interaction.type === "zoomRect") {
        setDragPreview({ type: "zoomRect", x1: interaction.start.svgX, x2: point.svgX });
      } else if (interaction.type === "phaseLegendResize") {
        setDragPreview({ type: "phaseLegendResize", x: interaction.payload.x, y: interaction.payload.y, width: clamp(interaction.payload.width + (point.svgX - interaction.start.svgX), 140, Math.max(160, plotWidth - 10)) });
      } else if (interaction.type === "insetMove") {
        const widthFrac = clamp(Number(interaction.payload.widthPct) || 34, 15, 70) / 100;
        const heightFrac = clamp(Number(interaction.payload.heightPct) || 34, 15, 70) / 100;
        setDragPreview({
          type: "insetMove",
          xFrac: clamp(interaction.payload.xFrac + (point.svgX - interaction.start.svgX) / Math.max(1, plotWidth), 0, Math.max(0, 1 - widthFrac)),
          yFrac: clamp(interaction.payload.yFrac + (point.svgY - interaction.start.svgY) / Math.max(1, mainHeight), 0, Math.max(0, 1 - heightFrac)),
          widthPct: interaction.payload.widthPct,
          heightPct: interaction.payload.heightPct,
        });
      } else if (interaction.type === "insetResize") {
        const widthPct = clamp(interaction.payload.widthPct + ((point.svgX - interaction.start.svgX) / Math.max(1, plotWidth)) * 100, 15, 70);
        const heightPct = clamp(interaction.payload.heightPct + ((point.svgY - interaction.start.svgY) / Math.max(1, mainHeight)) * 100, 15, 70);
        setDragPreview({ type: "insetResize", xFrac: interaction.payload.xFrac, yFrac: interaction.payload.yFrac, widthPct, heightPct });
      } else if (interaction.type === "xAxisWindow") {
        const minimumSpan = Math.max((fullXRange.maximum - fullXRange.minimum) * 0.002, activeMode === "drx" ? 0.02 : 1);
        const { xmin, xmax } = computeAxisWindowDrag({
          mode: interaction.payload.mode,
          startMin: interaction.payload.xmin,
          startMax: interaction.payload.xmax,
          // Sur un axe inversé, un glissement vers la droite fait décroître X.
          deltaPx: (point.svgX - interaction.start.svgX) * (S.reverseXAxis ? -1 : 1),
          plotWidth: interaction.payload.plotWidth || plotWidth,
          dataMin: fullXRange.minimum,
          dataMax: fullXRange.maximum,
          minimumSpan,
        });
        setDragPreview({ type: "xAxisWindow", mode: interaction.payload.mode, xmin, xmax });
      } else if (interaction.type === "phaseLabel") {
        setDragPreview({
          type: "phaseLabel",
          id: interaction.payload.id,
          xOffset: interaction.payload.xOffset + (point.dataX - interaction.start.dataX),
          yOffset: interaction.payload.yOffset + (point.dataY - interaction.start.dataY),
        });
      } else if (interaction.type === "zoneBoundary") {
        const zone = zones.find((item) => item.id === interaction.payload.id);
        if (zone) {
          const x = clamp(point.dataX, S.xmin, S.xmax);
          setDragPreview({
            type: "zoneBoundary",
            id: zone.id,
            edge: interaction.payload.edge,
            x: interaction.payload.edge === "min" ? Math.min(x, Number(zone.xmax) - 1e-9) : Math.max(x, Number(zone.xmin) + 1e-9),
          });
        }
      } else if (interaction.type === "curveOrder") {
        setDragPreview({ type: "curveOrder", id: interaction.payload.id, svgY: point.svgY });
      }
      return;
    }
    if (!point.insidePlot) {
      setCursor(null);
      return;
    }
    const dataX = snapToPeak ? snapX(point.dataX) : point.dataX;
    const nearest = activeProcessedPattern ? nearestValue(activeProcessedPattern, dataX) : null;
    setCursor({ dataX, svgX: xToPx(dataX), svgY: point.svgY, nearest, snapped: Math.abs(dataX - point.dataX) > 1e-10 });
  };

  const finishSvgInteraction = (event) => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    if (!interaction.moved) {
      try { svgRef.current?.releasePointerCapture?.(interaction.pointerId); } catch { /* capture already released */ }
      interactionRef.current = null;
      setDragPreview(null);
      return;
    }
    const point = svgPoint(event) || interaction.start;
    if (dragPreview?.type === "note") {
      history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
        ...currentWorkspace,
        notes: currentWorkspace.notes.map((note) => note.id === dragPreview.id ? { ...note, x: dragPreview.x, yFrac: dragPreview.yFrac } : note),
      })));
    } else if (dragPreview?.type === "noteResize") {
      updateNote(dragPreview.id, "fontSize", dragPreview.fontSize);
    } else if (dragPreview?.type === "patternLabel") {
      history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
        ...currentWorkspace,
        patterns: currentWorkspace.patterns.map((pattern) => pattern.id === dragPreview.id ? { ...pattern, labelDx: dragPreview.dx, labelDy: dragPreview.dy } : pattern),
      })));
    } else if (dragPreview?.type === "patternLabelResize") {
      updatePattern(dragPreview.id, "labelFontSize", dragPreview.fontSize);
    } else if (dragPreview?.type === "phaseLabel") {
      history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
        ...currentWorkspace,
        phases: currentWorkspace.phases.map((phase) => phase.id === dragPreview.id ? { ...phase, labelOffsetX: dragPreview.xOffset, labelOffsetY: dragPreview.yOffset } : phase),
      })));
    } else if (dragPreview?.type === "zoneBoundary") {
      updateZone(dragPreview.id, dragPreview.edge === "min" ? "xmin" : "xmax", dragPreview.x);
    } else if (dragPreview?.type === "curveOrder") {
      commitCanvasReorder(dragPreview.id, dragPreview.svgY ?? point.svgY);
    } else if (dragPreview?.type === "annotationTickScale") {
      patchSettings("tickScale", Math.round(dragPreview.scale * 1000) / 1000);
    } else if (dragPreview?.type === "overlayValueMove") {
      setOverlayValueOffset(dragPreview.phaseId, dragPreview.x, dragPreview.dx, dragPreview.dy);
    } else if (dragPreview?.type === "phaseOverlayPeakScale") {
      setPhaseOverlayPeakScale(dragPreview.id, dragPreview.x, Math.round(dragPreview.scale * 10000) / 10000);
    } else if (dragPreview?.type === "phaseOverlayScale") {
      updatePhase(dragPreview.id, "overlayScale", Math.round(dragPreview.scale * 1000) / 1000);
    } else if (dragPreview?.type === "noteAnchorMove") {
      history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
        ...currentWorkspace,
        notes: currentWorkspace.notes.map((note) => note.id === dragPreview.id ? { ...note, anchorX: dragPreview.x, anchorYFrac: dragPreview.yFrac } : note),
      })));
    } else if (dragPreview?.type === "noteVlineTop" || dragPreview?.type === "noteVlineBottom") {
      updateNote(dragPreview.id, dragPreview.type === "noteVlineTop" ? "vlineTopFrac" : "vlineBottomFrac", dragPreview.frac);
    } else if (dragPreview?.type === "overlayLegendMove") {
      history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
        ...currentWorkspace,
        settings: { ...currentWorkspace.settings, overlayLegendX: dragPreview.x, overlayLegendY: dragPreview.y },
      })));
    } else if (dragPreview?.type === "curveLegendMove") {
      history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
        ...currentWorkspace,
        settings: { ...currentWorkspace.settings, curveLegendX: dragPreview.x, curveLegendY: dragPreview.y },
      })));
    } else if (dragPreview?.type === "zoomRect") {
      const first = pxToDataX(Math.min(dragPreview.x1, dragPreview.x2));
      const second = pxToDataX(Math.max(dragPreview.x1, dragPreview.x2));
      const xmin = Math.min(first, second);
      const xmax = Math.max(first, second);
      const minimumSpan = Math.max((fullXRange.maximum - fullXRange.minimum) * 0.002, activeMode === "drx" ? 0.02 : 1);
      if (xmax - xmin >= minimumSpan) {
        history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
          ...currentWorkspace,
          settings: { ...currentWorkspace.settings, xmin, xmax, viewYMin: null, viewYMax: null },
        })));
        setMessage(`Zoom sur ${xmin.toFixed(activeMode === "drx" ? 2 : 0)}–${xmax.toFixed(activeMode === "drx" ? 2 : 0)}.`);
      }
    } else if (["phaseLegendMove", "phaseLegendResize"].includes(dragPreview?.type)) {
      history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
        ...currentWorkspace,
        settings: { ...currentWorkspace.settings, phaseLegendX: dragPreview.x, phaseLegendY: dragPreview.y, phaseLegendWidth: dragPreview.width },
      })));
    } else if (["insetMove", "insetResize"].includes(dragPreview?.type)) {
      history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
        ...currentWorkspace,
        settings: { ...currentWorkspace.settings, insetXFrac: dragPreview.xFrac, insetYFrac: dragPreview.yFrac, insetWidthPct: dragPreview.widthPct, insetHeightPct: dragPreview.heightPct },
      })));
    } else if (dragPreview?.type === "xAxisWindow") {
      history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
        ...currentWorkspace,
        settings: { ...currentWorkspace.settings, xmin: dragPreview.xmin, xmax: dragPreview.xmax, viewYMin: null, viewYMax: null },
      })));
    }
    try { svgRef.current?.releasePointerCapture?.(interaction.pointerId); } catch { /* capture already released */ }
    interactionRef.current = null;
    suppressClickRef.current = true;
    setDragPreview(null);
  };

  const resetDataZoom = useCallback(() => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      settings: { ...currentWorkspace.settings, xmin: fullXRange.minimum, xmax: fullXRange.maximum, viewYMin: null, viewYMax: null },
    })));
    setMessage("Plage X réinitialisée sur l’étendue des données visibles.");
  }, [activeMode, fullXRange.maximum, fullXRange.minimum, history]);

  // ── Édition interactive des pics ─────────────────────────────────────────
  const peakEditTolerance = activeMode === "drx" ? 0.05 : 2;

  const addUserPeak = useCallback((patternId, x) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((pattern) => {
        if (pattern.id !== patternId) return pattern;
        const existing = Array.isArray(pattern.userPeaks) ? pattern.userPeaks : [];
        if (existing.some((value) => Math.abs(value - x) < peakEditTolerance / 2)) return pattern;
        // Un ajout à une position exclue lève d'abord l'exclusion.
        const excluded = (Array.isArray(pattern.excludedPeaks) ? pattern.excludedPeaks : []).filter((value) => Math.abs(value - x) >= peakEditTolerance);
        return { ...pattern, userPeaks: [...existing, x].sort((a, b) => a - b), excludedPeaks: excluded };
      }),
    })));
    setMessage(`Pic ajouté à ${x.toFixed(activeMode === "drx" ? 3 : 1)}.`);
  }, [activeMode, history, peakEditTolerance]);

  const removePeak = useCallback((patternId, peak) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((pattern) => {
        if (pattern.id !== patternId) return pattern;
        if (peak.manual) {
          const userPeaks = (Array.isArray(pattern.userPeaks) ? pattern.userPeaks : []).filter((value) => Math.abs(value - peak.x) >= peakEditTolerance / 2);
          return { ...pattern, userPeaks };
        }
        const excluded = Array.isArray(pattern.excludedPeaks) ? pattern.excludedPeaks : [];
        if (excluded.some((value) => Math.abs(value - peak.x) < peakEditTolerance / 2)) return pattern;
        return { ...pattern, excludedPeaks: [...excluded, peak.x].sort((a, b) => a - b) };
      }),
    })));
    setMessage(`Pic à ${Number(peak.x).toFixed(activeMode === "drx" ? 3 : 1)} retiré.`);
  }, [activeMode, history, peakEditTolerance]);

  /**
   * Applique une nouvelle liste de pics à une phase en remappant les réglages
   * par pic (hauteurs individuelles, exceptions de valeurs, décalages) sur la
   * position la plus proche de la nouvelle liste. Sans cela, l'arrondi de
   * l'éditeur manuel décale les positions et perd tous les réglages.
   */
  const applyPhasePeaks = useCallback((phaseId, peaks) => {
    const remapTolerance = activeMode === "drx" ? 0.02 : 2;
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      phases: currentWorkspace.phases.map((phase) => {
        if (phase.id !== phaseId) return phase;
        const nearest = (x) => {
          let best = null;
          for (const [position] of peaks) {
            const distance = Math.abs(position - x);
            if (distance < remapTolerance && (!best || distance < best.distance)) best = { position, distance };
          }
          return best?.position;
        };
        const seen = new Set();
        const remapObjects = (list) => (list || []).map((item) => {
          const next = nearest(Number(item.x));
          if (next === undefined || seen.has(`o${next}`)) return null;
          seen.add(`o${next}`);
          return { ...item, x: next };
        }).filter(Boolean);
        const remapValues = (list) => (list || []).map((value) => {
          const next = nearest(Number(value));
          if (next === undefined || seen.has(`v${next}`)) return null;
          seen.add(`v${next}`);
          return next;
        }).filter((value) => value !== null);
        return {
          ...phase,
          peaks,
          overlayPeakScales: remapObjects(phase.overlayPeakScales),
          overlayValueOffsets: remapObjects(phase.overlayValueOffsets),
          overlayValueExceptions: remapValues(phase.overlayValueExceptions),
        };
      }),
    })));
  }, [activeMode, history]);

  /** Enregistre le décalage libre d'une valeur de pic ; nul, il est retiré. */
  const setOverlayValueOffset = useCallback((phaseId, x, dx, dy) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      phases: currentWorkspace.phases.map((phase) => {
        if (phase.id !== phaseId) return phase;
        const tolerance = activeMode === "drx" ? 0.005 : 0.5;
        const entries = (phase.overlayValueOffsets || []).filter((item) => Math.abs(Number(item.x) - x) >= tolerance);
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return { ...phase, overlayValueOffsets: entries };
        return { ...phase, overlayValueOffsets: [...entries, { x, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 }].sort((a, b) => a.x - b.x) };
      }),
    })));
  }, [activeMode, history]);

  // Tolérance d'appariement des réglages par pic (hauteurs, exceptions,
  // décalages de valeurs) : les positions issues de l'éditeur manuel sont
  // arrondies à 2 décimales, une égalité stricte perdrait les réglages.
  const overlayTolerance = activeMode === "drx" ? 0.005 : 0.5;

  /**
   * Fixe la hauteur d'un bâtonnet superposé individuellement. La valeur est
   * stockée par position dans overlayPeakScales ; les bâtonnets sans entrée
   * suivent la hauteur de la phase.
   */
  const setPhaseOverlayPeakScale = useCallback((phaseId, x, scale) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      phases: currentWorkspace.phases.map((phase) => {
        if (phase.id !== phaseId) return phase;
        const entries = (phase.overlayPeakScales || []).filter((item) => Math.abs(Number(item.x) - x) >= overlayTolerance);
        return { ...phase, overlayPeakScales: [...entries, { x, scale }].sort((a, b) => a.x - b.x) };
      }),
    })));
  }, [activeMode, history]);

  /** Rend un bâtonnet à la hauteur commune de sa phase. */
  const resetPhaseOverlayPeakScale = useCallback((phaseId, x) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      phases: currentWorkspace.phases.map((phase) => phase.id === phaseId
        ? { ...phase, overlayPeakScales: (phase.overlayPeakScales || []).filter((item) => Math.abs(Number(item.x) - x) >= overlayTolerance) }
        : phase),
    })));
    setMessage("Bâtonnet rendu à la hauteur de sa phase.");
  }, [activeMode, history]);

  /**
   * Inverse l'affichage de la valeur d'un bâtonnet de référence superposé.
   * Les positions listées dans overlayValueExceptions sont dans l'état opposé
   * au réglage global de la phase (overlayShowValues).
   */
  const togglePhaseOverlayValue = useCallback((phaseId, x) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      phases: currentWorkspace.phases.map((phase) => {
        if (phase.id !== phaseId) return phase;
        const exceptions = Array.isArray(phase.overlayValueExceptions) ? phase.overlayValueExceptions : [];
        const exists = exceptions.some((value) => Math.abs(value - x) < overlayTolerance);
        return {
          ...phase,
          overlayValueExceptions: exists
            ? exceptions.filter((value) => Math.abs(value - x) >= overlayTolerance)
            : [...exceptions, x],
        };
      }),
    })));
  }, [activeMode, history]);

  const resetPeakEdits = useCallback((patternId) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((pattern) => pattern.id === patternId ? { ...pattern, userPeaks: [], excludedPeaks: [] } : pattern),
    })));
    setMessage("Ajouts et retraits manuels de pics réinitialisés.");
  }, [activeMode, history]);

  /** Recherche le maximum local du signal traité autour d'une position cliquée. */
  const snapToLocalMax = useCallback((pattern, dataX) => {
    const sourceX = pattern.sourceX || [];
    const y = pattern.processedY || [];
    if (!sourceX.length) return dataX;
    const window = Math.max(peakEditTolerance * 3, ((S.xmax - S.xmin) / Math.max(1, plotWidth)) * 10);
    let bestIndex = -1;
    for (let i = 0; i < sourceX.length; i += 1) {
      if (Math.abs(sourceX[i] - dataX) > window) continue;
      if (bestIndex < 0 || y[i] > y[bestIndex]) bestIndex = i;
    }
    return bestIndex >= 0 ? sourceX[bestIndex] : dataX;
  }, [S.xmax, S.xmin, peakEditTolerance, plotWidth]);

  /** Charge un jeu de démonstration synthétique dans l'espace actif. */
  const loadSampleData = useCallback(() => {
    const sample = makeSampleData(activeMode);
    const patternsToAdd = sample.patterns.map((entry, index) => ({
      id: newId("pattern"),
      label: entry.label,
      fileName: `exemple_${activeMode}_${index + 1}`,
      x: entry.x,
      y: entry.y,
      visible: true,
      color: "#111111",
      yscale: 1,
      xoffset: 0,
      locked: false,
      userNotes: tr("Données synthétiques de démonstration."),
      orderValue: "",
      groupType: "",
      groupName: "",
      groupValue: "",
      importedAt: Date.now(),
      ...(entry.irQuantity ? { irQuantity: entry.irQuantity } : {}),
    }));
    const phasesToAdd = sample.phases.map((entry, index) => ({
      id: newId("phase"),
      name: entry.name,
      abbrev: entry.abbrev,
      color: PHASE_COLORS[index % PHASE_COLORS.length],
      peaks: entry.peaks,
      visible: true,
      inAnnot: true,
      inPanel: activeMode === "drx",
      files: ["exemple"],
      sourceKind: "manual",
      labelOffsetX: 0,
      labelOffsetY: 0,
    }));
    const zonesToAdd = (sample.zones || []).map((entry) => ({ id: newId("zone"), visible: true, ...entry }));
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: [...currentWorkspace.patterns, ...patternsToAdd],
      phases: [...currentWorkspace.phases, ...phasesToAdd],
      zones: MODES_WITH_ZONES.includes(activeMode) ? [...(currentWorkspace.zones || []), ...zonesToAdd] : currentWorkspace.zones,
    })));
    setLeftTab("patterns");
    setMessage(`Jeu d'exemple ${modeLabel(activeMode)} chargé : ${patternsToAdd.length} patron(s), ${phasesToAdd.length} phase(s). Données synthétiques, à des fins de découverte uniquement.`);
  }, [activeMode, history]);

  const onSvgClick = (event) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    const point = svgPoint(event);
    if (!point?.insidePlot || interactionRef.current) return;
    if (tool === "peaks") {
      if (!processed.length) return;
      // Patron cible : le plus proche verticalement de la position cliquée.
      let target = null;
      let bestDistance = Infinity;
      processed.forEach((pattern) => {
        const localX = point.dataX - (pattern.waterfallShift || 0);
        const value = interpolateSeriesLocal(pattern.sourceX, pattern.displayY, localX);
        if (value === null) return;
        const distance = Math.abs(value + pattern.stackOffset - point.dataY);
        if (distance < bestDistance) { bestDistance = distance; target = { pattern, localX }; }
      });
      if (!target) return;
      addUserPeak(target.pattern.id, snapToLocalMax(target.pattern, target.localX));
      return;
    }
    if (!addNoteMode) return;
    const note = {
      id: newId("note"),
      x: Math.round(point.dataX * 1000) / 1000,
      yFrac: clamp(Math.round((1 - ((point.svgY - M.top) / mainHeight)) * 1000) / 1000, 0, 1),
      text: "Annotation",
      color: "#2d333b",
      fontSize: 10,
      bold: false,
      rotation: 0,
      vline: false,
      vlineTopFrac: 1,
      vlineBottomFrac: 0,
      anchorLine: false,
      anchorX: null,
      anchorYFrac: 0.5,
      visible: true,
    };
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({ ...currentWorkspace, notes: [...currentWorkspace.notes, note] })));
    setSelection([{ type: "note", id: note.id }]); selectionAnchorRef.current = { type: "note", id: note.id };
    setLeftTab("notes");
    setRightTab("inspector");
    setAddNoteMode(false);
  };

  const startPan = (event) => {
    const workspace = workspaceRef.current;
    if (!workspace || !(tool === "hand" || event.button === 1)) return;
    event.preventDefault();
    panRef.current = { x: event.clientX, y: event.clientY, left: workspace.scrollLeft, top: workspace.scrollTop };
    workspace.setPointerCapture?.(event.pointerId);
  };

  const movePan = (event) => {
    const workspace = workspaceRef.current;
    const start = panRef.current;
    if (!workspace || !start) return;
    workspace.scrollLeft = start.left - (event.clientX - start.x);
    workspace.scrollTop = start.top - (event.clientY - start.y);
  };

  const stopPan = () => { panRef.current = null; };

  const workspaceWheel = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1.1 : 0.9;
    setZoom((value) => clamp(value * direction, 0.2, 3));
  };

  useEffect(() => {
    const keydown = (event) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (event.key === "Escape" && exportPreview.open) {
        event.preventDefault();
        closeExportPreview();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) history.redo(); else history.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        history.redo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveSessionFile();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        sessionInputRef.current?.click();
      } else if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAllCurrentTab();
      } else if (!typing && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        removeSelection();
      } else if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && ["v", "h", "p", "z", "n"].includes(event.key.toLowerCase())) {
        const key = event.key.toLowerCase();
        if (key === "v") setTool("cursor");
        else if (key === "h") setTool("hand");
        else if (key === "p") setTool((value) => value === "peaks" ? "cursor" : "peaks");
        else if (key === "z") setTool((value) => value === "zoomRect" ? "cursor" : "zoomRect");
        else if (key === "n") { setAddNoteMode((value) => !value); setTool("cursor"); }
      } else if (event.key === "Escape") {
        if (interactionRef.current) {
          try { svgRef.current?.releasePointerCapture?.(interactionRef.current.pointerId); } catch { /* no-op */ }
          interactionRef.current = null;
          setDragPreview(null);
        }
        setAddNoteMode(false);
        setTool("cursor");
        setDropActive(false);
        setTextTarget(null);
        clearSelection();
        setProjectMenuOpen(false);
      } else if (!typing && event.code === "Space") {
        event.preventDefault();
        setTool("hand");
      }
    };
    const keyup = (event) => {
      if (event.code === "Space" && tool === "hand") setTool("cursor");
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  }, [clearSelection, exportPreview.open, history, removeSelection, saveSessionFile, selectAllCurrentTab, tool]);

  const renderPatternProperties = () => selectionCount > 1 ? (
    <>
      <Section title="Sélection multiple" badge={selectionCount}>
        <div className="selection-summary">
          {selectedByType.pattern.size > 0 && <span><Icon name="waveform" size={12} /><strong>{selectedByType.pattern.size}</strong> patron(s)</span>}
          {selectedByType.phase.size > 0 && <span><Icon name="phase" size={12} /><strong>{selectedByType.phase.size}</strong> phase(s)</span>}
          {selectedByType.zone.size > 0 && <span><Icon name="zone" size={12} /><strong>{selectedByType.zone.size}</strong> zone(s)</span>}
          {selectedByType.note.size > 0 && <span><Icon name="note" size={12} /><strong>{selectedByType.note.size}</strong> note(s)</span>}
        </div>
        <div className="bulk-inspector-grid">
          <Button variant="secondary" icon="eye" onClick={() => setSelectedVisibility(true)}>Afficher</Button>
          <Button variant="secondary" icon="eyeOff" onClick={() => setSelectedVisibility(false)}>Masquer</Button>
          <Button variant="secondary" icon="duplicate" onClick={duplicateSelection}>Dupliquer</Button>
          <Button variant="secondary" icon="trash" onClick={removeSelection}>Supprimer</Button>
        </div>
      </Section>
      {selectedByType.pattern.size > 0 && (
        <Section title="Patrons sélectionnés">
          <div className="callout">{`${tr("Les actions suivantes s’appliquent aux")} ${selectedByType.pattern.size} ${tr("patrons sélectionnés.")}`}</div>
          <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={resetSelectedPatternTransforms}>Réinitialiser Y et Δx</Button><Button variant="secondary" icon="lock" onClick={() => setSelectedLock(true)}>Verrouiller</Button><Button variant="secondary" icon="unlock" onClick={() => setSelectedLock(false)}>Déverrouiller</Button></div>
          <SelectField label="Déplacer vers" value={activeMode} onChange={moveSelectionToWorkspace} options={workspaceOptions} />
        </Section>
      )}
      {selectedByType.pattern.size > 0 && (
        <Section title="Renommage par lot" defaultOpen={false}>
          <SelectField label="Méthode" value={batchRename.mode} onChange={(mode) => setBatchRename((current) => ({ ...current, mode }))} options={[["prefix", "Ajouter un préfixe"], ["suffix", "Ajouter un suffixe"], ["regex", "Remplacement par expression régulière"]]} />
          {batchRename.mode === "regex" ? <><TextField label="Expression" value={batchRename.find} onChange={(find) => setBatchRename((current) => ({ ...current, find }))} /><TextField label="Remplacement" value={batchRename.replace} onChange={(replace) => setBatchRename((current) => ({ ...current, replace }))} /></> : <TextField label={batchRename.mode === "prefix" ? "Préfixe" : "Suffixe"} value={batchRename.value} onChange={(value) => setBatchRename((current) => ({ ...current, value }))} />}
          <div className="inline-actions"><Button variant="primary" onClick={applyBatchRename}>Appliquer le renommage</Button></div>
        </Section>
      )}
      {selectedByType.pattern.size > 0 && (
        <Section title="Groupement et ordre" defaultOpen={false}>
          <SelectField label="Type de groupe" value={batchGroup.type} onChange={(type) => setBatchGroup((current) => ({ ...current, type }))} options={[["sample", "Échantillon"], ["time", "Temps"], ["temperature", "Température"], ["treatment", "Traitement"]]} />
          <TextField label="Nom du groupe" value={batchGroup.name} onChange={(name) => setBatchGroup((current) => ({ ...current, name }))} />
          <TextField label="Valeur / unité" value={batchGroup.value} onChange={(value) => setBatchGroup((current) => ({ ...current, value }))} />
          <div className="inline-actions"><Button variant="primary" icon="group" onClick={applyBatchGroup}>Appliquer le groupe</Button><Button variant="secondary" icon="sort" onClick={extractSelectedOrder}>Extraire l’ordre des fichiers</Button></div>
        </Section>
      )}
      {selectedByType.phase.size > 0 && (
        <Section title="Phases sélectionnées">
          <Field label="Appliquer une couleur"><div className="color-field"><input type="color" defaultValue="#cc0000" onChange={(event) => { const color = event.target.value; history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({ ...currentWorkspace, phases: currentWorkspace.phases.map((item) => selectedByType.phase.has(item.id) ? { ...item, color } : item) }))); }} /><code>{selectedByType.phase.size} phase(s)</code></div></Field>
          <div className="inline-actions"><Button variant="secondary" onClick={() => history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({ ...currentWorkspace, phases: currentWorkspace.phases.map((item) => selectedByType.phase.has(item.id) ? { ...item, inAnnot: true, inPanel: true } : item) })))}>Activer annotations et panneau</Button></div>
          <SelectField label="Déplacer vers" value={activeMode} onChange={moveSelectionToWorkspace} options={workspaceOptions} />
        </Section>
      )}
      <Section title="Raccourcis" defaultOpen={false}><div className="shortcut-list"><span><kbd>Ctrl/Cmd</kbd> Ajouter ou retirer</span><span><kbd>Shift</kbd> Sélectionner une plage</span><span><kbd>Ctrl/Cmd+A</kbd> Tout sélectionner dans l’onglet</span><span><kbd>{tr("Suppr.")}</kbd> Supprimer la sélection</span></div></Section>
    </>
  ) : activePattern ? (
    <>
      <Section title="Patron sélectionné" targetId="pattern-inspector">
        <TextField targetId="pattern-name" label="Nom" value={activePattern.label} onChange={(value) => updatePattern(activePattern.id, "label", value)} />
        <SelectField label="Espace de travail" value={activeMode} onChange={(value) => moveItemToWorkspace("pattern", activePattern.id, value)} options={workspaceOptions} />
        <div className="two-columns">
          <NumberField label="Facteur Y" value={activePattern.yscale} step={0.05} onChange={(value) => updatePattern(activePattern.id, "yscale", value)} />
          <NumberField label="Décalage X" value={activePattern.xoffset} step={0.01} onChange={(value) => updatePattern(activePattern.id, "xoffset", value)} />
        </div>
        <NumberField label="Décalage Y" hint="Ajustement vertical manuel, ajouté à l'empilement automatique." value={activePattern.yoffset || 0} step={0.05} onChange={(value) => updatePattern(activePattern.id, "yoffset", value)} />
        <Field label="Couleur manuelle">
          <div className="color-field">
            <input type="color" value={activePattern.color} onChange={(event) => updatePattern(activePattern.id, "color", event.target.value)} />
            <code>{activePattern.color}</code>
          </div>
        </Field>
        <Toggle label="Visible" checked={activePattern.visible} onChange={(value) => updatePattern(activePattern.id, "visible", value)} />
        <Section title="Étiquette de courbe" defaultOpen={false} targetId="pattern-label-options">
          <Toggle label="Afficher cette étiquette" checked={activePattern.showLabel !== false} onChange={(value) => updatePattern(activePattern.id, "showLabel", value)} />
          <div className="two-columns"><NumberField label="Décalage horizontal" value={activePattern.labelDx || 0} step={2} suffix="px" onChange={(value) => updatePattern(activePattern.id, "labelDx", value)} /><NumberField label="Décalage vertical" value={activePattern.labelDy || 0} step={2} suffix="px" onChange={(value) => updatePattern(activePattern.id, "labelDy", value)} /></div>
          <NumberField label="Taille individuelle" value={activePattern.labelFontSize || S.patternLabelSize} min={6} max={42} step={0.5} suffix="pt" onChange={(value) => updatePattern(activePattern.id, "labelFontSize", value)} />
          <Toggle label="Gras individuel" checked={activePattern.labelBold ?? S.patternLabelBold} onChange={(value) => updatePattern(activePattern.id, "labelBold", value)} />
          <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({ ...currentWorkspace, patterns: currentWorkspace.patterns.map((pattern) => pattern.id === activePattern.id ? { ...pattern, labelDx: 0, labelDy: 0, labelFontSize: null, labelBold: undefined } : pattern) })))}>Réinitialiser l’étiquette</Button></div>
        </Section>
        <Toggle label="Verrouiller le patron" checked={Boolean(activePattern.locked)} onChange={(value) => updatePattern(activePattern.id, "locked", value)} description="Protège le nom, la courbe, les transformations et la suppression. L’étiquette de courbe reste modifiable." />
        <TextAreaField label="Notes du patron" value={activePattern.userNotes || ""} onChange={(value) => updatePattern(activePattern.id, "userNotes", value)} rows={4} placeholder="Observations expérimentales, préparation, anomalie…" />
        <div className="two-columns">
          <SelectField label="Type de groupe" value={activePattern.groupType || ""} onChange={(value) => updatePattern(activePattern.id, "groupType", value)} options={[["", "Aucun"], ["sample", "Échantillon"], ["time", "Temps"], ["temperature", "Température"], ["treatment", "Traitement"]]} />
          <NumberField label="Valeur d’ordre" value={activePattern.orderValue ?? ""} step={0.1} onChange={(value) => updatePattern(activePattern.id, "orderValue", value)} />
        </div>
        <TextField label="Nom du groupe" value={activePattern.groupName || ""} onChange={(value) => updatePattern(activePattern.id, "groupName", value)} />
        <div className="info-box">
          <span>{activePattern.fileName}</span>
          <span>{activePattern.x.length.toLocaleString(uiLocale())} points</span>
          <span>Plage : {Number(activePattern.x[0]).toLocaleString(uiLocale())} — {Number(activePattern.x.at(-1)).toLocaleString(uiLocale())}</span>
          {activePattern.fileMetadata && <span>Fichier : {formatBytes(activePattern.fileMetadata.size)}{activePattern.fileMetadata.lastModified ? ` · ${new Date(activePattern.fileMetadata.lastModified).toLocaleString(uiLocale())}` : ""}</span>}
          <span>{tr("Traitement")} : {tr(activePattern.processingOverrides?.enabled ? "individuel" : "réglages globaux")} · {tr("lissage")} {activePattern.processingOverrides?.smoothW ?? S.smoothW} · {tr("fond")} {activePattern.processingOverrides?.baselineMode ?? S.baselineMode} · {tr("normalisation")} {activePattern.processingOverrides?.normalizeMode ?? S.normalizeMode}</span>
          {activePattern.isAverage && <span>Patron dérivé : {activePattern.replicateCount} acquisitions · {activePattern.averageMethod === "median" ? "médiane" : "moyenne"}</span>}
          {activePattern.isAverage && <span>Pré-normalisation : {activePattern.averageNormalizeMode || "none"}</span>}
          {activePattern.isAverage && <span>Sources : {(activePattern.sourceFiles || []).join(", ")}</span>}
          {selectedVisibleIndex >= 0 && <span>Position visible : {selectedVisibleIndex + 1}/{visibleCount}</span>}
          {Number.isFinite(activePattern.alignmentScore) && <span>Corrélation d’alignement : {activePattern.alignmentScore.toFixed(4)}</span>}
          {Number.isFinite(activePattern.alignmentShift) && activePattern.alignmentShift !== 0 && <span>Décalage automatique cumulé : {activePattern.alignmentShift.toFixed(4)}</span>}
        </div>
        <div className="inline-actions"><Button variant="secondary" icon="duplicate" onClick={duplicateSelection}>Dupliquer pour une variante</Button><Button variant="secondary" icon="sort" onClick={() => updatePattern(activePattern.id, "orderValue", extractOrderValue(activePattern.fileName || activePattern.label))}>Extraire l’ordre</Button></div>
      </Section>
      <Section title="Traitement individuel" defaultOpen={Boolean(activePattern.processingOverrides?.enabled)}>
        <Toggle label="Remplacer les réglages globaux" checked={Boolean(activePattern.processingOverrides?.enabled)} onChange={(enabled) => updatePattern(activePattern.id, "processingOverrides", enabled ? { enabled: true, smoothW: S.smoothW, clipPct: S.clipPct, baselineMode: S.baselineMode, normalizeMode: S.normalizeMode, showDetectedPeaks: S.showDetectedPeaks, peakMinHeight: S.peakMinHeight, peakMinProminence: S.peakMinProminence, peakMinDistance: S.peakMinDistance, peakLookaround: S.peakLookaround } : { enabled: false })} />
        {activePattern.processingOverrides?.enabled && <>
          <SliderField label="Lissage" value={activePattern.processingOverrides.smoothW ?? S.smoothW} min={1} max={51} step={1} onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, smoothW: Math.round(value) })} />
          <SliderField label="Écrêtage" value={activePattern.processingOverrides.clipPct ?? S.clipPct} min={90} max={100} step={0.1} suffix="%" onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, clipPct: value })} />
          <SelectField label="Ligne de base" value={activePattern.processingOverrides.baselineMode ?? S.baselineMode} onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, baselineMode: value })} options={BASELINE_OPTIONS} />
          <SelectField label="Normalisation" value={activePattern.processingOverrides.normalizeMode ?? S.normalizeMode} onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, normalizeMode: value })} options={NORMALIZATION_OPTIONS} />
          <Field label="Détection de pics (ce patron)" hint="Ces seuils remplacent les réglages globaux du module « Repérage des pics expérimentaux » pour ce patron uniquement.">
            <Toggle label="Marqueurs de pics" checked={activePattern.processingOverrides.showDetectedPeaks ?? S.showDetectedPeaks} onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, showDetectedPeaks: value })} />
          </Field>
          <SliderField label="Hauteur minimale" value={activePattern.processingOverrides.peakMinHeight ?? S.peakMinHeight} min={0} max={100} step={1} suffix="%" onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, peakMinHeight: value })} />
          <SliderField label="Proéminence minimale" value={activePattern.processingOverrides.peakMinProminence ?? S.peakMinProminence} min={0} max={100} step={0.5} suffix="%" onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, peakMinProminence: value })} />
          <NumberField label="Distance minimale X" value={activePattern.processingOverrides.peakMinDistance ?? S.peakMinDistance} min={0} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, peakMinDistance: value })} />
          <SliderField label="Fenêtre de proéminence" value={activePattern.processingOverrides.peakLookaround ?? S.peakLookaround} min={2} max={250} step={1} suffix="pts" onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, peakLookaround: Math.round(value) })} />
        </>}
      </Section>
    </>
  ) : activePhase ? (
    <>
      <Section title="Phase sélectionnée" targetId="phase-inspector">
        <TextField targetId="phase-name" label="Nom affiché" value={activePhase.name} onChange={(value) => updatePhase(activePhase.id, "name", value)} />
        <TextField label="Abréviation" value={activePhase.abbrev} onChange={(value) => updatePhase(activePhase.id, "abbrev", value)} />
        <TextField label="Sous-titre de ligne" value={phaseSubtitle(activePhase)} onChange={(value) => updatePhase(activePhase.id, "subtitle", value)} />
        <Toggle label="Afficher le sous-titre" checked={activePhase.showSubtitle !== false} onChange={(value) => updatePhase(activePhase.id, "showSubtitle", value)} />
        <SelectField label="Espace de travail" value={activeMode} onChange={(value) => moveItemToWorkspace("phase", activePhase.id, value)} options={workspaceOptions} />
        <Field label="Couleur">
          <div className="color-field">
            <input type="color" value={activePhase.color} onChange={(event) => updatePhase(activePhase.id, "color", event.target.value)} />
            <code>{activePhase.color}</code>
          </div>
        </Field>
        <Toggle label="Visible" checked={activePhase.visible} onChange={(value) => updatePhase(activePhase.id, "visible", value)} />
        <Toggle label="Annotations supérieures" checked={activePhase.inAnnot} onChange={(value) => updatePhase(activePhase.id, "inAnnot", value)} />
        <Toggle label="Annotations en pointillés" checked={isPhaseDashed(activePhase, "annotation")} onChange={(value) => updatePhase(activePhase.id, "annotationDashed", value)} description="Affecte uniquement les traits des annotations placées au-dessus de la figure." />
        <div className="two-columns"><NumberField label="Taille des annotations" value={activePhase.labelFontSize || S.annotFontSize} min={5} max={30} step={0.5} suffix="pt" onChange={(value) => updatePhase(activePhase.id, "labelFontSize", value)} /><Toggle label="Annotations en gras" checked={activePhase.labelBold ?? S.annotFontBold} onChange={(value) => updatePhase(activePhase.id, "labelBold", value)} /></div>
        <Toggle label="Panneau de références" checked={activePhase.inPanel} onChange={(value) => updatePhase(activePhase.id, "inPanel", value)} />
        <Toggle label="Panneau en pointillés" checked={isPhaseDashed(activePhase, "panel")} onChange={(value) => updatePhase(activePhase.id, "panelDashed", value)} description="Affecte uniquement les bâtonnets du panneau de références." />
        <Toggle label="Superposer sur la figure" checked={Boolean(activePhase.inOverlay)} onChange={(value) => updatePhase(activePhase.id, "inOverlay", value)} />
        <Toggle label="Références sur la figure en pointillés" checked={isPhaseDashed(activePhase, "overlay")} onChange={(value) => updatePhase(activePhase.id, "overlayDashed", value)} description="Affecte les bâtonnets et leur échantillon de légende sur la figure." />
        <div className="two-columns"><NumberField label="Décalage label X" value={activePhase.labelOffsetX || 0} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => updatePhase(activePhase.id, "labelOffsetX", value)} /><NumberField label="Décalage label Y" value={activePhase.labelOffsetY || 0} step={0.05} onChange={(value) => updatePhase(activePhase.id, "labelOffsetY", value)} /></div>
        <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => { updatePhase(activePhase.id, "labelOffsetX", 0); updatePhase(activePhase.id, "labelOffsetY", 0); }}>Réinitialiser la position des labels</Button></div>
        <div className="info-box">
          <span>{activePhase.peaks.length} pics</span>
          <span>{activePhase.files.join(", ")}</span>
          {activePhase.metadata?.RRUFFID && <span>RRUFF : {activePhase.metadata.RRUFFID}</span>}
          {activePhase.metadata?.["RAMAN WAVELENGTH"] && <span>Laser : {activePhase.metadata["RAMAN WAVELENGTH"]} nm</span>}
          {activePhase.metadata?.["IDEAL CHEMISTRY"] && <span>{activePhase.metadata["IDEAL CHEMISTRY"]}</span>}
        </div>
      </Section>
      {activePhase.sourceKind === "raman-spectrum" && activePhase.referenceSpectrum && (
        <Section title="Extraction des pics Raman">
          <SliderField label="Lissage" value={activePhase.ramanOptions?.smoothWindow ?? 7} min={1} max={31} step={2} suffix="pts" onChange={(value) => updatePhase(activePhase.id, "ramanOptions", { ...(activePhase.ramanOptions || {}), smoothWindow: Math.round(value) })} />
          <SliderField label="Proéminence minimale" value={activePhase.ramanOptions?.minProminencePct ?? 1} min={0.1} max={10} step={0.1} suffix="%" onChange={(value) => updatePhase(activePhase.id, "ramanOptions", { ...(activePhase.ramanOptions || {}), minProminencePct: value })} />
          <SliderField label="Hauteur minimale" value={activePhase.ramanOptions?.minHeightPct ?? 1} min={0} max={10} step={0.1} suffix="%" onChange={(value) => updatePhase(activePhase.id, "ramanOptions", { ...(activePhase.ramanOptions || {}), minHeightPct: value })} />
          <NumberField label="Distance minimale" value={activePhase.ramanOptions?.minDistance ?? 5} min={0} step={0.5} suffix="cm⁻¹" onChange={(value) => updatePhase(activePhase.id, "ramanOptions", { ...(activePhase.ramanOptions || {}), minDistance: value })} />
          <SliderField label="Nombre maximal" value={activePhase.ramanOptions?.maxCount ?? 30} min={3} max={80} step={1} onChange={(value) => updatePhase(activePhase.id, "ramanOptions", { ...(activePhase.ramanOptions || {}), maxCount: Math.round(value) })} />
          <div className="inline-actions"><Button variant="primary" onClick={() => recalculateRamanPhase(activePhase)}>Recalculer les pics</Button></div>
          <div className="callout">{tr("Les fichiers Raman RRUFF sont lus comme des spectres continus. Seuls les maxima répondant à ces critères sont transformés en bâtonnets de référence.")}</div>
        </Section>
      )}
      <Section title="Édition manuelle des pics" defaultOpen={activePhase.sourceKind === "manual"}>
        <PhasePeaksEditor phase={activePhase} onApply={(peaks) => applyPhasePeaks(activePhase.id, peaks)} />
      </Section>
    </>
  ) : activeZone ? (
    <Section title="Zone sélectionnée" targetId="zone-inspector">
      <TextField targetId="zone-name" label="Nom" value={activeZone.name} onChange={(value) => updateZone(activeZone.id, "name", value)} />
      <div className="two-columns">
        <NumberField label="X min" value={activeZone.xmin} step={1} suffix="cm⁻¹" onChange={(value) => updateZone(activeZone.id, "xmin", value)} />
        <NumberField label="X max" value={activeZone.xmax} step={1} suffix="cm⁻¹" onChange={(value) => updateZone(activeZone.id, "xmax", value)} />
      </div>
      <Field label="Couleur"><div className="color-field"><input type="color" value={activeZone.color} onChange={(event) => updateZone(activeZone.id, "color", event.target.value)} /><code>{activeZone.color}</code></div></Field>
      <SliderField label="Opacité" value={activeZone.opacity ?? 0.12} min={0.02} max={0.5} step={0.01} onChange={(value) => updateZone(activeZone.id, "opacity", value)} />
      <Toggle label="Visible" checked={activeZone.visible} onChange={(value) => updateZone(activeZone.id, "visible", value)} />
      <Toggle label="Afficher le nom" checked={activeZone.showLabel !== false} onChange={(value) => updateZone(activeZone.id, "showLabel", value)} />
      <NumberField label="Taille du nom" value={activeZone.labelFontSize || S.zoneLabelFontSize} min={5} max={30} step={0.5} suffix="pt" onChange={(value) => updateZone(activeZone.id, "labelFontSize", value)} />
      <Toggle label="Nom en gras" checked={activeZone.labelFontBold ?? S.zoneLabelFontBold} onChange={(value) => updateZone(activeZone.id, "labelFontBold", value)} />
    </Section>
  ) : activeNote ? (
    <Section title="Note sélectionnée" targetId="note-inspector">
      <TextAreaField targetId="note-text" label="Texte" rows={3} value={String(activeNote.text ?? "Annotation")} onChange={(value) => updateNote(activeNote.id, "text", value)} hint="Un retour à la ligne crée une nouvelle ligne sur la figure." />
      <div className="two-columns">
        <NumberField label="Position X" value={finiteNumber(activeNote.x, (S.xmin + S.xmax) / 2)} step={0.05} onChange={(value) => updateNote(activeNote.id, "x", value)} />
        <NumberField label="Position Y" value={clamp(finiteNumber(activeNote.yFrac, 0.72), 0, 1)} min={0} max={1} step={0.01} onChange={(value) => updateNote(activeNote.id, "yFrac", value)} />
      </div>
      <div className="two-columns">
        <NumberField label="Taille" value={clamp(finiteNumber(activeNote.fontSize, 10), 5, 60)} min={5} max={40} step={0.5} onChange={(value) => updateNote(activeNote.id, "fontSize", value)} />
        <NumberField label="Rotation" value={clamp(finiteNumber(activeNote.rotation, 0), -180, 180)} min={-180} max={180} step={5} suffix="°" onChange={(value) => updateNote(activeNote.id, "rotation", value)} />
      </div>
      <Field label="Couleur"><div className="color-field"><input type="color" value={safeNoteModel(activeNote, S.xmin, S.xmax).color} onChange={(event) => updateNote(activeNote.id, "color", event.target.value)} /><code>{activeNote.color}</code></div></Field>
      <Toggle label="Texte en gras" checked={Boolean(activeNote.bold)} onChange={(value) => updateNote(activeNote.id, "bold", value)} />
      <Toggle label="Visible" checked={activeNote.visible !== false} onChange={(value) => updateNote(activeNote.id, "visible", value)} /><Toggle label="Ligne verticale" checked={activeNote.vline} onChange={(value) => updateNote(activeNote.id, "vline", value)} />
      <Toggle label="Ligne d'accroche" checked={Boolean(activeNote.anchorLine)} onChange={(value) => {
        // À l'activation, l'extrémité démarre juste sous la note, dans la
        // fenêtre visible, pour être saisissable immédiatement.
        history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
          ...currentWorkspace,
          notes: currentWorkspace.notes.map((note) => note.id === activeNote.id ? {
            ...note,
            anchorLine: value,
            anchorX: value && (note.anchorX === null || note.anchorX === undefined || note.anchorX < viewXMin || note.anchorX > viewXMax)
              ? clamp(Number(note.x), viewXMin, viewXMax)
              : note.anchorX,
            anchorYFrac: value && !Number.isFinite(Number(note.anchorYFrac)) ? clamp(finiteNumber(note.yFrac, 0.5) - 0.18, 0, 1) : (Number.isFinite(Number(note.anchorYFrac)) ? note.anchorYFrac : 0.5),
          } : note),
        })));
      }} description="Trait de la note vers un point de la figure. Sélectionner la note puis glisser l'extrémité sur le pic visé ; elle s'aimante aux pics détectés." />
      {activeNote.vline && <div className="two-columns">
        <SliderField label="Extrémité haute" value={Math.round((activeNote.vlineTopFrac ?? 1) * 100)} min={0} max={100} step={1} suffix="%" onChange={(value) => updateNote(activeNote.id, "vlineTopFrac", clamp(value / 100, 0, 1))} />
        <SliderField label="Extrémité basse" value={Math.round((activeNote.vlineBottomFrac ?? 0) * 100)} min={0} max={100} step={1} suffix="%" onChange={(value) => updateNote(activeNote.id, "vlineBottomFrac", clamp(value / 100, 0, 1))} />
      </div>}
    </Section>
  ) : (
    <>
      <Section title="Projet actif">
        <TextField label="Nom du projet" value={project.name || ""} onChange={(value) => history.set((current) => ({ ...current, name: value, updatedAt: Date.now() }), { replace: true })} />
        <TextAreaField label="Description" value={project.description || ""} onChange={(value) => history.set((current) => ({ ...current, description: value, updatedAt: Date.now() }), { replace: true })} rows={3} placeholder={tr("Objet de la série, conditions expérimentales…")} />
        <div className="project-stats-grid">{MODES.map((mode) => <span key={mode}><strong>{workspaceStats[mode].total}</strong>{modeLabel(mode)}</span>)}<span><strong>{patterns.length + phases.length}</strong>{tr("éléments actifs")}</span><span><strong>{new Date(project.updatedAt || Date.now()).toLocaleDateString(uiLocale())}</strong>{tr("mise à jour")}</span></div>
        <div className="inline-actions"><Button variant="primary" icon="plus" onClick={createNewProject}>Nouveau projet</Button><Button variant="secondary" icon="duplicate" onClick={duplicateCurrentProject}>Dupliquer</Button></div>
      </Section>
      <Section title="Disposition de l’interface">
        <SelectField label="Densité" value={uiDensity} onChange={setUiDensity} options={[["compact", "Compacte"], ["standard", "Standard"], ["comfortable", "Confortable"]]} />
        <Toggle label="Panneau de données" checked={!leftCollapsed} onChange={(value) => setLeftCollapsed(!value)} />
        <Toggle label="Panneau de propriétés" checked={!rightCollapsed} onChange={(value) => setRightCollapsed(!value)} />
        <Toggle label="Réduire les animations" checked={reduceMotion} onChange={setReduceMotion} />
        <div className="inline-actions"><Button variant="secondary" icon="layout" onClick={resetLayout}>Réinitialiser la disposition</Button></div>
      </Section>
      <Section title="Interaction avec la figure" defaultOpen={false}>
        <Toggle label="Accrochage aux pics" checked={snapToPeak} onChange={setSnapToPeak} />
        <Toggle label="Navigateur de plage" checked={showNavigator} onChange={setShowNavigator} />
        <Toggle label="Comparaison brut / traité" checked={comparisonView} onChange={setComparisonView} />
        <Toggle label="Édition plein écran" checked={editorFullscreen} onChange={setEditorFullscreen} />
        <div className="callout">Cliquer un texte ouvre ses contrôles directs. Glisser les étiquettes, notes, légendes et encarts pour les repositionner. Les raccourcis V, H, P, Z et N changent d’outil.</div>
      </Section>
      <EmptyPanel kind="selection" title="Inspecteur contextuel" body="Sélectionner un ou plusieurs éléments. Ctrl/Cmd ajoute à la sélection ; Shift sélectionne une plage." />
    </>
  );

  return (
    <div className={`app-shell mode-${activeMode} density-${uiDensity} ${reduceMotion ? "reduce-motion" : ""} ${editorFullscreen ? "is-editor-fullscreen" : ""}`}>
      <header className="topbar masthead">
        <div className="masthead__edition">
          <span>Make Figure</span>
          <span>{project.name || "Projet sans titre"}</span>
          <span className={`autosave-state autosave-state--${autosaveState}`}>
            <i />
            {autosaveState === "saving" ? tr("Enregistrement") : autosaveState === "error" ? tr("Autosauvegarde indisponible") : tr("Sauvegardé localement")}
          </span>
        </div>

        <div className="masthead__main">
          <div className="brand">
            <Logo />
            <div className="brand__copy">
              <strong>Make Figure</strong>
            </div>
          </div>

          <div className={`mode-switch is-${activeMode}`} aria-label="Mode d’analyse">
            <span className="mode-switch__indicator" />
            {[["drx", "DRX", "xray"], ["raman", "Raman", "waveform"], ["ir", "IR", "infrared"]].map(([value, label, icon]) => (
              <button type="button" key={value} className={activeMode === value ? "is-active" : ""} onClick={() => setMode(value)}>
                <Icon name={icon} size={13} /><span>{label}</span><small>{workspaceStats[value].total}</small>
              </button>
            ))}
          </div>

          <div className="masthead__actions">
            <div className="topbar__group topbar__group--history">
              <IconButton icon="undo" title="Annuler · Ctrl+Z" disabled={!history.canUndo} onClick={history.undo} />
              <IconButton icon="redo" title="Rétablir · Ctrl+Shift+Z" disabled={!history.canRedo} onClick={history.redo} />
            </div>
            <div className="topbar__group topbar__group--project">
              <ProjectSwitcher
                project={project}
                entries={projectIndex}
                open={projectMenuOpen}
                search={projectSearch}
                setSearch={setProjectSearch}
                onToggle={() => setProjectMenuOpen((value) => !value)}
                onSwitch={switchProject}
                onCreate={createNewProject}
                onRename={renameCurrentProject}
                onDuplicate={duplicateCurrentProject}
                onDelete={deleteCurrentProject}
                onExport={saveSessionFile}
                menuRef={projectMenuRef}
              />
              <IconButton icon="folder" title="Importer une session JSON · Ctrl+O" onClick={() => sessionInputRef.current?.click()} />
            </div>
            <div className="topbar__group topbar__group--export">
              <button
                type="button"
                className="button button--ghost"
                title={language === "fr" ? "Switch the interface to English" : "Switch the interface to French"}
                onClick={() => setLanguage((value) => (value === "fr" ? "en" : "fr"))}
              >{language === "fr" ? "FR" : "EN"}</button>
              <IconButton icon={reduceMotion ? "motionOff" : "motion"} active={reduceMotion} title={reduceMotion ? "Animations réduites" : "Réduire les animations"} onClick={() => setReduceMotion((value) => !value)} />
              <Button variant="primary" icon="preview" disabled={isExporting} onClick={() => openExportPreview("png")}>{isExporting ? "Export…" : "Prévisualiser l’export"}</Button>
            </div>
          </div>
        </div>

        <div className="masthead__ticker" aria-label={tr("Résumé du projet actif")}>
          <span className="masthead__breaking">{modeLabel(activeMode)}</span>
          <span><b>{patterns.length}</b> {tr("patrons")}</span>
          <span><b>{phases.length}</b> {tr("phases")}</span>
          {supportsZones && <span><b>{zones.length}</b> {tr("zones")}</span>}
          <span><b>{notes.length}</b> {tr("notes")}</span>
        </div>
      </header>

      <main className="workbench" style={{ gridTemplateColumns: `${leftCollapsed ? 0 : leftWidth}px minmax(300px, 1fr) ${rightCollapsed ? 0 : rightWidth}px` }}>
        <aside className={`side-panel side-panel--left ${leftCollapsed ? "is-collapsed" : ""}`} aria-hidden={leftCollapsed}>
          <div className="panel-titlebar"><div><strong>{tr("Données")} · {modeLabel(activeMode)}</strong><span>{patterns.length + phases.length + notes.length + zones.length} {tr("éléments")}</span></div><IconButton icon="panelLeft" title="Replier le panneau de données" onClick={() => setLeftCollapsed(true)} /></div>
          <nav className="panel-tabs">
            {[
              ["patterns", "Patrons", patterns.length],
              ["phases", "Phases", phases.length],
              ...(supportsZones ? [["zones", "Zones", zones.length]] : []),
              ["notes", "Notes", notes.length],
            ].map(([value, label, count]) => (
              <button type="button" key={value} className={leftTab === value ? "is-active" : ""} onClick={() => setLeftTab(value)}><Icon name={value === "patterns" ? "waveform" : value === "phases" ? "phase" : value === "zones" ? "zone" : "note"} size={12} />{tr(label)}<span>{count}</span></button>
            ))}
          </nav>
          <BulkActionBar
            count={selectionCount}
            onSelectAll={selectAllCurrentTab}
            onShow={() => setSelectedVisibility(true)}
            onHide={() => setSelectedVisibility(false)}
            onDuplicate={duplicateSelection}
            onLock={selectedByType.pattern.size ? () => setSelectedLock(true) : null}
            onUnlock={selectedByType.pattern.size ? () => setSelectedLock(false) : null}
            onDelete={removeSelection}
            onClear={clearSelection}
          />
          {(leftTab !== "patterns" || patterns.length > 0) && <div className="project-filter"><Icon name="cursor" size={12} /><input value={listFilter} onChange={(event) => setListFilter(event.target.value)} placeholder={tr("Filtrer la liste active…")} /><kbd>Ctrl+A</kbd></div>}
          <div className="side-panel__content">
            {leftTab === "patterns" && (
              <>
                <button type="button" className="drop-button" onClick={() => patternInputRef.current?.click()}><span className="drop-button__asset"><Icon name="waveform" /></span><span><strong>{tr("Importer des patrons")}</strong><small>.xy · .txt · .csv · .dat · .xml OPUS</small></span><Icon name="upload" size={14} /></button>
                {patterns.length > 0 && <div className="pattern-organizer">
                  <div className="pattern-organizer__row">
                    <label><span><Icon name="sort" size={12} /> {tr("Trier")}</span><select value={patternSort.key} onChange={(event) => setPatternSort((current) => ({ ...current, key: event.target.value }))}><option value="manual">{tr("Ordre manuel")}</option><option value="filename">{tr("Nom du fichier")}</option><option value="date">{tr("Date du fichier")}</option><option value="numeric">{tr("Valeur numérique")}</option><option value="group">{tr("Groupe")}</option></select></label>
                    <button type="button" className="organizer-direction" onClick={() => setPatternSort((current) => ({ ...current, direction: current.direction === "asc" ? "desc" : "asc" }))}>{patternSort.direction === "asc" ? "↑" : "↓"}</button>
                    <Button variant="secondary" disabled={patternSort.key === "manual"} onClick={sortPatterns}>Appliquer</Button>
                  </div>
                  <div className="pattern-organizer__row">
                    <label><span><Icon name="group" size={12} /> {tr("Grouper l’affichage")}</span><select value={groupViewBy} onChange={(event) => setGroupViewBy(event.target.value)}><option value="none">{tr("Aucun")}</option><option value="group">{tr("Tous les groupes")}</option><option value="sample">{tr("Échantillon")}</option><option value="time">{tr("Temps")}</option><option value="temperature">{tr("Température")}</option><option value="treatment">{tr("Traitement")}</option></select></label>
                  </div>
                </div>}
                {supportsAveraging && patterns.length > 0 && (
                  <div className="average-builder">
                    <div className="average-builder__header">
                      <div><strong>{tr("Moyenne d’acquisitions")}</strong><span>{ramanAverageSelection.length} {tr("acquisition(s) sélectionnée(s)")}</span></div>
                      <button type="button" onClick={() => setRamanAverageSelection(patterns.filter((pattern) => pattern.visible && !pattern.isAverage).map((pattern) => pattern.id))}>{tr("Sélectionner visibles")}</button>
                    </div>
                    <input type="text" value={ramanAverageLabel} placeholder={tr("Nom du patron moyen")} onChange={(event) => setRamanAverageLabel(event.target.value)} />
                    <div className="average-builder__grid">
                      <label><span>{tr("Agrégation")}</span><select value={S.ramanAverageMethod} onChange={(event) => patchSettings("ramanAverageMethod", event.target.value)}><option value="mean">{tr("Moyenne")}</option><option value="median">{tr("Médiane")}</option></select></label>
                      <label><span>Avant moyenne</span><select value={S.ramanAverageNormalize} onChange={(event) => patchSettings("ramanAverageNormalize", event.target.value)}><option value="none">{tr("Intensités brutes")}</option><option value="max">{tr("Normaliser au maximum")}</option><option value="area">{tr("Normaliser à l’aire")}</option><option value="minmax">{tr("Min–max")}</option></select></label>
                    </div>
                    <Toggle label="Masquer les acquisitions source" checked={S.ramanAverageHideSources} onChange={(value) => patchSettings("ramanAverageHideSources", value)} />
                    <div className="average-builder__actions">
                      <Button variant="secondary" onClick={() => setRamanAverageSelection([])}>Effacer</Button>
                      <Button variant="primary" disabled={ramanAverageSelection.length < 2} onClick={createRamanAverage}>Créer la moyenne</Button>
                    </div>
                    <p>{tr("Les acquisitions sont interpolées sur leur plage commune. Les données sources ne sont pas modifiées.")}</p>
                  </div>
                )}
                <div className="data-list">
                  {filteredPatterns.length ? patternGroups.map((group) => (
                    <section className="pattern-group" key={group.key}>
                      {group.label && <header className="pattern-group__header"><Icon name="group" size={12} /><strong>{group.label}</strong><span>{group.items.length}</span></header>}
                      {group.items.map((pattern) => { const index = patterns.findIndex((item) => item.id === pattern.id); return (
                        <PatternItem
                          key={pattern.id}
                          pattern={pattern}
                          index={index}
                          color={colorMap.get(pattern.id) || pattern.color}
                          selected={isSelected("pattern", pattern.id)}
                          onSelect={(event) => selectItem(event, "pattern", pattern.id)}
                          onUpdate={(key, value) => updatePattern(pattern.id, key, value)}
                          onDelete={() => removeItems([{ type: "pattern", id: pattern.id }])}
                          onDragStart={(event, id) => handleDataDragStart(event, "pattern", id)}
                          onDrop={(event, id) => handleDataDrop(event, "pattern", id)}
                          averageSelectable={supportsAveraging && !pattern.isAverage}
                          averageChecked={ramanAverageSelection.includes(pattern.id)}
                          onAverageToggle={(checked) => toggleRamanAveragePattern(pattern.id, checked)}
                        />
                      ); })}
                    </section>
                  )) : <EmptyPanel kind="pattern" title="Aucun patron" body="Importer des données expérimentales ou déposer les fichiers dans l’espace central." />}
                </div>
              </>
            )}
            {leftTab === "phases" && (
              <>
                <button type="button" className="drop-button" onClick={() => phaseInputRef.current?.click()}><span className="drop-button__asset"><Icon name="phase" /></span><span><strong>{tr("Importer des phases")}</strong><small>{activeMode === "drx" ? ".dif ou liste de pics DRX" : activeMode === "ir" ? "Liste de bandes IR (cm⁻¹)" : "RRUFF ou liste de pics Raman"}</small></span><Icon name="upload" size={14} /></button>
                <div className="manual-builder">
                  <div className="manual-builder__header"><strong>{tr("Ajouter une phase manuellement")}</strong><span>{tr("Positions seules ou position:intensité")}</span></div>
                  <div className="manual-builder__grid">
                    <input type="text" value={manualPhase.name} placeholder="Nom, ex. Vatérite" onChange={(event) => setManualPhase((current) => ({ ...current, name: event.target.value }))} />
                    <input type="text" value={manualPhase.abbrev} placeholder="Abréviation" onChange={(event) => setManualPhase((current) => ({ ...current, abbrev: event.target.value }))} />
                  </div>
                  <textarea rows="4" value={manualPhase.peaks} placeholder="107; 280; 713; 750; 1085\nou 107:40; 280:100; 713:65" onChange={(event) => setManualPhase((current) => ({ ...current, peaks: event.target.value }))} />
                  <div className="manual-builder__footer">
                    <input type="color" value={manualPhase.color} onChange={(event) => setManualPhase((current) => ({ ...current, color: event.target.value }))} />
                    <Button variant="primary" onClick={createManualPhase}>Ajouter la phase</Button>
                  </div>
                </div>
                <div className="data-list">
                  {filteredPhases.length ? filteredPhases.map((phase) => (
                    <PhaseItem
                      key={phase.id}
                      phase={phase}
                      annotationsVisible={S.showAnnotations}
                      panelVisible={S.showPdfPanel}
                      selected={isSelected("phase", phase.id)}
                      onSelect={(event) => selectItem(event, "phase", phase.id)}
                      onUpdate={(key, value) => updatePhase(phase.id, key, value)}
                      onDelete={() => removeItems([{ type: "phase", id: phase.id }])}
                      onAppend={() => { appendTargetRef.current = phase.id; appendPhaseInputRef.current?.click(); }}
                      onDragStart={(event, id) => handleDataDragStart(event, "phase", id)}
                      onDrop={(event, id) => handleDataDrop(event, "phase", id)}
                    />
                  )) : <EmptyPanel kind="phase" title="Aucune phase" body="Importer des fiches .dif ou des listes de pics texte." />}
                </div>
              </>
            )}
            {leftTab === "zones" && (
              <>
                <div className="manual-builder zone-builder">
                  <div className="manual-builder__header"><strong>{tr("Ajouter une zone")}</strong><span>Bandes, vibrations ou domaines d’attribution</span></div>
                  <input type="text" value={zoneDraft.name} placeholder="Nom, ex. ν IO — iode" onChange={(event) => setZoneDraft((current) => ({ ...current, name: event.target.value }))} />
                  <div className="manual-builder__grid">
                    <label><span>X min</span><NumericInput value={zoneDraft.xmin} step={1} onCommit={(value) => setZoneDraft((current) => ({ ...current, xmin: value }))} ariaLabel={tr("X min de la zone")} /></label>
                    <label><span>X max</span><NumericInput value={zoneDraft.xmax} step={1} onCommit={(value) => setZoneDraft((current) => ({ ...current, xmax: value }))} ariaLabel={tr("X max de la zone")} /></label>
                  </div>
                  <div className="manual-builder__footer">
                    <input type="color" value={zoneDraft.color} onChange={(event) => setZoneDraft((current) => ({ ...current, color: event.target.value }))} />
                    <Button variant="primary" onClick={createZone}>Ajouter la zone</Button>
                  </div>
                </div>
                <div className="data-list">
                  {filteredZones.length ? filteredZones.map((zone) => (
                    <ZoneItem
                      key={zone.id}
                      zone={zone}
                      selected={isSelected("zone", zone.id)}
                      onSelect={(event) => selectItem(event, "zone", zone.id)}
                      onUpdate={(key, value) => updateZone(zone.id, key, value)}
                      onDelete={() => removeItems([{ type: "zone", id: zone.id }])}
                    />
                  )) : <EmptyPanel kind="zone" title="Aucune zone" body="Ajouter une plage nommée, par exemple une vibration phosphate, un massif carbonate ou une zone attribuée à l’iode." />}
                </div>
              </>
            )}
            {leftTab === "notes" && (
              <>
                <button type="button" className={`drop-button ${addNoteMode ? "is-active" : ""}`} onClick={() => { setAddNoteMode((value) => !value); setTool("cursor"); }}><span className="drop-button__asset"><Icon name="note" /></span><span><strong>{tr(addNoteMode ? "Cliquer sur la figure…" : "Ajouter une note")}</strong><small>{tr("Placement interactif")}</small></span><Icon name="plus" size={14} /></button>
                <div className="data-list">
                  {filteredNotes.length ? filteredNotes.map((note) => (
                    <NoteItem
                      key={note.id}
                      note={note}
                      selected={isSelected("note", note.id)}
                      onSelect={(event) => selectItem(event, "note", note.id)}
                      onUpdate={(key, value) => updateNote(note.id, key, value)}
                      onDelete={() => removeItems([{ type: "note", id: note.id }])}
                    />
                  )) : <EmptyPanel kind="note" title="Aucune note" body="Activer le placement puis cliquer dans la zone principale de la figure." />}
                </div>
              </>
            )}
          </div>
          {!leftCollapsed && <Resizer side="left" onReset={() => setLeftWidth(310)} onResize={{ currentWidth: () => leftWidth, apply: (value) => setLeftWidth(clamp(value, 250, 560)) }} />}
        </aside>

        <section key={activeMode} className="canvas-column">
          <div className="canvas-toolbar">
            <div className="canvas-toolbar__group canvas-toolbar__group--panels">
              <IconButton icon="panelLeft" title={leftCollapsed ? "Afficher le panneau de données" : "Masquer le panneau de données"} active={!leftCollapsed} onClick={() => setLeftCollapsed((value) => !value)} />
              <IconButton icon="panelRight" title={rightCollapsed ? "Afficher le panneau de propriétés" : "Masquer le panneau de propriétés"} active={!rightCollapsed} onClick={() => setRightCollapsed((value) => !value)} />
              <IconButton icon="layout" title="Réinitialiser la disposition" onClick={resetLayout} />
            </div>
            <div className="canvas-toolbar__divider" />
            <div className="canvas-toolbar__group">
              <IconButton icon="cursor" title="Sélection · V" active={tool === "cursor"} onClick={() => setTool("cursor")} />
              <IconButton icon="hand" title="Déplacer la feuille · H ou espace" active={tool === "hand"} onClick={() => setTool("hand")} />
              <IconButton icon="zoomRect" title="Zoom rectangle sur l’axe X · Z" active={tool === "zoomRect"} onClick={() => setTool((value) => value === "zoomRect" ? "cursor" : "zoomRect")} />
              <IconButton icon="tag" title="Édition des pics · clic sur une courbe = ajouter, clic sur un marqueur ou sa valeur = retirer" active={tool === "peaks"} onClick={() => setTool((value) => value === "peaks" ? "cursor" : "peaks")} />
              <IconButton icon="magnet" title="Accrochage aux pics" active={snapToPeak} onClick={() => setSnapToPeak((value) => !value)} />
              <IconButton icon="ruler" title="Guides d’alignement (magnétisme des labels et notes)" active={magnetAlign} onClick={() => setMagnetAlign((value) => !value)} />
            </div>
            <div className="canvas-toolbar__divider" />
            <div className="canvas-toolbar__group">
              <IconButton icon="zoomOut" title="Réduire" onClick={() => setZoom((value) => clamp(value / 1.15, 0.2, 3))} />
              <button type="button" className="zoom-readout" onClick={() => setZoom(1)}>{Math.round(zoom * 100)} %</button>
              <IconButton icon="zoomIn" title="Agrandir" onClick={() => setZoom((value) => clamp(value * 1.15, 0.2, 3))} />
              <IconButton icon="fit" title="Ajuster à l’espace" onClick={fitToWorkspace} />
            </div>
            <div className="canvas-toolbar__divider" />
            <div className="canvas-toolbar__group">
              <IconButton icon="compare" title="Comparer données brutes et traitées" active={comparisonView} onClick={() => setComparisonView((value) => !value)} />
              <IconButton icon="layout" title="Afficher le navigateur de plage" active={showNavigator} onClick={() => setShowNavigator((value) => !value)} />
              <IconButton icon={editorFullscreen ? "fullscreenExit" : "fullscreen"} title={editorFullscreen ? "Quitter le mode plein écran" : "Mode édition plein écran"} active={editorFullscreen} onClick={() => setEditorFullscreen((value) => !value)} />
            </div>
            <div className="canvas-toolbar__divider" />
            <div className="canvas-toolbar__spacer" />
          </div>

          {showNavigator && visibleCount > 0 && (
            <RangeNavigator
              patterns={patterns}
              fullRange={fullXRange}
              xmin={viewXMin}
              xmax={viewXMax}
              axisMode={activeMode === "drx" ? (S.xAxisMode || "2theta") : "native"}
              wavelength={Number(S.wavelength) || 1.5406}
              unitLabel={primaryAxisUnit}
              reversed={Boolean(S.reverseXAxis)}
              onPreview={(xmin, xmax, mode) => {
                if (xmin === null) setDragPreview((current) => current?.type === "rangeNavigator" ? null : current);
                else setDragPreview({ type: "rangeNavigator", mode, xmin, xmax });
              }}
              onCancel={() => setDragPreview((current) => current?.type === "rangeNavigator" ? null : current)}
              onCommit={(xmin, xmax) => {
                setDragPreview((current) => current?.type === "rangeNavigator" ? null : current);
                history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
                  ...currentWorkspace,
                  settings: { ...currentWorkspace.settings, xmin, xmax, viewYMin: null, viewYMax: null },
                })));
              }}
            />
          )}

          <div
            ref={workspaceRef}
            className={`workspace ${tool === "hand" ? "is-pannable" : ""} ${dropActive ? "is-drop-active" : ""}`}
            onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDropActive(true); } }}
            onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropActive(false); }}
            onDrop={handleFileDrop}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={stopPan}
            onPointerCancel={stopPan}
            onWheel={workspaceWheel}
          >
            {dropActive && <div className="drop-overlay"><div className="drop-overlay__asset"><WorkspaceIllustration mode={activeMode} compact /></div><Icon name="upload" size={24} /><strong>Déposer les fichiers</strong><span>{tr(".dif → DRX · RRUFF Raman → Raman · .xml OPUS → IR · autres fichiers → espace actif.")}</span></div>}
            {!visibleCount ? (
              <div className="welcome-card">
                <div className="welcome-card__visual"><WorkspaceIllustration mode={activeMode} /></div>
                <span className="welcome-card__eyebrow"><Icon name="sparkles" size={12} /> Espace {modeLabel(activeMode)}</span>
                <h1>{activeMode === "drx" ? "Composer une figure de diffraction" : activeMode === "ir" ? "Composer une figure infrarouge" : "Composer une figure Raman"}</h1>
                <p>Importer les acquisitions, ajouter les références, appliquer le traitement du signal puis produire une figure scientifique prête à publier.</p>
                <div className="welcome-card__actions">
                  <Button variant="primary" icon="upload" onClick={() => patternInputRef.current?.click()}>{tr("Importer des patrons")}</Button>
                  <Button variant="secondary" icon="phase" onClick={() => phaseInputRef.current?.click()}>Ajouter des phases</Button>
                  <Button variant="secondary" icon="sparkles" onClick={loadSampleData}>Jeu d’exemple</Button>
                </div>
                <div className="welcome-card__privacy"><Icon name="check" size={12} /> Traitement exclusivement local dans le navigateur.</div>
              </div>
            ) : (
              <div className={`page-stage ${comparisonView ? "is-comparison" : ""}`} style={{ width: comparisonView ? W * displayZoom * 2 + 24 : W * displayZoom, height: H * displayZoom }}>
                {comparisonView && (
                  <div className="figure-page figure-page--raw" style={{ width: W * displayZoom, height: H * displayZoom }}>
                    <RawComparisonPreview data={rawProcessed} colors={colorMap} width={W} height={H} xmin={viewXMin} xmax={viewXMax} />
                  </div>
                )}
                <div className="figure-page" style={{ width: W * displayZoom, height: H * displayZoom }}>
                  {textTarget && textTargetStyle && <div className="figure-text-toolbar" data-ui-only="true" onPointerDown={(event) => event.stopPropagation()}>
                    <span title={textTarget.label}>{truncateLabel(textTarget.label, 22)}</span>
                    <button type="button" title="Réduire le texte" onClick={() => updateTextTargetStyle("size", clamp(textTargetStyle.size - 0.5, 5, 60))}>−</button>
                    <input type="number" min="5" max="60" step="0.5" value={textTargetStyle.size} aria-label={`Taille · ${textTarget.label}`} onChange={(event) => updateTextTargetStyle("size", clamp(Number(event.target.value), 5, 60))} />
                    <button type="button" title="Agrandir le texte" onClick={() => updateTextTargetStyle("size", clamp(textTargetStyle.size + 0.5, 5, 60))}>+</button>
                    <button type="button" className={textTargetStyle.bold ? "is-active" : ""} aria-pressed={textTargetStyle.bold} title="Gras" onClick={() => updateTextTargetStyle("bold", !textTargetStyle.bold)}><strong>B</strong></button>
                    <button type="button" title="Fermer les contrôles de texte" onClick={() => setTextTarget(null)}>×</button>
                  </div>}
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${W} ${H}`}
                    width={W * displayZoom}
                    height={H * displayZoom}
                    xmlns="http://www.w3.org/2000/svg"
                    className={`${addNoteMode ? "is-adding-note" : ""} tool-${tool}`}
                    onPointerDown={onSvgPointerDown}
                    onPointerMove={onSvgPointerMove}
                    onPointerUp={finishSvgInteraction}
                    onPointerCancel={finishSvgInteraction}
                    onPointerLeave={() => setCursor(null)}
                    onClick={onSvgClick}
                  >
                    <rect data-figure-background x="0" y="0" width={W} height={H} fill={S.pageBackground} />

                    {S.title && <text x={M.left + plotWidth / 2} y={M.top - 17} textAnchor="middle" fontSize={S.titleFontSize} fontWeight={S.titleFontBold ? "700" : "400"} fill="#15191f" fontFamily={figureFont} style={{ cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Titre", sizeKey: "titleFontSize", boldKey: "titleFontBold" })} onDoubleClick={(event) => openContextOptions(event, { tab: "appearance", target: "figure-title" })}>{S.title}</text>}

                    {S.figureLayoutMode === "single" && supportsZones && zones.filter((zone) => zone.visible && Number(zone.xmax) > viewXMin && Number(zone.xmin) < viewXMax).map((zone) => {
                      const previewMin = dragPreview?.type === "zoneBoundary" && dragPreview.id === zone.id && dragPreview.edge === "min" ? dragPreview.x : Number(zone.xmin);
                      const previewMax = dragPreview?.type === "zoneBoundary" && dragPreview.id === zone.id && dragPreview.edge === "max" ? dragPreview.x : Number(zone.xmax);
                      const start = Math.max(viewXMin, previewMin);
                      const end = Math.min(viewXMax, previewMax);
                      // L’axe pouvant être inversé, on ordonne les bornes en pixels.
                      const x = Math.min(xToPx(start), xToPx(end));
                      const width = Math.abs(xToPx(end) - xToPx(start));
                      const selected = isSelected("zone", zone.id);
                      return (
                        <g key={`zone-${zone.id}`} opacity={selected ? 1 : 0.94} onClick={(event) => selectItem(event, "zone", zone.id)} onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "zone", id: zone.id, target: "zone-name" })} style={{ cursor: "pointer" }}>
                          <rect x={x} y={M.top} width={width} height={mainHeight} fill={zone.color} opacity={zone.opacity ?? 0.12} />
                          {zone.showLabel !== false && width > 12 && <text x={x + width / 2} y={M.top + 14} textAnchor="middle" fontSize={finiteNumber(zone.labelFontSize, S.zoneLabelFontSize)} fontWeight={(zone.labelFontBold ?? S.zoneLabelFontBold) ? "700" : "400"} fill={zone.color} fontFamily={figureFont} onClick={(event) => activateTextTarget(event, { kind: "zone", id: zone.id, label: `Zone · ${zone.name}`, sizeKey: "labelFontSize", boldKey: "labelFontBold", fallbackSizeKey: "zoneLabelFontSize", fallbackBoldKey: "zoneLabelFontBold" })}>{zone.name}</text>}
                          {selected && <g data-ui-only="true">
                            <line x1={x} x2={x} y1={M.top} y2={M.top + mainHeight} stroke={zone.color} strokeWidth="2.2" opacity="0.8" style={{ cursor: "ew-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "zoneBoundary", { id: zone.id, edge: "min" })} />
                            <line x1={x + width} x2={x + width} y1={M.top} y2={M.top + mainHeight} stroke={zone.color} strokeWidth="2.2" opacity="0.8" style={{ cursor: "ew-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "zoneBoundary", { id: zone.id, edge: "max" })} />
                            <rect x={x - 4} y={M.top + mainHeight / 2 - 12} width="8" height="24" rx="4" fill={zone.color} opacity="0.85" style={{ cursor: "ew-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "zoneBoundary", { id: zone.id, edge: "min" })} />
                            <rect x={x + width - 4} y={M.top + mainHeight / 2 - 12} width="8" height="24" rx="4" fill={zone.color} opacity="0.85" style={{ cursor: "ew-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "zoneBoundary", { id: zone.id, edge: "max" })} />
                          </g>}
                        </g>
                      );
                    })}

                    {S.figureLayoutMode === "single" && S.showGrid && xTickObjects.map((tick) => (
                      <line key={`grid-${tick.x}`} x1={xToPx(tick.x)} x2={xToPx(tick.x)} y1={M.top} y2={M.top + mainHeight + (panelHeight ? M.gap + panelHeight : 0)} stroke="#cfd4da" strokeWidth="0.65" opacity={S.gridOpacity} />
                    ))}

                    <defs>
                      <clipPath id="plot-clip">
                        <rect x={M.left} y={M.top} width={plotWidth} height={mainHeight} />
                      </clipPath>
                    </defs>

                    {S.figureLayoutMode === "single" ? (
                      processed.map((pattern) => {
                      if (!pattern.px?.length) return null;
                      const offset = pattern.stackOffset;
                      const color = colorMap.get(pattern.id) || "#111111";
                      const path = buildCurvePath(pattern.px, pattern.py, offset);
                      const baselineY = yToPx(offset);
                      const fillPath = `${path}L${xToPx(pattern.px.at(-1)).toFixed(2)},${baselineY.toFixed(2)}L${xToPx(pattern.px[0]).toFixed(2)},${baselineY.toFixed(2)}Z`;
                      const labelY = labelYForPattern(pattern);
                      const showPeaks = tool === "peaks" || (pattern.effectiveSettings?.showDetectedPeaks ?? S.showDetectedPeaks);
                      const labelledPeaks = [...(pattern.detectedPeaks || [])]
                        .sort((a, b) => (b.prominence ?? 0) - (a.prominence ?? 0))
                        .slice(0, S.peakMaxLabels)
                        .sort((a, b) => a.displayX - b.displayX);
                      return (
                        <g key={pattern.id} opacity={selectedByType.pattern.size && !isSelected("pattern", pattern.id) ? 0.72 : 1}>
                          <g clipPath="url(#plot-clip)">
                            {S.layoutMode === "difference" && <line x1={M.left} x2={M.left + plotWidth} y1={baselineY} y2={baselineY} stroke={color} strokeWidth="0.55" strokeDasharray="3 3" opacity="0.35" />}
                            {S.showFill && !breakActive && <path d={fillPath} fill={color} opacity={S.fillAlpha * (pattern.curveOpacity ?? 1)} />}
                            <path d={path} fill="none" stroke={color} strokeWidth={S.lineWidth} opacity={pattern.curveOpacity ?? 1} vectorEffect="non-scaling-stroke" />
                            {showPeaks && (pattern.detectedPeaks || []).map((peak, peakIndex) => (
                              <circle
                                key={`peak-marker-${pattern.id}-${peakIndex}`}
                                cx={xToPx(peak.displayX)} cy={yToPx(peak.displayY + offset)}
                                r={tool === "peaks" ? Math.max(S.peakMarkerSize, 4) : S.peakMarkerSize}
                                fill={peak.manual ? color : S.pageBackground} stroke={color} strokeWidth="1.1" vectorEffect="non-scaling-stroke"
                                style={tool === "peaks" ? { cursor: "pointer" } : undefined}
                                onClick={tool === "peaks" ? (event) => { event.stopPropagation(); removePeak(pattern.id, peak); } : undefined}
                              />
                            ))}
                            {showPeaks && S.showPeakLabels && labelledPeaks.map((peak, peakIndex) => {
                              const x = xToPx(peak.displayX);
                              const y = yToPx(peak.displayY + offset) - 7 - (peakIndex % 2) * 7;
                              return <text
                                key={`peak-label-${pattern.id}-${peakIndex}`}
                                x={x} y={y} textAnchor="start" fontSize={S.peakLabelSize} fontWeight={S.peakLabelBold ? "700" : "400"} fill={color}
                                fontFamily={figureFont} transform={`rotate(-90 ${x} ${y})`}
                                style={tool === "peaks" ? { cursor: "pointer", userSelect: "none" } : undefined}
                                onClick={(event) => { if (tool === "peaks") { event.stopPropagation(); removePeak(pattern.id, peak); } else activateTextTarget(event, { kind: "settings", label: "Labels de pics", sizeKey: "peakLabelSize", boldKey: "peakLabelBold" }); }}
                              >{peak.x.toFixed(S.mode === "drx" ? 2 : 0)}</text>;
                            })}
                          </g>
                          {S.showPatternLabels !== false && pattern.showLabel !== false && (() => {
                            const moving = dragPreview?.type === "patternLabel" && dragPreview.id === pattern.id ? dragPreview : null;
                            const resizing = dragPreview?.type === "patternLabelResize" && dragPreview.id === pattern.id ? dragPreview : null;
                            const dx = moving ? moving.dx : Number(pattern.labelDx) || 0;
                            const dy = moving ? moving.dy : Number(pattern.labelDy) || 0;
                            const fontSize = resizing ? resizing.fontSize : Number(pattern.labelFontSize) || S.patternLabelSize;
                            const text = `${pattern.label}${pattern.isDifferenceReference ? " (réf.)" : ""}`;
                            const labelX = M.left + plotWidth + 10 + dx;
                            const labelYpx = dragPreview?.type === "curveOrder" && dragPreview.id === pattern.id ? dragPreview.svgY : yToPx(labelY) + dy;
                            const estimatedWidth = Math.max(30, text.length * fontSize * 0.57);
                            const selected = isSelected("pattern", pattern.id);
                            return <g>
                              <text data-ui-only="true" x={labelX - 12} y={labelYpx} dominantBaseline="middle" fontSize={Math.max(8, fontSize * 0.75)} fill={color} opacity="0.65" style={{ cursor: pattern.locked ? "not-allowed" : "ns-resize", userSelect: "none" }} onPointerDown={(event) => { if (!pattern.locked) beginCanvasDrag(event, "curveOrder", { id: pattern.id }); }}>↕</text>
                              <text
                                x={labelX} y={labelYpx} dominantBaseline="middle" fontSize={fontSize}
                                fontWeight={(pattern.labelBold ?? S.patternLabelBold) ? "700" : "400"} fill={color} fontFamily={figureFont}
                                style={{ cursor: "move", userSelect: "none" }}
                                onClick={(event) => { selectItem(event, "pattern", pattern.id); activateTextTarget(event, { kind: "pattern", id: pattern.id, label: `Patron · ${pattern.label}`, sizeKey: "labelFontSize", boldKey: "labelBold", fallbackSizeKey: "patternLabelSize", fallbackBoldKey: "patternLabelBold" }); }}
                                onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "pattern", id: pattern.id, target: "pattern-name" })}
                                onPointerDown={(event) => { if (event.detail >= 2) { openContextOptions(event, { tab: "inspector", type: "pattern", id: pattern.id, target: "pattern-name" }); return; } beginCanvasDrag(event, "patternLabel", { id: pattern.id, dx, dy, fontSize }); }}
                              >{text}</text>
                              {selected && <g data-ui-only="true">
                                <rect x={labelX - 4} y={labelYpx - fontSize * 0.72} width={estimatedWidth + 8} height={fontSize * 1.42} fill="none" stroke={color} strokeWidth="0.8" strokeDasharray="3 2" opacity="0.65" pointerEvents="none" />
                                <rect x={labelX + estimatedWidth + 1} y={labelYpx - 4} width="8" height="8" rx="2" fill={color} stroke="#fff" strokeWidth="1" style={{ cursor: "nwse-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "patternLabelResize", { id: pattern.id, fontSize })} />
                              </g>}
                            </g>;
                          })()}
                        </g>
                      );
                    })
                    ) : (
                      <FigureLayoutLayer
                        mode={S.figureLayoutMode}
                        processed={processed}
                        rawProcessed={rawProcessed}
                        activePatternId={activePattern?.id}
                        settings={S}
                        colors={colorMap}
                        bounds={{ x: M.left, y: M.top, width: plotWidth, height: mainHeight }}
                        xmin={viewXMin}
                        xmax={viewXMax}
                        onTextSelect={activateTextTarget}
                      />
                    )}

                    {S.figureLayoutMode === "single" && phases.filter((phase) => phase.visible && phase.inOverlay).map((phase) => (
                      <g key={`phase-overlay-${phase.id}`} clipPath="url(#plot-clip)">
                        {(() => {
                          // Poignée de hauteur : elle agit sur le facteur d'échelle
                          // propre à la phase, appliqué à tous ses bâtonnets.
                          const scaleDrag = dragPreview?.type === "phaseOverlayScale" && dragPreview.id === phase.id ? dragPreview : null;
                          const scale = scaleDrag ? scaleDrag.scale : (Number.isFinite(Number(phase.overlayScale)) && phase.overlayScale !== null && phase.overlayScale !== undefined ? Number(phase.overlayScale) : (Number(S.phaseOverlayScale) || 0.85));
                          // Hauteur individuelle éventuelle d'un bâtonnet, sinon
                          // hauteur de la phase.
                          const peakDrag = dragPreview?.type === "phaseOverlayPeakScale" && dragPreview.id === phase.id ? dragPreview : null;
                          const peakScaleFor = (x) => {
                            if (peakDrag && Math.abs(peakDrag.x - x) < 1e-6) return peakDrag.scale;
                            const entry = (phase.overlayPeakScales || []).find((item) => Math.abs(Number(item.x) - x) < overlayTolerance);
                            return entry && Number.isFinite(Number(entry.scale)) ? Number(entry.scale) : scale;
                          };
                          const reference = Math.max(0.2, curveMaximum);
                          // En transmittance, la ligne de base est haute et les
                          // bandes descendent : les bâtonnets partent du haut du
                          // cadre vers le bas, et les valeurs se lisent sous leur
                          // extrémité.
                          const invertSticks = activeMode === "ir" && irQuantity === "transmittance";
                          const baseY = invertSticks ? M.top : Math.min(M.top + mainHeight, yToPx(0));
                          const visiblePeaks = phase.peaks.filter(([x]) => x >= viewXMin && x <= viewXMax && !(breakActive && x > Number(S.brokenAxisStart) && x < Number(S.brokenAxisEnd)));
                          const strongest = visiblePeaks.reduce((best, peak) => !best || peak[1] > best[1] ? peak : best, null);
                          const valueSize = Number(S.phaseOverlayValueSize) || 8.5;
                          const overlayDisplay = S.phaseOverlayDisplay === "sticks" || S.phaseOverlayDisplay === "values" ? S.phaseOverlayDisplay : "both";
                          // Sans bâtonnet, la valeur s'ancre sur le pic mesuré.
                          const anchorMode = overlayDisplay === "values" ? "peak" : (S.phaseOverlayValueAnchor === "peak" ? "peak" : "stick");
                          const searchWindow = Number(S.phaseOverlayValueWindow) > 0
                            ? Number(S.phaseOverlayValueWindow)
                            : (S.mode === "drx" ? 0.2 : 8);
                          // Sur la figure, l'intensité relative des fiches n'entre
                          // en compte que si l'option est réactivée ; par défaut
                          // tous les bâtonnets partent à la même hauteur, réglable
                          // ensuite un par un. Les panneaux et les annotations
                          // gardent l'intensité dans tous les cas.
                          const useIntensity = Boolean(S.phaseOverlayUseIntensity);
                          const stickUnit = (intensity) => (useIntensity ? (intensity / 100) : 1) * reference;
                          // Longueur du bâtonnet en pixels, comptée depuis sa base.
                          const stickLength = (intensity, x) => Math.abs(yToPx(stickUnit(intensity) * (x === undefined ? scale : peakScaleFor(x))) - yToPx(0));
                          const stickTop = (intensity, x) => {
                            if (S.phaseOverlayFullHeight) return invertSticks ? M.top + mainHeight : M.top;
                            const length = stickLength(intensity, x);
                            return clamp(invertSticks ? baseY + length : baseY - length, M.top, M.top + mainHeight);
                          };
                          return <>
                            {visiblePeaks.map(([x, intensity], index) => {
                              const px = xToPx(x);
                              const topY = stickTop(intensity, x);
                              const isException = (phase.overlayValueExceptions || []).some((value) => Math.abs(value - x) < overlayTolerance);
                              const showValue = phase.overlayShowValues ? !isException : isException;
                              const valueText = x.toFixed(S.mode === "drx" ? 2 : 0);
                              // Ancrage de la valeur : extrémité du bâtonnet par défaut,
                              // sommet de la courbe mesurée en option. Si le texte
                              // déborderait du cadre, il bascule vers le bas.
                              const anchorY = anchorMode === "peak"
                                ? clamp(curveTopPxNear(x, searchWindow, invertSticks) ?? topY, M.top, M.top + mainHeight)
                                : topY;
                              const valueLength = valueText.length * valueSize * 0.62;
                              // Texte tourné de -90° : l'ancrage « start » le fait
                              // monter depuis son point, « end » le fait descendre.
                              // Il se place du côté libre de l'extrémité du bâtonnet,
                              // au-dessus en absorbance, en dessous en transmittance,
                              // et bascule de l'autre côté si le cadre est atteint.
                              const fitsOutward = invertSticks
                                ? anchorY + 4 + valueLength <= M.top + mainHeight - 2
                                : anchorY - 4 - valueLength >= M.top + 2;
                              const valueAnchor = invertSticks
                                ? (fitsOutward ? "end" : "start")
                                : (fitsOutward ? "start" : "end");
                              const valueY = invertSticks
                                ? (fitsOutward ? anchorY + 4 : anchorY - 6)
                                : (fitsOutward ? anchorY - 4 : anchorY + 6);
                              // Décalage libre posé par glisser-déposer ; un glisser en
                              // cours prime sur la valeur enregistrée.
                              const offsetDrag = dragPreview?.type === "overlayValueMove" && dragPreview.phaseId === phase.id && Math.abs(dragPreview.x - x) < overlayTolerance ? dragPreview : null;
                              const storedOffset = (phase.overlayValueOffsets || []).find((item) => Math.abs(Number(item.x) - x) < overlayTolerance);
                              const offsetX = offsetDrag ? offsetDrag.dx : (Number(storedOffset?.dx) || 0);
                              const offsetY = offsetDrag ? offsetDrag.dy : (Number(storedOffset?.dy) || 0);
                              const valueX = px + offsetX;
                              const valueYFinal = valueY + offsetY;
                              return <g key={`phase-overlay-line-${phase.id}-${index}`}>
                                {overlayDisplay !== "values" && <line
                                  x1={px} x2={px} y1={baseY} y2={topY}
                                  stroke={phase.color} strokeWidth={Number(S.phaseOverlayWidth) || 1}
                                  strokeDasharray={isPhaseDashed(phase, "overlay") ? "3 2" : undefined}
                                  opacity={Number(S.phaseOverlayOpacity) || 0.7}
                                />}
                                <line
                                  data-ui-only="true"
                                  x1={px} x2={px} y1={baseY} y2={topY}
                                  stroke="transparent" strokeWidth="9"
                                  style={{ cursor: "pointer" }}
                                  onClick={(event) => { event.stopPropagation(); togglePhaseOverlayValue(phase.id, x); }}
                                >
                                  <title>{`${phase.name} · ${valueText} — ${tr(showValue ? "cliquer pour masquer la valeur" : "cliquer pour afficher la valeur")}`}</title>
                                </line>
                                {overlayDisplay !== "sticks" && showValue && <>
                                  {(offsetX !== 0 || offsetY !== 0) && <line data-ui-only="true" x1={px} y1={anchorY} x2={valueX} y2={valueYFinal} stroke={phase.color} strokeWidth="0.6" strokeDasharray="2 2" opacity="0.5" pointerEvents="none" />}
                                  <text
                                    x={valueX} y={valueYFinal} textAnchor={valueAnchor} fontSize={valueSize}
                                    fontWeight={S.phaseOverlayValueBold ? "700" : "400"} fill={phase.color} fontFamily={figureFont}
                                    transform={`rotate(-90 ${valueX} ${valueYFinal})`}
                                    style={{ cursor: "move", userSelect: "none" }}
                                    onPointerDown={(event) => beginCanvasDrag(event, "overlayValueMove", {
                                      phaseId: phase.id, x, dx: offsetX, dy: offsetY, stickX: px, stickY: anchorY,
                                      // Cible alternative d'accrochage : le bâtonnet quand
                                      // l'ancrage courant est le pic mesuré, et inversement.
                                      altY: anchorMode === "peak" ? topY : curveTopPxNear(x, searchWindow, invertSticks),
                                    })}
                                    onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Valeurs des références", sizeKey: "phaseOverlayValueSize", boldKey: "phaseOverlayValueBold" })}
                                    onDoubleClick={(event) => { event.stopPropagation(); togglePhaseOverlayValue(phase.id, x); }}
                                  ><title>{tr("Glisser pour déplacer la valeur, relâcher près du bâtonnet ou du pic pour l’y raccrocher ; double-clic pour la masquer")}</title>{valueText}</text>
                                </>}
                                {overlayDisplay !== "values" && !S.phaseOverlayFullHeight && S.showOverlayHandles !== false && (() => {
                                  // Poignée propre à ce bâtonnet : elle fixe sa hauteur
                                  // indépendamment du réglage de la phase.
                                  const overridden = (phase.overlayPeakScales || []).some((item) => Math.abs(Number(item.x) - x) < overlayTolerance);
                                  return <g
                                    data-ui-only="true"
                                    style={{ cursor: "ns-resize" }}
                                    onPointerDown={(event) => beginCanvasDrag(event, "phaseOverlayPeakScale", { id: phase.id, x, scale: peakScaleFor(x), unit: stickUnit(intensity), invert: invertSticks })}
                                    onDoubleClick={(event) => { event.stopPropagation(); resetPhaseOverlayPeakScale(phase.id, x); }}
                                  >
                                    <rect x={px - 7} y={topY - 7} width="14" height="14" fill="transparent" />
                                    <rect
                                      x={px - 3} y={topY - 3} width="6" height="6" rx="1.5"
                                      fill={overridden ? phase.color : "#fff"} stroke={phase.color} strokeWidth="1"
                                      opacity={overridden ? 0.95 : 0.7}
                                    >
                                      <title>{`${phase.name} · ${valueText} — ${tr("glisser pour régler la hauteur de ce bâtonnet, double-clic pour revenir à la hauteur de la phase")}`}</title>
                                    </rect>
                                  </g>;
                                })()}
                              </g>;
                            })}
                          </>;
                        })()}
                      </g>
                    ))}
                    {S.figureLayoutMode === "single" && S.showOverlayLegend && (() => {
                      const overlayPhases = phases.filter((phase) => phase.visible && phase.inOverlay);
                      if (!overlayPhases.length) return null;
                      const preview = dragPreview?.type === "overlayLegendMove" ? dragPreview : null;
                      const fontSize = clamp(Number(S.overlayLegendFontSize) || 10, 6, 20);
                      const lineHeight = fontSize + 8;
                      const longest = overlayPhases.reduce((max, phase) => Math.max(max, String(phase.name || "").length), 6);
                      const boxWidth = clamp(46 + longest * fontSize * 0.6, 90, plotWidth * 0.5);
                      const boxHeight = overlayPhases.length * lineHeight + 12;
                      const defaultX = M.left + plotWidth - boxWidth - 10;
                      const defaultY = M.top + 10;
                      const boxX = clamp(preview?.x ?? (Number.isFinite(Number(S.overlayLegendX)) && S.overlayLegendX !== null ? Number(S.overlayLegendX) : defaultX), M.left, M.left + plotWidth - boxWidth);
                      const boxY = clamp(preview?.y ?? (Number.isFinite(Number(S.overlayLegendY)) && S.overlayLegendY !== null ? Number(S.overlayLegendY) : defaultY), M.top, M.top + mainHeight - boxHeight);
                      return <g
                        style={{ cursor: "move" }}
                        onDoubleClick={(event) => openContextOptions(event, { tab: "references", target: "overlay-legend-options" })}
                        onPointerDown={(event) => { if (event.detail >= 2) return; beginCanvasDrag(event, "overlayLegendMove", { x: boxX, y: boxY }); }}
                      >
                        <rect x={boxX} y={boxY} width={boxWidth} height={boxHeight} fill={S.pageBackground} opacity="0.88" stroke="none" />
                        {overlayPhases.map((phase, index) => {
                          const y = boxY + 10 + index * lineHeight + fontSize * 0.5;
                          return <g key={`overlay-legend-${phase.id}`}>
                            <line x1={boxX + 8} x2={boxX + 34} y1={y - fontSize * 0.32} y2={y - fontSize * 0.32} stroke={phase.color} strokeWidth={Math.max(1.4, (Number(S.phaseOverlayWidth) || 1) * 1.6)} strokeDasharray={isPhaseDashed(phase, "overlay") ? "3 2" : undefined} />
                            <text x={boxX + 40} y={y} fontSize={fontSize} fontWeight={S.overlayLegendFontBold ? "700" : "400"} fill="#15191f" fontFamily={figureFont} style={{ userSelect: "none", cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Légende des références", sizeKey: "overlayLegendFontSize", boldKey: "overlayLegendFontBold" })}>{phase.name}</text>
                          </g>;
                        })}
                      </g>;
                    })()}

                    {S.figureLayoutMode === "single" && S.showCurveLegend && processed.length > 0 && (() => {
                      const preview = dragPreview?.type === "curveLegendMove" ? dragPreview : null;
                      const fontSize = clamp(Number(S.curveLegendFontSize) || 10, 6, 20);
                      const lineHeight = fontSize + 8;
                      const entries = processed.slice(0, 12);
                      const longest = entries.reduce((max, pattern) => Math.max(max, String(pattern.label || "").length), 6);
                      const boxWidth = clamp(48 + longest * fontSize * 0.58, 100, plotWidth * 0.55);
                      const boxHeight = entries.length * lineHeight + 12;
                      const defaultX = M.left + 12;
                      const defaultY = M.top + 10;
                      const boxX = clamp(preview?.x ?? (Number.isFinite(Number(S.curveLegendX)) && S.curveLegendX !== null ? Number(S.curveLegendX) : defaultX), M.left, M.left + plotWidth - boxWidth);
                      const boxY = clamp(preview?.y ?? (Number.isFinite(Number(S.curveLegendY)) && S.curveLegendY !== null ? Number(S.curveLegendY) : defaultY), M.top, Math.max(M.top, M.top + mainHeight - boxHeight));
                      return <g
                        style={{ cursor: "move" }}
                        onPointerDown={(event) => { if (event.detail >= 2) return; beginCanvasDrag(event, "curveLegendMove", { x: boxX, y: boxY }); }}
                      >
                        <rect x={boxX} y={boxY} width={boxWidth} height={boxHeight} fill={S.pageBackground} opacity="0.92" stroke="#8f969e" strokeWidth="0.8" rx="3" />
                        {entries.map((pattern, index) => {
                          const y = boxY + 10 + index * lineHeight + fontSize * 0.5;
                          const color = colorMap.get(pattern.id) || "#111111";
                          return <g key={`curve-legend-${pattern.id}`}>
                            <line x1={boxX + 8} x2={boxX + 32} y1={y - fontSize * 0.32} y2={y - fontSize * 0.32} stroke={color} strokeWidth={Math.max(1.4, S.lineWidth * 1.6)} />
                            <text x={boxX + 38} y={y} fontSize={fontSize} fontWeight={S.curveLegendFontBold ? "700" : "400"} fill="#15191f" fontFamily={figureFont} style={{ userSelect: "none", cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Légende des courbes", sizeKey: "curveLegendFontSize", boldKey: "curveLegendFontBold" })}>{truncateLabel(pattern.label, Math.max(10, Math.round((boxWidth - 46) / (fontSize * 0.55))))}</text>
                          </g>;
                        })}
                      </g>;
                    })()}

                    {S.figureLayoutMode === "single" && multiFitResult && (() => {
                      const target = processed.find((pattern) => pattern.id === multiFitResult.patternId);
                      if (!target) return null;
                      const offset = target.stackOffset || 0;
                      const toPath = (values) => multiFitResult.x.map((value, index) => `${index ? "L" : "M"}${xToPx(value).toFixed(2)},${yToPx(values[index] + offset).toFixed(2)}`).join("");
                      return <g clipPath="url(#plot-clip)">
                        {multiFitResult.components.map((component, index) => (
                          <path key={`multifit-${index}`} d={toPath(component.curve.map((value, i) => value + multiFitResult.background[i]))} fill="none" stroke="#7c5cff" strokeWidth={Math.max(0.8, S.lineWidth * 0.8)} strokeDasharray="4 3" opacity="0.75" vectorEffect="non-scaling-stroke" />
                        ))}
                        <path d={toPath(multiFitResult.total)} fill="none" stroke="#e05a47" strokeWidth={Math.max(1, S.lineWidth)} vectorEffect="non-scaling-stroke" opacity="0.9" />
                      </g>;
                    })()}

                    {S.figureLayoutMode === "single" && peakFitResult && activeProcessedPattern && (() => {
                      const offset = activeProcessedPattern.stackOffset || 0;
                      const path = peakFitResult.x.map((value, index) => `${index ? "L" : "M"}${xToPx(value).toFixed(2)},${yToPx(peakFitResult.fitted[index] + offset).toFixed(2)}`).join("");
                      return <g clipPath="url(#plot-clip)"><path d={path} fill="none" stroke="#e05a47" strokeWidth={Math.max(1, S.lineWidth)} strokeDasharray="5 3" vectorEffect="non-scaling-stroke"/><line x1={xToPx(peakFitResult.center)} x2={xToPx(peakFitResult.center)} y1={M.top} y2={M.top + mainHeight} stroke="#e05a47" strokeWidth="0.7" strokeDasharray="2 3" opacity="0.7" /></g>;
                    })()}

                    {S.figureLayoutMode === "single" && S.showInset && (() => {
                      const insetPattern = processed.find((pattern) => pattern.id === S.insetPatternId) || activeProcessedPattern || processed[0];
                      if (!insetPattern || !(Number(S.insetXMax) > Number(S.insetXMin))) return null;
                      const preview = ["insetMove", "insetResize"].includes(dragPreview?.type) ? dragPreview : null;
                      const widthPct = clamp(Number(preview?.widthPct ?? S.insetWidthPct) || 34, 15, 70);
                      const heightPct = clamp(Number(preview?.heightPct ?? S.insetHeightPct) || 34, 15, 70);
                      const overlayWidth = plotWidth * widthPct / 100;
                      const overlayHeight = mainHeight * heightPct / 100;
                      const xFrac = clamp(Number(preview?.xFrac ?? S.insetXFrac) || 0, 0, Math.max(0, 1 - widthPct / 100));
                      const yFrac = clamp(Number(preview?.yFrac ?? S.insetYFrac) || 0, 0, Math.max(0, 1 - heightPct / 100));
                      let width = overlayWidth;
                      let height = overlayHeight;
                      let left = M.left + xFrac * plotWidth;
                      let top = M.top + yFrac * mainHeight;
                      if (insetPlacementMode === "dock-right") {
                        width = Math.max(150, insetDockRightWidth - 24);
                        height = Math.min(mainHeight, Math.max(120, overlayHeight));
                        left = S.figWidth + 12;
                        top = M.top + Math.max(0, (mainHeight - height) / 2);
                      } else if (insetPlacementMode === "dock-top") {
                        width = Math.min(plotWidth, Math.max(180, overlayWidth));
                        height = Math.max(110, insetDockTopHeight - 24);
                        left = M.left + Math.max(0, (plotWidth - width) / 2);
                        top = 10;
                      }
                      const inner = { left: left + 31, right: left + width - 9, top: top + 22, bottom: top + height - 25 };
                      const ixmin = Number(S.insetXMin); const ixmax = Number(S.insetXMax);
                      const indices = insetPattern.sourceX.map((value, index) => ({ value, index })).filter((entry) => entry.value >= ixmin && entry.value <= ixmax);
                      if (indices.length < 2) return null;
                      const values = indices.map((entry) => insetPattern.displayY[entry.index]).filter(Number.isFinite);
                      if (values.length < 2) return null;
                      const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
                      const insetAxisMin = insetAxisWindow.minimum; const insetAxisMax = insetAxisWindow.maximum;
                      const ix = (value) => {
                        const px = inner.left + ((axisCoordinate(value) - insetAxisMin) / Math.max(1e-12, insetAxisMax - insetAxisMin)) * (inner.right - inner.left);
                        // L’encart suit le sens de l’axe principal.
                        return S.reverseXAxis ? inner.left + inner.right - px : px;
                      };
                      const iy = (value) => inner.bottom - ((value - min) / range) * (inner.bottom - inner.top);
                      const path = indices.map((entry, index) => `${index ? "L" : "M"}${ix(entry.value).toFixed(2)},${iy(insetPattern.displayY[entry.index]).toFixed(2)}`).join("");
                      const color = colorMap.get(insetPattern.id) || "#20252b";
                      const sourceValues = indices.map((entry) => insetPattern.displayY[entry.index] + (insetPattern.stackOffset || 0));
                      const sourceYMin = Math.min(...sourceValues); const sourceYMax = Math.max(...sourceValues);
                      const sourceX1 = xToPx(ixmin); const sourceX2 = xToPx(ixmax);
                      const sourceRect = {
                        x: Math.min(sourceX1, sourceX2),
                        y: yToPx(sourceYMax),
                        width: Math.max(2, Math.abs(sourceX2 - sourceX1)),
                        height: Math.max(3, yToPx(sourceYMin) - yToPx(sourceYMax)),
                      };
                      const collision = insetPlacementMode === "overlay" && ((hasAnnotations && yFrac < 0.28) || (S.showAbbrevKey && xFrac + widthPct / 100 > 0.78 && yFrac < 0.38));
                      const canMove = insetPlacementMode === "overlay";
                      return <g onDoubleClick={(event) => openContextOptions(event, { tab: "appearance", target: "inset-options" })}>
                        {S.insetShowSourceRect && <g>
                          <rect x={sourceRect.x} y={sourceRect.y} width={sourceRect.width} height={sourceRect.height} fill="none" stroke={color} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.85" />
                          {S.insetShowConnectors && <><line x1={sourceRect.x + sourceRect.width} y1={sourceRect.y} x2={left} y2={top + height} stroke={color} strokeWidth="0.55" opacity="0.45"/><line x1={sourceRect.x + sourceRect.width} y1={sourceRect.y + sourceRect.height} x2={left} y2={top} stroke={color} strokeWidth="0.55" opacity="0.45"/></>}
                        </g>}
                        <rect x={left} y={top} width={width} height={height} fill={S.pageBackground} stroke="#525b66" strokeWidth="0.9"/>
                        {collision && <rect data-ui-only="true" x={left} y={top} width={width} height={height} fill="none" stroke="#e05a47" strokeWidth="1.4"/>}
                        <rect data-ui-only="true" x={left} y={top} width={width} height="19" fill="#eef1f4" opacity="0.86" style={{ cursor: canMove ? "move" : "default" }} onPointerDown={(event) => { if (event.detail >= 2) { openContextOptions(event, { tab: "appearance", target: "inset-options" }); return; } if (canMove) beginCanvasDrag(event, "insetMove", { xFrac, yFrac, widthPct, heightPct }); }} />
                        <line x1={inner.left} x2={inner.left} y1={inner.top} y2={inner.bottom} stroke="#20252b" strokeWidth="0.7"/><line x1={inner.left} x2={inner.right} y1={inner.bottom} y2={inner.bottom} stroke="#20252b" strokeWidth="0.7"/>
                        <path d={path} fill="none" stroke={color} strokeWidth={S.lineWidth} vectorEffect="non-scaling-stroke"/>
                        <text x={left + 7} y={top + 13} fontSize={S.insetLabelFontSize} fontWeight={S.insetLabelFontBold ? "700" : "400"} fill="#20252b" style={{ cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Titre de l’encart", sizeKey: "insetLabelFontSize", boldKey: "insetLabelFontBold" })}>{truncateLabel(insetPattern.label, 28)}</text>
                        <text x={(inner.left + inner.right) / 2} y={top + height - 7} textAnchor="middle" fontSize={S.insetRangeFontSize} fontWeight={S.insetRangeFontBold ? "700" : "400"} fill="#343a40" style={{ cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Plage de l’encart", sizeKey: "insetRangeFontSize", boldKey: "insetRangeFontBold" })}>{insetAxisMin.toFixed(drxAxisMode === "2theta" ? 1 : 2)}–{insetAxisMax.toFixed(drxAxisMode === "2theta" ? 1 : 2)} {primaryAxisUnit}</text>
                        {collision && <text data-ui-only="true" x={left + width - 7} y={top + 13} textAnchor="end" fontSize="8" fontWeight="700" fill="#e05a47">{tr("collision")}</text>}
                        <rect data-ui-only="true" x={left + width - 10} y={top + height - 10} width="10" height="10" rx="2" fill={color} stroke="#fff" strokeWidth="1" style={{ cursor: "nwse-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "insetResize", { xFrac, yFrac, widthPct, heightPct })} />
                      </g>;
                    })()}

                    {S.figureLayoutMode === "single" && hasAnnotations && annotationData.ticks.map((tick, index) => {
                      const height = (tick.intensity / 100) * (dragPreview?.type === "annotationTickScale" ? dragPreview.scale : S.tickScale);
                      return <line key={`annotation-tick-${index}`} x1={xToPx(tick.x)} x2={xToPx(tick.x)} y1={yToPx(annotationBase)} y2={yToPx(annotationBase + height)} stroke={tick.color} strokeWidth="0.85" strokeDasharray={tick.dashed ? "3 2" : undefined} opacity="0.88" />;
                    })}
                    {S.figureLayoutMode === "single" && hasAnnotations && S.showOverlayHandles !== false && annotationData.ticks.length > 0 && (() => {
                      // Poignée de hauteur des bâtonnets d'annotation : elle agit
                      // sur le facteur global tickScale.
                      const drag = dragPreview?.type === "annotationTickScale" ? dragPreview : null;
                      const currentScale = drag ? drag.scale : S.tickScale;
                      const strongest = annotationData.ticks.reduce((best, tick) => !best || tick.intensity > best.intensity ? tick : best, null);
                      if (!strongest) return null;
                      const px = xToPx(strongest.x);
                      const py = yToPx(annotationBase + (strongest.intensity / 100) * currentScale);
                      return <g data-ui-only="true" style={{ cursor: "ns-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "annotationTickScale", { intensity: strongest.intensity })}>
                        <rect x={px - 14} y={py - 9} width="28" height="18" fill="transparent" />
                        <line x1={px - 9} x2={px + 9} y1={py} y2={py} stroke={strongest.color} strokeWidth="1.4" opacity="0.9" />
                        <rect x={px - 4.5} y={py - 4.5} width="9" height="9" rx="2" fill="#fff" stroke={strongest.color} strokeWidth="1.4">
                          <title>{tr("Hauteur des bâtonnets d’annotation — glisser verticalement")}</title>
                        </rect>
                      </g>;
                    })()}
                    {S.figureLayoutMode === "single" && hasAnnotations && annotationData.labels.map((tick, index) => {
                      const height = (tick.intensity / 100) * S.tickScale;
                      const preview = dragPreview?.type === "phaseLabel" && dragPreview.id === tick.phaseId ? dragPreview : null;
                      const offsetX = preview ? preview.xOffset : tick.labelOffsetX;
                      const offsetY = preview ? preview.yOffset : tick.labelOffsetY;
                      const x = xToPx(tick.x + offsetX);
                      const y = yToPx(annotationBase + height + (index % 2 ? 0.1 : 0) + 0.04 + offsetY);
                      return <text
                        key={`annotation-label-${index}`}
                        x={x}
                        y={y}
                        fontSize={finiteNumber(phases.find((phase) => phase.id === tick.phaseId)?.labelFontSize, S.annotFontSize)}
                        fontWeight={(phases.find((phase) => phase.id === tick.phaseId)?.labelBold ?? S.annotFontBold) ? "700" : "400"}
                        fill={tick.color}
                        fontFamily={figureFont}
                        transform={`rotate(-90 ${x} ${y})`}
                        style={{ cursor: "move", userSelect: "none" }}
                        onClick={(event) => { selectItem(event, "phase", tick.phaseId); activateTextTarget(event, { kind: "phase", id: tick.phaseId, label: `Annotation · ${tick.abbreviation}`, sizeKey: "labelFontSize", boldKey: "labelBold", fallbackSizeKey: "annotFontSize", fallbackBoldKey: "annotFontBold" }); }}
                        onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "phase", id: tick.phaseId, target: "phase-name" })}
                        onPointerDown={(event) => { if (event.detail >= 2) { openContextOptions(event, { tab: "inspector", type: "phase", id: tick.phaseId, target: "phase-name" }); return; } beginCanvasDrag(event, "phaseLabel", { id: tick.phaseId, xOffset: tick.labelOffsetX, yOffset: tick.labelOffsetY }); }}
                      >{tick.abbreviation}</text>;
                    })}
                    {S.figureLayoutMode === "single" && hasAnnotations && S.showAbbrevKey && phases.filter((phase) => phase.visible && phase.inAnnot).map((phase, index) => (
                      <text key={`key-${phase.id}`} x={M.left + plotWidth + 10} y={yToPx(annotationBase + S.tickScale * 0.84) + index * Math.max(14, S.abbrevKeyFontSize + 5)} fontSize={S.abbrevKeyFontSize} fontWeight={S.abbrevKeyFontBold ? "700" : "400"} fontStyle="italic" fill={phase.color} fontFamily={figureFont} style={{ cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Clé des abréviations", sizeKey: "abbrevKeyFontSize", boldKey: "abbrevKeyFontBold" })} onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "phase", id: phase.id, target: "phase-name" })}>{phase.abbrev} = {phase.name}</text>
                    ))}

                    {S.figureLayoutMode === "single" && notes.filter((note) => note?.visible !== false).map((note) => {
                      const safe = safeNoteModel(note, viewXMin, viewXMax);
                      const moving = dragPreview?.type === "note" && dragPreview.id === safe.id ? dragPreview : null;
                      const resizing = dragPreview?.type === "noteResize" && dragPreview.id === safe.id ? dragPreview : null;
                      const x = xToPx(moving ? moving.x : safe.x);
                      const yFrac = moving ? moving.yFrac : safe.yFrac;
                      const y = M.top + mainHeight * (1 - yFrac);
                      const fontSize = resizing ? resizing.fontSize : safe.fontSize;
                      const selected = isSelected("note", safe.id);
                      // Texte multi-lignes : chaque ligne devient un tspan.
                      const noteLines = String(safe.text ?? "").split("\n");
                      const longestLine = noteLines.reduce((max, line) => Math.max(max, line.length), 1);
                      const estimatedWidth = Math.max(24, longestLine * fontSize * 0.58);
                      const noteBlockHeight = fontSize + (noteLines.length - 1) * fontSize * 1.25;
                      const boxLeft = x - estimatedWidth / 2 - 4;
                      const boxTop = y - fontSize - 4;
                      // Extrémités du trait : fractions de la hauteur tracée,
                      // ajustables à la souris via les deux poignées.
                      const topDrag = dragPreview?.type === "noteVlineTop" && dragPreview.id === safe.id ? dragPreview : null;
                      const bottomDrag = dragPreview?.type === "noteVlineBottom" && dragPreview.id === safe.id ? dragPreview : null;
                      const topFrac = topDrag ? topDrag.frac : safe.vlineTopFrac;
                      const bottomFrac = bottomDrag ? bottomDrag.frac : safe.vlineBottomFrac;
                      const lineTopY = M.top + mainHeight * (1 - Math.max(topFrac, bottomFrac));
                      const lineBottomY = M.top + mainHeight * (1 - Math.min(topFrac, bottomFrac));
                      return (
                        <g key={safe.id} opacity={selected ? 1 : 0.92}>
                          {safe.vline && <>
                            <line x1={x} x2={x} y1={lineTopY} y2={lineBottomY} stroke={safe.color} strokeWidth="0.75" strokeDasharray="4 3" opacity="0.75" />
                            {selected && <g data-ui-only="true">
                              <rect x={x - 4} y={lineTopY - 4} width="8" height="8" rx="2" fill="#fff" stroke={safe.color} strokeWidth="1.1" style={{ cursor: "ns-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "noteVlineTop", { id: safe.id, frac: topFrac })}>
                                <title>{tr("Extrémité haute du trait")}</title>
                              </rect>
                              <rect x={x - 4} y={lineBottomY - 4} width="8" height="8" rx="2" fill="#fff" stroke={safe.color} strokeWidth="1.1" style={{ cursor: "ns-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "noteVlineBottom", { id: safe.id, frac: bottomFrac })}>
                                <title>{tr("Extrémité basse du trait")}</title>
                              </rect>
                            </g>}
                          </>}
                          {(() => {
                            // Ligne d'accroche : de la boîte de la note vers un point
                            // de la figure (typiquement un pic), déplaçable par sa
                            // poignée circulaire avec magnétisme sur les pics.
                            if (!safe.anchorLine) return null;
                            const anchorDrag = dragPreview?.type === "noteAnchorMove" && dragPreview.id === safe.id ? dragPreview : null;
                            const storedX = safe.anchorX !== null && Number.isFinite(Number(safe.anchorX)) ? Number(safe.anchorX) : safe.x;
                            const targetDataX = anchorDrag ? anchorDrag.x : clamp(storedX, viewXMin, viewXMax);
                            const targetFrac = anchorDrag ? anchorDrag.yFrac : clamp(finiteNumber(safe.anchorYFrac, clamp(safe.yFrac - 0.18, 0, 1)), 0, 1);
                            const targetX = clamp(xToPx(targetDataX), M.left, M.left + plotWidth);
                            const targetY = M.top + mainHeight * (1 - targetFrac);
                            const startY = targetY >= y ? y + 4 : y - fontSize - 2;
                            return <>
                              <line x1={x} y1={startY} x2={targetX} y2={targetY} stroke={safe.color} strokeWidth="0.75" opacity="0.85" />
                              <circle cx={targetX} cy={targetY} r="1.6" fill={safe.color} />
                              {selected && <circle data-ui-only="true" cx={targetX} cy={targetY} r="6" fill="#fff" fillOpacity="0.01" stroke={safe.color} strokeWidth="1.1" strokeDasharray="2 2" style={{ cursor: "move" }} onPointerDown={(event) => beginCanvasDrag(event, "noteAnchorMove", { id: safe.id })}>
                                <title>{tr("Extrémité de la ligne d'accroche — glisser sur le pic visé (magnétisme sur les pics détectés)")}</title>
                              </circle>}
                            </>;
                          })()}
                          <text
                            x={x} y={y} textAnchor="middle" fontSize={fontSize} fontWeight={safe.bold ? "700" : "400"} fill={safe.color} fontFamily={figureFont}
                            transform={safe.rotation ? `rotate(${safe.rotation} ${x} ${y})` : undefined}
                            style={{ cursor: "pointer", userSelect: "none" }}
                            onClick={(event) => { event.stopPropagation(); selectItem(event, "note", safe.id); activateTextTarget(event, { kind: "note", id: safe.id, label: "Note", sizeKey: "fontSize", boldKey: "bold" }); }}
                            onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "note", id: safe.id, target: "note-text" })}
                          >{noteLines.map((line, lineIndex) => <tspan key={lineIndex} x={x} dy={lineIndex === 0 ? 0 : fontSize * 1.25}>{line}</tspan>)}</text>
                          {selected && <g data-ui-only="true">
                            <rect x={boxLeft} y={boxTop} width={estimatedWidth + 8} height={noteBlockHeight + 10} fill="none" stroke={safe.color} strokeWidth="0.8" strokeDasharray="3 2" opacity="0.78" pointerEvents="none" />
                            <g style={{ cursor: "move" }} onPointerDown={(event) => beginCanvasDrag(event, "note", { id: safe.id, x: safe.x, yFrac: safe.yFrac, fontSize })}>
                              <rect x={boxLeft - 11} y={boxTop - 1} width="10" height="10" rx="2" fill={safe.color} stroke="#fff" strokeWidth="1" />
                              <path d={`M${boxLeft - 8.5} ${boxTop + 4}h5M${boxLeft - 6} ${boxTop + 1.5}v5`} stroke="#fff" strokeWidth="1" pointerEvents="none" />
                            </g>
                            <rect x={x + estimatedWidth / 2 + 1} y={y - 5} width="8" height="8" rx="2" fill={safe.color} stroke="#fff" strokeWidth="1" style={{ cursor: "nwse-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "noteResize", { id: safe.id, fontSize })} />
                          </g>}
                        </g>
                      );
                    })}

                    {S.figureLayoutMode === "single" && <><line x1={M.left} x2={M.left} y1={M.top} y2={M.top + mainHeight} stroke="#15191f" strokeWidth="1" />
                      {S.showYAxisTicks && computeTicks(yMinimum, yMaximum, S.yTickStep).map((tick) => {
                        const py = yToPx(tick);
                        if (py < M.top - 0.5 || py > M.top + mainHeight + 0.5) return null;
                        const label = Math.abs(tick) >= 100 || Number.isInteger(tick) ? String(Math.round(tick * 100) / 100) : tick.toFixed(2);
                        return <g key={`ytick-${tick}`}>
                          {S.showGridHorizontal && <line x1={M.left} x2={M.left + plotWidth} y1={py} y2={py} stroke="#cfd4da" strokeWidth="0.65" opacity={S.gridOpacity} />}
                          <line x1={M.left - 5} x2={M.left} y1={py} y2={py} stroke="#15191f" strokeWidth="1" />
                          <text x={M.left - 8} y={py + 3.2} textAnchor="end" fontSize={S.tickFontSize} fontWeight={S.tickFontBold ? "700" : "400"} fill="#15191f" fontFamily={figureFont} style={{ cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Graduations", sizeKey: "tickFontSize", boldKey: "tickFontBold" })}>{label}</text>
                        </g>;
                      })}
                      <text x="21" y={M.top + mainHeight / 2} fontSize={S.axisFontSize} fontWeight={S.axisFontBold ? "700" : "400"} fill="#15191f" textAnchor="middle" fontFamily={figureFont} transform={`rotate(-90 21 ${M.top + mainHeight / 2})`} style={{ cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Titres des axes", sizeKey: "axisFontSize", boldKey: "axisFontBold" })} onDoubleClick={(event) => openContextOptions(event, { tab: "appearance", target: "axis-y-label" })}>{S.ylabel}</text></>}

                    {panelHeight > 0 && (
                      <g>
                        {panelPhases.map((phase, rowIndex) => {
                          const rowTop = panelTop + rowIndex * rowHeight;
                          const subtitle = truncateLabel(phaseSubtitle(phase), S.phaseSubtitleMaxLength);
                          const showSubtitle = S.showRowSubtitles && phase.showSubtitle !== false && subtitle;
                          return (
                            <g key={phase.id} onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "phase", id: phase.id, target: "phase-name" })} style={{ cursor: "pointer" }}>
                              {phase.peaks.map(([x, intensity], index) => x >= viewXMin && x <= viewXMax && (!breakActive || x <= Number(S.brokenAxisStart) || x >= Number(S.brokenAxisEnd)) ? (
                                <line key={index} x1={xToPx(x)} x2={xToPx(x)} y1={rowTop + rowHeight - 4} y2={rowTop + rowHeight - 4 - (intensity / 100) * rowHeight * 0.78} stroke={phase.color} strokeWidth={S.pdfStickW} strokeDasharray={isPhaseDashed(phase, "panel") ? "3 2" : undefined} opacity="0.9" />
                              ) : null)}
                              {S.showRowLabels && <>
                                <text x={M.left + 8} y={rowTop + rowHeight * 0.3} fontSize={S.referenceRowFontSize} fontWeight={S.referenceRowFontBold ? "700" : "400"} fill={phase.color} fontFamily={figureFont} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Noms du panneau de références", sizeKey: "referenceRowFontSize", boldKey: "referenceRowFontBold" })}>{phase.name}</text>
                                {showSubtitle && <text x={M.left + 8} y={rowTop + rowHeight * 0.3 + Math.max(12, S.referenceSubtitleFontSize + 4)} fontSize={S.referenceSubtitleFontSize} fontWeight={S.referenceSubtitleFontBold ? "700" : "400"} fontStyle="italic" fill={phase.color} fontFamily={figureFont} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Sous-titres des références", sizeKey: "referenceSubtitleFontSize", boldKey: "referenceSubtitleFontBold" })}>{subtitle}</text>}
                              </>}
                              {rowIndex > 0 && <line x1={M.left} x2={M.left + plotWidth} y1={rowTop} y2={rowTop} stroke="#d4d7db" strokeWidth="0.5" />}
                            </g>
                          );
                        })}
                        <line x1={M.left} x2={M.left} y1={panelTop} y2={panelTop + panelHeight} stroke="#15191f" strokeWidth="1" />
                        {S.showPdfLegend && (() => {
                          const preview = ["phaseLegendMove", "phaseLegendResize"].includes(dragPreview?.type) ? dragPreview : null;
                          const boxWidth = preview?.width ?? clamp(Number(S.phaseLegendWidth) || Math.min(230, Math.max(170, plotWidth * 0.26)), 140, Math.max(160, plotWidth - 10));
                          const lineHeight = Math.max(13, (Number(S.phaseLegendFontSize) || 8) + 8);
                          const boxHeight = panelPhases.length * lineHeight + 27;
                          const defaultX = M.left + plotWidth - boxWidth - 7;
                          const defaultY = panelTop + 7;
                          const boxX = clamp(preview?.x ?? (S.phaseLegendX !== null && S.phaseLegendX !== undefined && Number.isFinite(Number(S.phaseLegendX)) ? Number(S.phaseLegendX) : defaultX), M.left, M.left + plotWidth - boxWidth);
                          const boxY = clamp(preview?.y ?? (S.phaseLegendY !== null && S.phaseLegendY !== undefined && Number.isFinite(Number(S.phaseLegendY)) ? Number(S.phaseLegendY) : defaultY), panelTop, panelTop + panelHeight - boxHeight);
                          const fontSize = Number(S.phaseLegendFontSize) || 8;
                          return <g onDoubleClick={(event) => openContextOptions(event, { tab: "references", target: "reference-panel-options" })}>
                            <rect x={boxX} y={boxY} width={boxWidth} height={boxHeight} fill="#ffffff" opacity="0.94" stroke="#8f969e" strokeWidth="0.8" rx="3" />
                            <rect data-ui-only="true" x={boxX} y={boxY} width={boxWidth} height="20" fill="#eef1f4" opacity="0.85" style={{ cursor: "move" }} onPointerDown={(event) => { if (event.detail >= 2) { openContextOptions(event, { tab: "references", target: "reference-panel-options" }); return; } beginCanvasDrag(event, "phaseLegendMove", { x: boxX, y: boxY, width: boxWidth }); }} />
                            <text x={boxX + boxWidth / 2} y={boxY + 14} textAnchor="middle" fontSize={fontSize + 1} fontWeight={S.phaseLegendFontBold ? "700" : "400"} fill="#343a40" style={{ cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Légende du panneau de références", sizeKey: "phaseLegendFontSize", boldKey: "phaseLegendFontBold" })}>{tr("Références de phase")}</text>
                            {panelPhases.map((phase, index) => {
                              const subtitle = truncateLabel(phaseSubtitle(phase), S.phaseSubtitleMaxLength);
                              const suffix = S.showRowSubtitles && phase.showSubtitle !== false && subtitle ? ` — ${subtitle}` : "";
                              const y = boxY + 26 + index * lineHeight;
                              return <g key={phase.id}><line x1={boxX + 9} x2={boxX + 27} y1={y - 3} y2={y - 3} stroke={phase.color} strokeWidth="2"/><text x={boxX + 34} y={y} fontSize={fontSize} fontWeight={S.phaseLegendFontBold ? "700" : "400"} fill="#20252b" style={{ cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Légende du panneau de références", sizeKey: "phaseLegendFontSize", boldKey: "phaseLegendFontBold" })}>{truncateLabel(`${phase.name}${suffix}`, Math.max(12, Math.round((boxWidth - 42) / (fontSize * 0.55))))}</text></g>;
                            })}
                            <rect data-ui-only="true" x={boxX + boxWidth - 8} y={boxY + boxHeight - 8} width="8" height="8" rx="1" fill="#697482" stroke="#fff" strokeWidth="1" style={{ cursor: "nwse-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "phaseLegendResize", { x: boxX, y: boxY, width: boxWidth })} />
                          </g>;
                        })()}
                      </g>
                    )}

                    {S.figureLayoutMode === "single" && (() => {
                      const axisY = panelHeight ? panelTop + panelHeight : M.top + mainHeight;
                      const previewMin = viewXMin;
                      const previewMax = viewXMax;
                      return <g onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); resetDataZoom(); }} style={{ cursor: "pointer" }}>
                        <line x1={M.left} x2={M.left + plotWidth} y1={axisY} y2={axisY} stroke="#15191f" strokeWidth="1"/>
                        {xTickObjects.map((tick) => <g key={tick.x}><line x1={xToPx(tick.x)} x2={xToPx(tick.x)} y1={axisY} y2={axisY + 5} stroke="#15191f" strokeWidth="1"/><text x={xToPx(tick.x)} y={axisY + 20} textAnchor="middle" fontSize={S.tickFontSize} fontWeight={S.tickFontBold ? "700" : "400"} fill="#15191f" fontFamily={figureFont} style={{ cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Graduations", sizeKey: "tickFontSize", boldKey: "tickFontBold" })}>{tick.label}</text></g>)}
                        <text x={M.left + plotWidth / 2} y={axisY + 42} textAnchor="middle" fontSize={S.axisFontSize} fontWeight={S.axisFontBold ? "700" : "400"} fill="#15191f" fontFamily={figureFont} style={{ cursor: "pointer" }} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Titres des axes", sizeKey: "axisFontSize", boldKey: "axisFontBold" })}>{activeMode === "drx" && drxAxisMode === "d" ? "d-spacing (Å)" : activeMode === "drx" && drxAxisMode === "q" ? "Q (Å⁻¹)" : S.xlabel}</text>
                        {activeMode === "drx" && S.showSecondaryXAxis && <g>
                          <line x1={M.left} x2={M.left + plotWidth} y1={M.top} y2={M.top} stroke="#15191f" strokeWidth="0.8" />
                          {xTickObjects.map((tick) => { const value = convertDrxX(tick.x, S.secondaryXAxisMode || "d", Number(S.wavelength) || 1.5406); return <g key={`secondary-${tick.x}`}><line x1={xToPx(tick.x)} x2={xToPx(tick.x)} y1={M.top} y2={M.top - 4} stroke="#15191f" strokeWidth="0.8"/><text x={xToPx(tick.x)} y={M.top - 7} textAnchor="middle" fontSize={Math.max(6, S.tickFontSize - 2)} fontWeight={S.tickFontBold ? "700" : "400"} fill="#15191f" onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Graduations", sizeKey: "tickFontSize", boldKey: "tickFontBold" })}>{Number.isFinite(value) ? value.toFixed(2) : ""}</text></g>; })}
                          <text x={M.left + plotWidth / 2} y={Math.max(9, M.top - 22)} textAnchor="middle" fontSize={Math.max(7, S.axisFontSize - 2)} fontWeight={S.axisFontBold ? "700" : "400"} fill="#15191f" onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Titres des axes", sizeKey: "axisFontSize", boldKey: "axisFontBold" })}>{S.secondaryXAxisMode === "q" ? "Q (Å⁻¹)" : S.secondaryXAxisMode === "2theta" ? "2θ (°)" : "d-spacing (Å)"}</text>
                        </g>}
                        {activeMode === "drx" && S.showSecondaryYAxis && <g>
                          <line x1={M.left + plotWidth} x2={M.left + plotWidth} y1={M.top} y2={M.top + mainHeight} stroke="#15191f" strokeWidth="0.8" />
                          {[0, 25, 50, 75, 100].map((value) => { const yy = M.top + mainHeight - (value / 100) * mainHeight; return <g key={`secondary-y-${value}`}><line x1={M.left + plotWidth} x2={M.left + plotWidth + 4} y1={yy} y2={yy} stroke="#15191f" strokeWidth="0.8"/><text x={M.left + plotWidth + 7} y={yy + 3} fontSize={Math.max(6, S.tickFontSize - 2)} fontWeight={S.tickFontBold ? "700" : "400"} fill="#15191f" onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Graduations", sizeKey: "tickFontSize", boldKey: "tickFontBold" })}>{value}</text></g>; })}
                          <text x={M.left + plotWidth + 38} y={M.top + mainHeight / 2} textAnchor="middle" fontSize={Math.max(7, S.axisFontSize - 2)} fontWeight={S.axisFontBold ? "700" : "400"} fill="#15191f" transform={`rotate(90 ${M.left + plotWidth + 38} ${M.top + mainHeight / 2})`} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Titres des axes", sizeKey: "axisFontSize", boldKey: "axisFontBold" })}>Relative intensity (%)</text>
                        </g>}
                        {breakActive && <g>
                          <path d={`M${xToPx(Number(S.brokenAxisStart)) + 2} ${axisY - 4}l5 8M${xToPx(Number(S.brokenAxisStart)) + 8} ${axisY - 4}l5 8`} stroke="#15191f" strokeWidth="1" fill="none" />
                          <path d={`M${xToPx(Number(S.brokenAxisStart)) + 2} ${M.top - 4}l5 8M${xToPx(Number(S.brokenAxisStart)) + 8} ${M.top - 4}l5 8`} stroke="#15191f" strokeWidth="1" fill="none" />
                        </g>}
                      </g>;
                    })()}
                    {dragPreview?.type === "overlayValueMove" && dragPreview.snapped && <circle data-ui-only="true" cx={dragPreview.stickX} cy={dragPreview.stickY + dragPreview.dy} r="7" fill="none" stroke="#e0507a" strokeWidth="1.2" strokeDasharray="3 2" pointerEvents="none" />}
                    {dragPreview?.type === "zoomRect" && <rect data-ui-only="true" x={Math.min(dragPreview.x1, dragPreview.x2)} y={M.top} width={Math.abs(dragPreview.x2 - dragPreview.x1)} height={mainHeight} fill="#dc7848" opacity="0.12" stroke="#dc7848" strokeWidth="1" strokeDasharray="4 3" pointerEvents="none" />}
                    {dragPreview?.type === "curveOrder" && <line data-ui-only="true" x1={M.left} x2={M.left + plotWidth + S.rightMargin - 8} y1={dragPreview.svgY} y2={dragPreview.svgY} stroke="#dc7848" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.8" />}
                    {cursor && <g data-ui-only="true" pointerEvents="none"><line x1={cursor.svgX} x2={cursor.svgX} y1={M.top} y2={M.top + mainHeight} stroke={cursor.snapped ? "#dc7848" : "#67707c"} strokeWidth="0.7" strokeDasharray="3 3" opacity="0.75"/></g>}
                    {Array.isArray(dragPreview?.guides) && dragPreview.guides.map((guide, index) => guide.axis === "x"
                      ? <line data-ui-only="true" key={`guide-${index}`} x1={guide.px} x2={guide.px} y1={M.top} y2={M.top + mainHeight} stroke="#e0507a" strokeWidth="1" strokeDasharray="5 3" opacity="0.85" pointerEvents="none" />
                      : <line data-ui-only="true" key={`guide-${index}`} x1={M.left} x2={M.left + plotWidth + S.rightMargin - 8} y1={guide.px} y2={guide.px} stroke="#e0507a" strokeWidth="1" strokeDasharray="5 3" opacity="0.85" pointerEvents="none" />)}
                  </svg>
                </div>
              </div>
            )}
          </div>

          <footer className="statusbar">
            <span title={project.name}><strong>{truncateLabel(project.name, 24)}</strong></span><span><strong>{modeLabel(activeMode)}</strong></span><span><strong>{patterns.length}</strong> {tr("patrons")}</span>
            <span><strong>{phases.length}</strong> {tr("phases")}</span>
            <span><strong>{visibleCount}</strong> {tr("visibles")}</span>
            {selectionCount > 0 && <span className="statusbar__selection"><strong>{selectionCount}</strong> {tr("sélectionné(s)")}</span>}
            <span><strong>{processed.reduce((sum, pattern) => sum + (pattern.detectedPeaks?.length || 0), 0)}</strong> {tr("pics détectés")}</span>
            <span>{LAYOUT_OPTIONS.find(([value]) => value === S.layoutMode)?.[1]}</span>
            <span className="statusbar__spacer" />
            {cursor ? <><span>x = <strong>{cursor.dataX.toFixed(S.mode === "drx" ? 3 : 1)}</strong></span>{cursor.nearest && <span>{activePattern?.label}: <strong>{cursor.nearest.y.toFixed(4)}</strong></span>}</> : <span>{tr("Déplacer le curseur sur la figure pour lire les coordonnées.")}</span>}
          </footer>
        </section>

        <aside className={`side-panel side-panel--right ${rightCollapsed ? "is-collapsed" : ""}`} aria-hidden={rightCollapsed}>
          {!rightCollapsed && <Resizer side="right" onReset={() => setRightWidth(350)} onResize={{ currentWidth: () => rightWidth, apply: (value) => setRightWidth(clamp(value, 280, 560)) }} />}
          <div className="panel-titlebar"><div><strong>{tr("Propriétés et outils")}</strong><span>{selectionCount ? `${selectionCount} ${tr("sélectionné(s)")}` : `${modeLabel(activeMode)} · ${patterns.length + phases.length + notes.length + zones.length} ${tr("éléments")}`}</span></div><IconButton icon="panelRight" title="Replier le panneau de propriétés" onClick={() => setRightCollapsed(true)} /></div>
          <nav className="panel-tabs panel-tabs--right">
            {[ ["inspector", "Inspecter", "cursor"], ["processing", "Analyser", "waveform"], ["compose", "Composer", "sparkles"], ["export", "Exporter", "download"] ].map(([value, label, icon], index) => <button type="button" key={value} className={rightTab === value ? "is-active" : ""} aria-current={rightTab === value ? "step" : undefined} title={`${index + 1}. ${tr(label)}`} onClick={() => setRightTab(value)}><small>{index + 1}</small><Icon name={icon} size={12} />{tr(label)}{value === "inspector" && selectionCount > 0 && <span>{selectionCount}</span>}</button>)}
          </nav>
          <div className="workflow-hint">{tr({ inspector: "Modifier uniquement l’élément sélectionné.", processing: "Prétraiter, détecter et mesurer les signaux.", compose: "Ajouter les références puis construire le rendu scientifique.", export: "Vérifier le résultat final avant téléchargement." }[rightTab])}</div>
          <div className="side-panel__content properties-scroll">
            {rightTab === "compose" && <div className="compose-navigation" role="tablist" aria-label={tr("Outils de composition")}>
              <button type="button" role="tab" aria-selected={composerTab === "references"} className={composerTab === "references" ? "is-active" : ""} onClick={() => setComposerTab("references")}><Icon name="phase" size={13} /><span>{tr("Références")}</span><small>{tr("Phases et annotations")}</small></button>
              <button type="button" role="tab" aria-selected={composerTab === "appearance"} className={composerTab === "appearance" ? "is-active" : ""} onClick={() => setComposerTab("appearance")}><Icon name="sparkles" size={13} /><span>{tr("Style")}</span><small>{tr("Axes, texte et mise en page")}</small></button>
            </div>}
            {rightTab === "compose" && composerTab === "appearance" && (
              <>
                <div className="complexity-control">
                  <div><strong>{tr("Niveau de réglage")}</strong><span>{tr(appearanceLevel === "essential" ? "Les contrôles nécessaires à une figure standard." : "Tous les réglages spécialisés et gabarits.")}</span></div>
                  <div className="segmented-control" role="group" aria-label={tr("Niveau des réglages d’apparence")}>
                    <button type="button" className={appearanceLevel === "essential" ? "is-active" : ""} onClick={() => setAppearanceLevel("essential")}>{tr("Essentiel")}</button>
                    <button type="button" className={appearanceLevel === "advanced" ? "is-active" : ""} onClick={() => setAppearanceLevel("advanced")}>{tr("Avancé")}</button>
                  </div>
                </div>
                <Section title="Texte et axes" targetId="axes-options">
                  <TextField targetId="figure-title" label="Titre" value={S.title} onChange={(value) => patchSettings("title", value)} placeholder="Titre facultatif" />
                  <TextField targetId="axis-x-label" label="Axe X" value={S.xlabel} onChange={(value) => patchSettings("xlabel", value)} />
                  <TextField targetId="axis-y-label" label="Axe Y" value={S.ylabel} onChange={(value) => patchSettings("ylabel", value)} />
                  <div className="two-columns"><NumberField label={`X minimum (${primaryAxisUnit})`} value={primaryAxisWindow.minimum} step={primaryAxisStep} onChange={(value) => commitPrimaryAxisBound("minimum", value)} /><NumberField label={`X maximum (${primaryAxisUnit})`} value={primaryAxisWindow.maximum} step={primaryAxisStep} onChange={(value) => commitPrimaryAxisBound("maximum", value)} /></div>
                  <NumberField label={`${tr("Pas des graduations")} (${primaryAxisUnit})`} value={S.xTickStep} min={0} step={primaryAxisStep} onChange={(value) => patchSettings("xTickStep", value)} hint="0 = automatique" />
                  <Toggle
                    label="Axe X décroissant"
                    checked={Boolean(S.reverseXAxis)}
                    onChange={(value) => patchSettings("reverseXAxis", value)}
                    description="Convention infrarouge : les nombres d’onde élevés à gauche."
                  />
                  <Toggle label="Grille verticale" checked={S.showGrid} onChange={(value) => patchSettings("showGrid", value)} />
                  <Toggle label="Axe Y gradué" checked={Boolean(S.showYAxisTicks)} onChange={(value) => patchSettings("showYAxisTicks", value)} description="Graduations et valeurs dans les unités d'affichage courantes (dépendent de la normalisation et de l'empilement)." />
                  {S.showYAxisTicks && <>
                    <NumberField label="Pas des graduations Y" value={S.yTickStep} min={0} step={0.05} onChange={(value) => patchSettings("yTickStep", value)} hint="0 = automatique" />
                    <Toggle label="Grille horizontale" checked={Boolean(S.showGridHorizontal)} onChange={(value) => patchSettings("showGridHorizontal", value)} />
                  </>}
                  {(S.showGrid || (S.showYAxisTicks && S.showGridHorizontal)) && <SliderField label="Opacité de la grille" value={S.gridOpacity} min={0.1} max={1} step={0.05} onChange={(value) => patchSettings("gridOpacity", value)} />}
                  <Field label="Libellés d'axes" hint="Applique les libellés par défaut de l'espace courant dans la langue choisie">
                    <div className="inline-actions">
                      <Button variant="secondary" onClick={() => patchSettingsValues(defaultAxisLabels(activeMode, "fr", irQuantity))}>Labels FR</Button>
                      <Button variant="secondary" onClick={() => patchSettingsValues(defaultAxisLabels(activeMode, "en", irQuantity))}>Labels EN</Button>
                    </div>
                  </Field>
                  {activeMode === "drx" && <>

                  <SelectField label="Axe X principal" value={S.xAxisMode || "2theta"} onChange={(value) => patchSettingsValues({ xAxisMode: value, xTickStep: 0 })} options={[["2theta", "2θ"], ["d", "d-spacing"], ["q", "Q"]]} />
                  <Toggle label="Axe X secondaire en haut" checked={S.showSecondaryXAxis} onChange={(value) => patchSettings("showSecondaryXAxis", value)} />
                  {S.showSecondaryXAxis && <SelectField label="Unité secondaire" value={S.secondaryXAxisMode} onChange={(value) => patchSettings("secondaryXAxisMode", value)} options={[["d", "d-spacing (Å)"], ["q", "Q (Å⁻¹)"], ["2theta", "2θ (°)"]]} />}
                  <Toggle label="Axe Y secondaire" checked={S.showSecondaryYAxis} onChange={(value) => patchSettings("showSecondaryYAxis", value)} />
                  <Toggle label="Encart de zoom" checked={S.showInset} onChange={(value) => patchSettings("showInset", value)} />
                  {S.showInset && <><SelectField label="Patron de l’encart" value={S.insetPatternId || ""} onChange={(value) => patchSettings("insetPatternId", value)} options={[["", "Patron sélectionné"], ...patterns.filter((pattern) => pattern.visible).map((pattern) => [pattern.id, pattern.label])]} /><div className="two-columns"><NumberField label={`X min encart (${primaryAxisUnit})`} value={insetAxisWindow.minimum} step={primaryAxisStep} onChange={(value) => commitInsetAxisBound("minimum", value)} /><NumberField label={`X max encart (${primaryAxisUnit})`} value={insetAxisWindow.maximum} step={primaryAxisStep} onChange={(value) => commitInsetAxisBound("maximum", value)} /></div><SelectField label="Placement" value={S.insetPlacementMode || "overlay"} onChange={(value) => patchSettings("insetPlacementMode", value)} options={[["overlay", "Superposition libre"], ["dock-right", "Zone réservée à droite"], ["dock-top", "Zone réservée en haut"]]} /><SliderField label="Largeur de l’encart" value={S.insetWidthPct} min={15} max={70} step={1} suffix="%" onChange={(value) => patchSettings("insetWidthPct", value)} /><SliderField label="Hauteur de l’encart" value={S.insetHeightPct} min={15} max={70} step={1} suffix="%" onChange={(value) => patchSettings("insetHeightPct", value)} /><Toggle label="Rectangle de la zone agrandie" checked={S.insetShowSourceRect !== false} onChange={(value) => patchSettings("insetShowSourceRect", value)} />{S.insetShowSourceRect !== false && <Toggle label="Traits de liaison" checked={S.insetShowConnectors !== false} onChange={(value) => patchSettings("insetShowConnectors", value)} />}<div className="callout">{tr("En superposition, déplacer l’encart par sa barre supérieure et le redimensionner avec la poignée. Un contour rouge signale une collision probable avec les annotations. Les docks agrandissent la figure sans masquer les données.")}</div><div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => history.set((current) => updateWorkspaceProject(current, activeMode, (workspace) => ({ ...workspace, settings: { ...workspace.settings, insetXFrac: 0.63, insetYFrac: 0.06, insetWidthPct: 34, insetHeightPct: 34 } })))}>Réinitialiser l’encart</Button></div></>}
                
                  </>}
                  {isIr && <SelectField
                    label="Grandeur en ordonnée"
                    value={irQuantity}
                    onChange={setIrQuantity}
                    options={[["absorbance", "Absorbance"], ["transmittance", "Transmittance (%)"]]}
                  />}
                </Section>
                {isIr && <Section title="Infrarouge" targetId="ir-options">
                  <div className="callout">{tr("Conversion appliquée à la volée sur les spectres importés : %T = 100 × 10⁻ᴬ et A = 2 − log₁₀(%T). En transmittance, la détection de pics cherche les minima et la normalisation est déconseillée.")}</div>
                  {activeIrMetadata && (
                    <Field label="Fiche d’acquisition OPUS">
                      <div className="info-box">
                        {Object.entries(activeIrMetadata).map(([key, value]) => <span key={key}>{key} : {value}</span>)}
                      </div>
                    </Field>
                  )}
                </Section>}
                <Section title="Disposition">
                  <SelectField label="Mode de représentation" value={S.layoutMode} onChange={(value) => patchSettings("layoutMode", value)} options={LAYOUT_OPTIONS} />
                  {S.layoutMode === "difference" && <SelectField label="Patron de référence" value={S.differenceReferenceId} onChange={(value) => patchSettings("differenceReferenceId", value)} options={[["", tr("Premier patron visible")], ...patterns.filter((pattern) => pattern.visible).map((pattern) => [pattern.id, pattern.label])]} />}
                  {S.layoutMode === "waterfall" && <SliderField label="Décalage horizontal par patron" value={S.waterfallXShiftPct} min={-8} max={8} step={0.1} suffix="%" onChange={(value) => patchSettings("waterfallXShiftPct", value)} />}
                  {S.layoutMode !== "overlay" && <SliderField label="Décalage vertical" value={S.vstep} min={0.1} max={4} step={0.05} onChange={(value) => patchSettings("vstep", value)} />}
                  <SliderField label="Échelle verticale" value={S.pxPerUnit} min={30} max={220} step={5} suffix="px" onChange={(value) => patchSettings("pxPerUnit", value)} />
                  {S.layoutMode !== "overlay" && <Toggle label="Inverser l’ordre" checked={S.reverseStack} onChange={(value) => patchSettings("reverseStack", value)} />}
                </Section>
                <Section title="Typographie" defaultOpen={false}>
                  <SelectField label="Police de la figure" value={S.fontFamily || "Arial, Helvetica, sans-serif"} onChange={(value) => patchSettings("fontFamily", value)} options={[["Arial, Helvetica, sans-serif", "Arial / Helvetica"], ["Helvetica, Arial, sans-serif", "Helvetica"], ["Times New Roman, Times, serif", "Times New Roman"], ["Georgia, serif", "Georgia"], ["Calibri, Candara, sans-serif", "Calibri"]]} />
                  <div className="type-role-grid">
                    <SliderField label="Titre" value={S.titleFontSize} min={8} max={48} step={0.5} suffix="pt" onChange={(value) => patchSettings("titleFontSize", value)} /><Toggle label="Titre en gras" checked={S.titleFontBold} onChange={(value) => patchSettings("titleFontBold", value)} />
                    <SliderField label="Titres des axes" value={S.axisFontSize} min={6} max={36} step={0.5} suffix="pt" onChange={(value) => patchSettings("axisFontSize", value)} /><Toggle label="Axes en gras" checked={S.axisFontBold} onChange={(value) => patchSettings("axisFontBold", value)} />
                    <SliderField label="Graduations" value={S.tickFontSize} min={5} max={30} step={0.5} suffix="pt" onChange={(value) => patchSettings("tickFontSize", value)} /><Toggle label="Graduations en gras" checked={S.tickFontBold} onChange={(value) => patchSettings("tickFontBold", value)} />
                    <SliderField label="Labels de patrons" value={S.patternLabelSize} min={6} max={42} step={0.5} suffix="pt" onChange={(value) => patchSettings("patternLabelSize", value)} /><Toggle label="Labels de patrons en gras" checked={S.patternLabelBold} onChange={(value) => patchSettings("patternLabelBold", value)} />
                    <SliderField label="Labels de pics" value={S.peakLabelSize} min={5} max={24} step={0.5} suffix="pt" onChange={(value) => patchSettings("peakLabelSize", value)} /><Toggle label="Labels de pics en gras" checked={S.peakLabelBold} onChange={(value) => patchSettings("peakLabelBold", value)} />
                    <SliderField label="Titres des panneaux" value={S.panelTitleFontSize} min={5} max={30} step={0.5} suffix="pt" onChange={(value) => patchSettings("panelTitleFontSize", value)} /><Toggle label="Titres de panneaux en gras" checked={S.panelTitleFontBold} onChange={(value) => patchSettings("panelTitleFontBold", value)} />
                    <SliderField label="Axes des panneaux" value={S.panelAxisFontSize} min={5} max={24} step={0.5} suffix="pt" onChange={(value) => patchSettings("panelAxisFontSize", value)} /><Toggle label="Axes de panneaux en gras" checked={S.panelAxisFontBold} onChange={(value) => patchSettings("panelAxisFontBold", value)} />
                  </div>
                  <div className="callout">Cliquer sur un texte de la figure affiche aussi les contrôles de taille et de gras directement sur la feuille.</div>
                </Section>
                {appearanceLevel === "advanced" && <Section title="Typographie des annotations et encarts" defaultOpen={false}>
                  <div className="type-role-grid">
                    <SliderField label="Annotations de phases" value={S.annotFontSize} min={5} max={24} step={0.5} suffix="pt" onChange={(value) => patchSettings("annotFontSize", value)} /><Toggle label="Annotations en gras" checked={S.annotFontBold} onChange={(value) => patchSettings("annotFontBold", value)} />
                    <SliderField label="Clé des abréviations" value={S.abbrevKeyFontSize} min={5} max={24} step={0.5} suffix="pt" onChange={(value) => patchSettings("abbrevKeyFontSize", value)} /><Toggle label="Clé en gras" checked={S.abbrevKeyFontBold} onChange={(value) => patchSettings("abbrevKeyFontBold", value)} />
                    <SliderField label="Noms des zones" value={S.zoneLabelFontSize} min={5} max={24} step={0.5} suffix="pt" onChange={(value) => patchSettings("zoneLabelFontSize", value)} /><Toggle label="Zones en gras" checked={S.zoneLabelFontBold} onChange={(value) => patchSettings("zoneLabelFontBold", value)} />
                    <SliderField label="Titre de l’encart" value={S.insetLabelFontSize} min={5} max={24} step={0.5} suffix="pt" onChange={(value) => patchSettings("insetLabelFontSize", value)} /><Toggle label="Titre d’encart en gras" checked={S.insetLabelFontBold} onChange={(value) => patchSettings("insetLabelFontBold", value)} />
                    <SliderField label="Plage de l’encart" value={S.insetRangeFontSize} min={5} max={20} step={0.5} suffix="pt" onChange={(value) => patchSettings("insetRangeFontSize", value)} /><Toggle label="Plage d’encart en gras" checked={S.insetRangeFontBold} onChange={(value) => patchSettings("insetRangeFontBold", value)} />
                    <SliderField label="Noms du panneau de références" value={S.referenceRowFontSize} min={5} max={24} step={0.5} suffix="pt" onChange={(value) => patchSettings("referenceRowFontSize", value)} /><Toggle label="Noms des références en gras" checked={S.referenceRowFontBold} onChange={(value) => patchSettings("referenceRowFontBold", value)} />
                    <SliderField label="Sous-titres des références" value={S.referenceSubtitleFontSize} min={5} max={20} step={0.5} suffix="pt" onChange={(value) => patchSettings("referenceSubtitleFontSize", value)} /><Toggle label="Sous-titres en gras" checked={S.referenceSubtitleFontBold} onChange={(value) => patchSettings("referenceSubtitleFontBold", value)} />
                  </div>
                </Section>}

                <Section title="Courbes">
                  <Toggle label="Afficher les noms des patrons" checked={S.showPatternLabels !== false} onChange={(value) => patchSettings("showPatternLabels", value)} description="Masque les étiquettes placées à droite des courbes, sans modifier les noms dans la liste des données." />
                  <SliderField label="Épaisseur" value={S.lineWidth} min={0.3} max={4} step={0.05} onChange={(value) => patchSettings("lineWidth", value)} />
                  <Toggle label="Remplissage sous les courbes" checked={S.showFill} onChange={(value) => patchSettings("showFill", value)} />
                  {S.showFill && <SliderField label="Opacité" value={S.fillAlpha} min={0} max={0.5} step={0.01} onChange={(value) => patchSettings("fillAlpha", value)} />}
                  <Toggle label="Légende encadrée des courbes" checked={Boolean(S.showCurveLegend)} onChange={(value) => patchSettings("showCurveLegend", value)} description="Encart déplaçable à la souris ; complète ou remplace les étiquettes en marge droite." />
                  {S.showCurveLegend && <>
                    <SliderField label="Taille de la légende" value={S.curveLegendFontSize ?? 10} min={6} max={20} step={0.5} suffix="pt" onChange={(value) => patchSettings("curveLegendFontSize", value)} />
                    <Toggle label="Légende en gras" checked={S.curveLegendFontBold} onChange={(value) => patchSettings("curveLegendFontBold", value)} />
                    <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => patchSettingsValues({ curveLegendX: null, curveLegendY: null })}>Réinitialiser la position</Button></div>
                  </>}
                  {S.layoutMode === "waterfall" && <><SliderField label="Réduction d’échelle par courbe" value={S.waterfallScaleDecay} min={0} max={20} step={0.5} suffix="%" onChange={(value) => patchSettings("waterfallScaleDecay", value)} /><SliderField label="Perte d’opacité par courbe" value={S.waterfallOpacityDecay} min={0} max={20} step={0.5} suffix="%" onChange={(value) => patchSettings("waterfallOpacityDecay", value)} /><SliderField label="Perspective" value={S.waterfallPerspective} min={-0.5} max={1.5} step={0.05} onChange={(value) => patchSettings("waterfallPerspective", value)} /></>}
                </Section>
                <Section title="Couleurs">
                  <SelectField label="Palette" value={S.cmap} onChange={(value) => patchSettings("cmap", value)} options={Object.keys(CMAPS)} />
                  <div className="colormap-preview" style={{ background: cmapGradient(S.cmap, S.cmapMin, S.cmapMax, S.cmapReverse) }} />
                  <SliderField label="Borne inférieure" value={S.cmapMin} min={0} max={1} step={0.05} onChange={(value) => patchSettings("cmapMin", Math.min(value, S.cmapMax))} />
                  <SliderField label="Borne supérieure" value={S.cmapMax} min={0} max={1} step={0.05} onChange={(value) => patchSettings("cmapMax", Math.max(value, S.cmapMin))} />
                  <Toggle label="Inverser la palette" checked={S.cmapReverse} onChange={(value) => patchSettings("cmapReverse", value)} />
                  <Toggle label="Couleurs manuelles" checked={S.useCustomColors} onChange={(value) => patchSettings("useCustomColors", value)} />
                </Section>

                {appearanceLevel === "advanced" && <Section title="Dimensions et gabarits">
                  <SelectField label="Gabarit de revue" value="" onChange={applyJournalPreset} options={[["", "Choisir…"], ...Object.entries(JOURNAL_PRESETS).map(([key, preset]) => [key, preset.label])]} />
                  <SelectField label="Preset général" value="" onChange={applyPreset} options={[["", "Choisir…"], ...Object.entries(PRESETS).map(([key, preset]) => [key, preset.label])]} />
                  <SliderField label="Largeur de figure" value={S.figWidth} min={500} max={3000} step={25} suffix="px" onChange={(value) => patchSettings("figWidth", value)} />
                  <SliderField label="Marge droite" value={S.rightMargin} min={50} max={400} step={5} suffix="px" onChange={(value) => patchSettings("rightMargin", value)} />
                </Section>}

                {appearanceLevel === "advanced" && <Section title="Composition multi-panneaux" defaultOpen={false}>
                  <SelectField label="Structure de la figure" value={S.figureLayoutMode || "single"} onChange={(value) => patchSettings("figureLayoutMode", value)} options={FIGURE_LAYOUT_OPTIONS} />
                  {S.figureLayoutMode === "grid" && <SliderField label="Colonnes" value={S.gridColumns} min={1} max={4} step={1} onChange={(value) => patchSettings("gridColumns", Math.round(value))} />}
                  {S.figureLayoutMode !== "single" && <><SliderField label="Espace entre panneaux" value={S.panelGap} min={4} max={60} step={2} suffix="px" onChange={(value) => patchSettings("panelGap", value)} /><Toggle label="Lettrage automatique (a), (b)…" checked={S.panelLettering} onChange={(value) => patchSettings("panelLettering", value)} /><Toggle label="Légende partagée" checked={S.sharedPatternLegend} onChange={(value) => patchSettings("sharedPatternLegend", value)} /></>}
                  {["sideBySide", "beforeAfter", "differenceRatio"].includes(S.figureLayoutMode) && <SelectField label="Patron A" value={S.comparisonPatternAId || ""} onChange={(value) => patchSettings("comparisonPatternAId", value)} options={[["", "Sélection / premier visible"], ...patterns.filter((pattern) => pattern.visible).map((pattern) => [pattern.id, pattern.label])]} />}
                  {["sideBySide", "differenceRatio"].includes(S.figureLayoutMode) && <SelectField label="Patron B" value={S.comparisonPatternBId || ""} onChange={(value) => patchSettings("comparisonPatternBId", value)} options={[["", "Deuxième patron visible"], ...patterns.filter((pattern) => pattern.visible).map((pattern) => [pattern.id, pattern.label])]} />}
                  <div className="callout">{tr("Les modes multi-panneaux utilisent un rendu volontairement simplifié : annotations de phases, notes et panneau de références sont réservés à la figure unique afin d’éviter une composition illisible.")}</div>
                </Section>}

                {appearanceLevel === "advanced" && <Section title="Axe X brisé" defaultOpen={false}>
                  <Toggle label="Activer la coupure" checked={S.brokenAxisEnabled} onChange={(value) => patchSettings("brokenAxisEnabled", value)} description={activeMode === "drx" ? "En DRX, disponible lorsque l’axe principal est 2θ." : "Supprime une plage sans intérêt entre deux régions spectrales."} />
                  {S.brokenAxisEnabled && <>
                    <div className="two-columns">
                      <NumberField label="Début de coupure" value={S.brokenAxisStart} step={activeMode === "drx" ? 0.5 : 10} suffix={primaryAxisUnit} onChange={(value) => patchSettings("brokenAxisStart", value)} />
                      <NumberField label="Fin de coupure" value={S.brokenAxisEnd} step={activeMode === "drx" ? 0.5 : 10} suffix={primaryAxisUnit} onChange={(value) => patchSettings("brokenAxisEnd", value)} />
                    </div>
                    <SliderField label="Largeur visuelle de coupure" value={S.brokenAxisGapPx} min={8} max={50} step={1} suffix="px" onChange={(value) => patchSettings("brokenAxisGapPx", value)} />
                    {!breakActive && <div className="callout">La coupure n’est pas appliquée : les bornes doivent être strictement comprises dans la fenêtre affichée{activeMode === "drx" ? " et l’axe principal doit être 2θ" : ""}.</div>}
                  </>}
                </Section>}


                {appearanceLevel === "advanced" && <Section title="Styles réutilisables" defaultOpen={false}>
                  <TextField label="Nom du style" value={templateName} onChange={setTemplateName} placeholder="Ex. Water Research · DRX" />
                  <div className="inline-actions"><Button variant="secondary" icon="save" onClick={saveStyleTemplate}>Enregistrer le style courant</Button></div>
                  {styleTemplates.length ? <div className="library-list">{styleTemplates.map((entry) => <div key={entry.id} className="library-row"><span><strong>{entry.name}</strong><small>{new Date(entry.savedAt).toLocaleDateString(uiLocale())}</small></span><Button variant="secondary" onClick={() => applyStyleTemplate(entry)}>Appliquer</Button><IconButton icon="trash" danger title="Supprimer" onClick={() => setStyleTemplates((current) => current.filter((item) => item.id !== entry.id))} /></div>)}</div> : <div className="callout">{tr("Aucun style local enregistré.")}</div>}
                </Section>}
              </>
            )}

            {rightTab === "processing" && (
              <>
                <Section title="Prétraitement">
                  <SliderField label="Lissage — moyenne mobile" value={S.smoothW} min={1} max={41} step={1} onChange={(value) => patchSettings("smoothW", value)} />
                  <SliderField label="Écrêtage percentile" value={S.clipPct} min={90} max={100} step={0.1} suffix="%" onChange={(value) => patchSettings("clipPct", value)} />
                  <SelectField label="Normalisation" value={S.normalizeMode} onChange={(value) => patchSettings("normalizeMode", value)} options={NORMALIZATION_OPTIONS} />
                  {S.normalizeMode === "referencePeak" && <div className="two-columns"><NumberField label="Position du pic" value={S.normalizeReferenceX} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => patchSettings("normalizeReferenceX", value)} /><NumberField label="Demi-fenêtre" value={S.normalizeReferenceWindow} min={0.01} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => patchSettings("normalizeReferenceWindow", value)} /></div>}
                  {S.normalizeMode === "none" && <div className="callout">{tr("Les amplitudes relatives sont conservées ; une échelle globale commune est utilisée uniquement pour l’affichage.")}</div>}
                </Section>

                <Section title="Correction de ligne de base">
                  <SelectField label="Méthode" value={S.baselineMode} onChange={(value) => patchSettings("baselineMode", value)} options={BASELINE_OPTIONS} />
                  {S.baselineMode === "rolling" && <SliderField label="Fenêtre" value={S.baselineWindow} min={5} max={501} step={2} suffix="pts" onChange={(value) => patchSettings("baselineWindow", Math.round(value) | 1)} />}
                  {S.baselineMode === "snip" && <SliderField label="Itérations SNIP" value={S.snipIterations} min={4} max={120} step={1} onChange={(value) => patchSettings("snipIterations", Math.round(value))} />}
                  {S.baselineMode === "polynomial" && <SliderField label="Ordre du polynôme" value={S.baselinePolyOrder} min={1} max={6} step={1} onChange={(value) => patchSettings("baselinePolyOrder", Math.round(value))} />}
                  {S.baselineMode === "als" && <SliderField label="Rigidité log₁₀(λ)" value={S.baselineLambdaLog} min={1} max={9} step={0.25} onChange={(value) => patchSettings("baselineLambdaLog", value)} />}
                  {["polynomial", "als"].includes(S.baselineMode) && <><SliderField label="Asymétrie p" value={S.baselineAsymmetry} min={0.001} max={0.2} step={0.001} onChange={(value) => patchSettings("baselineAsymmetry", value)} /><SliderField label="Itérations" value={S.baselineIterations} min={1} max={20} step={1} onChange={(value) => patchSettings("baselineIterations", Math.round(value))} /></>}
                  {S.baselineMode !== "none" && <Toggle label="Ramener les valeurs négatives à zéro" checked={S.baselineClamp} onChange={(value) => patchSettings("baselineClamp", value)} />}
                  {S.baselineMode === "als" && <div className="callout">{tr("ALS est plus coûteux que les autres méthodes. Une rigidité élevée produit une ligne de base plus lisse.")}</div>}
                </Section>

                <Section title="Repérage des pics expérimentaux" defaultOpen={false}>
                  <div className="callout">{tr("Détecte les maxima du patron sélectionné pour les exporter, les suivre dans une série ou lancer un ajustement. Ce module ne réalise pas une identification de phase.")}</div>
                  <Toggle label="Afficher les marqueurs sur la figure" checked={S.showDetectedPeaks} onChange={(value) => patchSettings("showDetectedPeaks", value)} />
                  <Toggle label="Afficher les valeurs des pics" checked={S.showPeakLabels !== false} onChange={(value) => patchSettings("showPeakLabels", value)} />
                  <div className="callout">{tr("Outil « Pics » de la barre du canevas : un clic sur une courbe ajoute un pic au maximum local le plus proche ; un clic sur un marqueur ou sa valeur le retire. Les pics ajoutés sont pleins, les pics détectés sont creux.")}</div>
                  {activePattern && ((activePattern.userPeaks?.length || 0) + (activePattern.excludedPeaks?.length || 0) > 0) && <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => resetPeakEdits(activePattern.id)}>Réinitialiser ajouts/retraits ({(activePattern.userPeaks?.length || 0)} + / {(activePattern.excludedPeaks?.length || 0)} −)</Button></div>}
                  <SliderField label="Hauteur minimale" value={S.peakMinHeight} min={0} max={100} step={1} suffix="%" onChange={(value) => patchSettings("peakMinHeight", value)} />
                  <SliderField label="Proéminence minimale" value={S.peakMinProminence} min={0} max={100} step={0.5} suffix="%" onChange={(value) => patchSettings("peakMinProminence", value)} />
                  <NumberField label="Distance minimale X" value={S.peakMinDistance} min={0} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => patchSettings("peakMinDistance", value)} />
                  <SliderField label="Fenêtre de proéminence" value={S.peakLookaround} min={2} max={250} step={1} suffix="pts" onChange={(value) => patchSettings("peakLookaround", Math.round(value))} />
                  <SliderField label="Nombre maximal de labels" value={S.peakMaxLabels} min={0} max={100} step={1} onChange={(value) => patchSettings("peakMaxLabels", Math.round(value))} />
                  {activeProcessedPattern ? <div className="peak-results">
                    <div className="peak-results__header"><strong>{truncateLabel(activeProcessedPattern.label, 28)}</strong><span>{activeProcessedPattern.detectedPeaks?.length || 0} maximum(s)</span></div>
                    <div className="peak-results__table"><div className="peak-results__row is-head"><span>{tr("Position")}</span><span>{tr("Hauteur")}</span><span>{tr("Prom.")}</span><span>{tr("Actions")}</span></div>{(activeProcessedPattern.detectedPeaks || []).slice(0, 30).map((peak, index) => <div className="peak-results__row" key={`${peak.x}-${index}`}><span>{Number(peak.x).toFixed(activeMode === "drx" ? 4 : 1)}{peak.manual ? " ✎" : ""}</span><span>{Number(peak.heightPct).toFixed(1)} %</span><span>{Number(peak.prominencePct).toFixed(1)} %</span><span><button type="button" title={tr("Ajouter au suivi de série")} onClick={() => addDetectedPeakToTracking(peak, index)}>{tr("Suivre")}</button>{activeMode === "drx" && <button type="button" title={tr("Ajuster ce pic")} onClick={() => fitDetectedPeak(peak)}>{tr("Ajuster")}</button>}<button type="button" title={tr(peak.manual ? "Supprimer ce pic ajouté manuellement" : "Exclure ce pic de la détection")} onClick={() => removePeak(activeProcessedPattern.id, peak)}>{tr("Retirer")}</button></span></div>)}</div>
                  </div> : <div className="callout">{tr("Sélectionner un patron visible pour afficher sa table de maxima.")}</div>}
                  <div className="inline-actions"><Button variant="secondary" icon="csv" onClick={exportDetectedPeaksCsv}>Exporter la table complète</Button></div>
                </Section>

                <Section title="Ajustement multi-pics (déconvolution)" defaultOpen={false}>
                  <div className="callout">{tr("Ajuste simultanément plusieurs profils sur une fenêtre du patron sélectionné : fond linéaire plus pseudo-Voigt à η partagé. Utile pour déconvoluer un massif (ν1 phosphate / carbonate, doublets DRX…). Les aires relatives sont rapportées à la somme des composantes.")}</div>
                  <TextField label="Centres initiaux" placeholder={activeMode === "drx" ? "31.77; 32.2; 32.9" : "950; 962; 1005"} value={multiFitDraft.centers} onChange={(value) => setMultiFitDraft((current) => ({ ...current, centers: value }))} />
                  <div className="two-columns">
                    <NumberField label="Fenêtre X min" value={multiFitDraft.xmin} step={activeMode === "drx" ? 0.1 : 1} onChange={(value) => setMultiFitDraft((current) => ({ ...current, xmin: value }))} />
                    <NumberField label="Fenêtre X max" value={multiFitDraft.xmax} step={activeMode === "drx" ? 0.1 : 1} onChange={(value) => setMultiFitDraft((current) => ({ ...current, xmax: value }))} />
                  </div>
                  <SelectField label="Profil" value={multiFitDraft.model} onChange={(value) => setMultiFitDraft((current) => ({ ...current, model: value }))} options={[["pseudoVoigt", "Pseudo-Voigt"], ["gaussian", "Gaussien"], ["lorentzian", "Lorentzien"]]} />
                  <div className="inline-actions"><Button variant="primary" onClick={runMultiFit}>Ajuster</Button>{multiFitResult && <><Button variant="secondary" icon="csv" onClick={exportMultiFitCsv}>CSV</Button><Button variant="secondary" icon="close" onClick={() => setMultiFitResult(null)}>Effacer</Button></>}</div>
                  {multiFitResult && <div className="peak-results">
                    <div className="peak-results__header"><strong>R² = {multiFitResult.r2.toFixed(4)}</strong><span>η = {multiFitResult.eta} · {multiFitResult.xmin.toFixed(activeMode === "drx" ? 2 : 0)}–{multiFitResult.xmax.toFixed(activeMode === "drx" ? 2 : 0)}</span></div>
                    <div className="peak-results__table">
                      <div className="peak-results__row is-head"><span>{tr("Centre")}</span><span>{tr("FWHM")}</span><span>{tr("Aire")}</span><span>{tr("% aire")}</span></div>
                      {multiFitResult.components.map((component, index) => <div className="peak-results__row" key={`mf-${index}`}><span>{component.center.toFixed(activeMode === "drx" ? 3 : 1)}</span><span>{component.fwhm.toFixed(activeMode === "drx" ? 3 : 1)}</span><span>{component.area.toExponential(2)}</span><span>{component.areaPct.toFixed(1)} %</span></div>)}
                    </div>
                  </div>}
                </Section>
                {supportsZones && <Section title="Intégration des zones" defaultOpen={false}>
                  <div className="callout">{tr("Aire du signal dans chaque zone nommée, pour chaque patron visible, avec rapport de bandes optionnel (typiquement carbonate / phosphate). Les zones se définissent dans l'onglet de gauche.")}</div>
                  {zones.length < 1 ? <div className="callout">{tr("Aucune zone définie.")}</div> : <>
                    <SelectField label="Signal intégré" value={zoneSignal} onChange={setZoneSignal} options={[["corrected", "Corrigé du fond"], ["normalized", "Normalisé"], ["raw", "Brut"]]} />
                    <div className="two-columns">
                      <SelectField label="Ratio · numérateur" value={zoneRatio.a} onChange={(value) => setZoneRatio((current) => ({ ...current, a: value }))} options={[["", "—"], ...zones.map((zone) => [zone.id, zone.name])]} />
                      <SelectField label="Ratio · dénominateur" value={zoneRatio.b} onChange={(value) => setZoneRatio((current) => ({ ...current, b: value }))} options={[["", "—"], ...zones.map((zone) => [zone.id, zone.name])]} />
                    </div>
                    {zoneAreaRows.length > 0 && <div className="peak-results"><div className="peak-results__table">
                      <div className="peak-results__row is-head"><span>{tr("Patron")}</span>{zones.slice(0, 2).map((zone) => <span key={zone.id}>{truncateLabel(zone.name, 10)}</span>)}<span>{zoneRatio.a && zoneRatio.b ? "Ratio" : ""}</span></div>
                      {zoneAreaRows.map((row) => {
                        const numerator = row.areas[zoneRatio.a];
                        const denominator = row.areas[zoneRatio.b];
                        const ratio = Number.isFinite(numerator) && Number.isFinite(denominator) && Math.abs(denominator) > 1e-12 ? numerator / denominator : null;
                        return <div className="peak-results__row" key={row.patternId}><span>{truncateLabel(row.pattern, 14)}</span>{zones.slice(0, 2).map((zone) => <span key={zone.id}>{Number.isFinite(row.areas[zone.id]) ? row.areas[zone.id].toExponential(2) : "—"}</span>)}<span>{ratio !== null ? ratio.toFixed(4) : ""}</span></div>;
                      })}
                    </div></div>}
                    <div className="inline-actions"><Button variant="secondary" icon="csv" onClick={exportZoneAreasCsv}>Exporter toutes les aires (CSV)</Button></div>
                  </>}
                </Section>}
                <Section title="Aligner une série d’acquisitions" defaultOpen={false}>
                  <div className="callout">{tr("Cette opération compense de petits décalages entre acquisitions comparables. Elle ne remplace pas la correction instrumentale du zéro DRX, située plus bas.")}</div>
                  <SelectField label="Acquisition de référence" value={S.alignmentReferenceId} onChange={(value) => { patchSettings("alignmentReferenceId", value); setAlignmentPreview(null); }} options={[["", activePattern ? `${tr("Sélection")} : ${activePattern.label}` : tr("Premier patron visible")], ...patterns.filter((pattern) => pattern.visible).map((pattern) => [pattern.id, pattern.label])]} />
                  <div className="two-columns"><NumberField label="X min de corrélation" value={S.alignmentXMin !== null && S.alignmentXMin !== "" && Number.isFinite(Number(S.alignmentXMin)) ? S.alignmentXMin : S.xmin} step={S.mode === "drx" ? 0.1 : 5} onChange={(value) => { patchSettings("alignmentXMin", value); setAlignmentPreview(null); }} /><NumberField label="X max de corrélation" value={S.alignmentXMax !== null && S.alignmentXMax !== "" && Number.isFinite(Number(S.alignmentXMax)) ? S.alignmentXMax : S.xmax} step={S.mode === "drx" ? 0.1 : 5} onChange={(value) => { patchSettings("alignmentXMax", value); setAlignmentPreview(null); }} /></div>
                  <NumberField label="Décalage maximal ±" value={S.alignmentMaxShift} min={0} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => { patchSettings("alignmentMaxShift", value); setAlignmentPreview(null); }} />
                  <NumberField label="Pas de recherche" value={S.alignmentStep} min={0.0001} step={S.mode === "drx" ? 0.005 : 0.1} onChange={(value) => { patchSettings("alignmentStep", value); setAlignmentPreview(null); }} />
                  <div className="inline-actions"><Button variant="secondary" onClick={previewVisiblePatternAlignment}>Calculer la prévisualisation</Button>{alignmentPreview && <Button variant="primary" onClick={applyAlignmentPreview}>Appliquer</Button>}<Button variant="secondary" icon="reset" onClick={removeAutomaticAlignment}>Retirer l’alignement auto</Button></div>
                  {alignmentPreview && <div className="alignment-preview"><div className="alignment-preview__header"><strong>Référence : {truncateLabel(alignmentPreview.referenceLabel, 24)}</strong><span>{alignmentPreview.xmin}–{alignmentPreview.xmax}</span></div>{alignmentPreview.results.map((result) => <div className="alignment-preview__row" key={result.id}><span>{truncateLabel(result.label, 24)}{result.reference ? " · référence" : result.locked ? " · verrouillé" : ""}</span><strong>{result.shift >= 0 ? "+" : ""}{result.shift.toFixed(activeMode === "drx" ? 4 : 1)}</strong><small>{Number.isFinite(result.score) ? `r = ${result.score.toFixed(4)}` : "corrélation indisponible"}</small></div>)}</div>}
                </Section>

                {activeMode === "drx" && <>
                  <Section title="Instrument et rayonnement" defaultOpen={false}>
                    <SelectField label="Source" value={S.radiationPreset || "CuKa1"} onChange={applyRadiationPreset} options={Object.entries(RADIATION_PRESETS).map(([key, value]) => [key, value.label])} />
                    <NumberField label="Longueur d’onde λ" value={S.wavelength} min={0.1} max={5} step={0.00001} suffix="Å" onChange={(value) => patchSettings("wavelength", value)} />
                    <div className="callout">{tr("La longueur d’onde est utilisée pour d, Q, Scherrer, la déformation et le calcul des phases CIF.")}</div>
                    <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={recalculateCifPhases}>Recalculer les phases CIF</Button></div>
                  </Section>

                  <Section title="Corrections instrumentales DRX" defaultOpen={false}>
                    <Toggle label="Suppression Kα₂ — Rachinger" checked={S.ka2Strip} onChange={(value) => patchSettings("ka2Strip", value)} />
                    {S.ka2Strip && <><NumberField label="λ Kα₂" value={S.ka2Wavelength} min={0.1} max={5} step={0.00001} suffix="Å" onChange={(value) => patchSettings("ka2Wavelength", value)} /><SliderField label="Rapport I(Kα₂)/I(Kα₁)" value={S.ka2Ratio} min={0.05} max={0.8} step={0.01} onChange={(value) => patchSettings("ka2Ratio", value)} /></>}
                    <SelectField label="Phase pour le zéro" value={S.zeroShiftReferencePhaseId || ""} onChange={(value) => patchSettings("zeroShiftReferencePhaseId", value)} options={[["", "Première phase visible"], ...phases.filter((phase) => phase.visible).map((phase) => [phase.id, phase.name])]} />
                    <div className="two-columns"><NumberField label="Tolérance" value={S.zeroShiftTolerance} min={0.02} max={2} step={0.02} suffix="°" onChange={(value) => patchSettings("zeroShiftTolerance", value)} /><NumberField label="I min phase" value={S.zeroShiftMinIntensity} min={0} max={100} step={1} suffix="%" onChange={(value) => patchSettings("zeroShiftMinIntensity", value)} /></div>
                    <div className="inline-actions"><Button variant="primary" onClick={applyZeroShift}>Corriger le zéro</Button><Button variant="secondary" icon="reset" onClick={removeZeroShift}>Retirer</Button></div>
                    <div className="callout">{tr("La correction utilise la médiane robuste des écarts entre pics expérimentaux et pics de la phase choisie. Elle requiert au moins deux correspondances.")}</div>
                  </Section>

                  <Section title="Ajustement de pic et microstructure" defaultOpen={false}>
                    <SelectField label="Profil" value={S.peakFitModel} onChange={(value) => patchSettings("peakFitModel", value)} options={[["gaussian", "Gaussien"], ["lorentzian", "Lorentzien"], ["pseudoVoigt", "Pseudo-Voigt"]]} />
                    <div className="two-columns"><NumberField label="Centre attendu" value={S.peakFitCenter} step={0.05} suffix="°" onChange={(value) => patchSettings("peakFitCenter", value)} /><NumberField label="Demi-fenêtre" value={S.peakFitWindow} min={0.05} step={0.05} suffix="°" onChange={(value) => patchSettings("peakFitWindow", value)} /></div>
                    <div className="two-columns"><NumberField label="FWHM instrumentale" value={S.instrumentFwhm} min={0} step={0.005} suffix="°" onChange={(value) => patchSettings("instrumentFwhm", value)} /><NumberField label="Constante de Scherrer K" value={S.scherrerK} min={0.5} max={1.5} step={0.01} onChange={(value) => patchSettings("scherrerK", value)} /></div>
                    <div className="inline-actions"><Button variant="primary" onClick={runPeakFit}>Ajuster le pic sélectionné</Button></div>
                    {peakFitResult && <div className="analysis-result"><strong>{activeProcessedPattern?.label}</strong><span>Centre : {peakFitResult.center.toFixed(4)}°</span><span>FWHM : {peakFitResult.fwhm.toFixed(4)}° · corrigée {peakFitResult.betaCorrectedDegrees.toFixed(4)}°</span><span>Aire : {peakFitResult.area.toExponential(4)} · R² : {peakFitResult.r2.toFixed(5)}</span><span>d : {peakFitResult.dSpacing.toFixed(4)} Å · Q : {peakFitResult.q.toFixed(4)} Å⁻¹</span><span>Taille apparente : {peakFitResult.crystalliteNm ? `${peakFitResult.crystalliteNm.toFixed(1)} nm` : "n.d."}</span><span>Microdéformation apparente : {peakFitResult.strain ? `${(peakFitResult.strain * 1e6).toFixed(0)} µε` : "n.d."}</span></div>}
                    <div className="callout">{tr("Scherrer et la microdéformation sur un seul pic sont des estimations apparentes. Une analyse Williamson–Hall multi-pics reste préférable.")}</div>
                  </Section>

                  <Section title="Suivi de pics à travers une série" defaultOpen={false}>
                    <TextAreaField label="Positions à suivre" value={S.trackingTargets} rows={4} onChange={(value) => patchSettings("trackingTargets", value)} placeholder="HAp 002:25.9; Calcite 104:29.4" hint="Nom:position ; Nom:position" />
                    <div className="two-columns"><NumberField label="Demi-fenêtre" value={S.trackingWindow} min={0.02} step={0.02} suffix="°" onChange={(value) => patchSettings("trackingWindow", value)} /><SelectField label="Signal" value={S.trackingSignal} onChange={(value) => patchSettings("trackingSignal", value)} options={[["corrected", "Corrigé du fond"], ["normalized", "Normalisé"], ["raw", "Brut"]]} /></div>
                    <div className="inline-actions"><Button variant="secondary" icon="phase" onClick={populateTrackingFromPhase}>Utiliser la phase sélectionnée</Button><Button variant="secondary" icon="csv" onClick={exportTrackingCsv}>Exporter positions, hauteurs et aires</Button></div>
                  </Section>
                </>}
              </>
            )}

            {rightTab === "compose" && composerTab === "references" && (
              <>
                {activeMode === "raman" && <Section title="Base Raman locale" defaultOpen={true}>
                  <Field label="Recherche nom / formule / éléments" targetId="raman-database-search">
                    <input type="text" value={ramanDatabaseQuery} placeholder="ex. hydroxyapatite, Ca, P, O" onChange={(event) => setRamanDatabaseQuery(event.target.value)} />
                  </Field>
                  <Field label="Éléments" hint="Filtre les résultats par composition chimique">
                    <div className="inline-actions">
                      {ramanDatabaseElements.slice(0, 18).map((element) => {
                        const active = ramanDatabaseSelectedElements.includes(element);
                        return <button key={element} type="button" className={active ? "chip is-on" : "chip"} onClick={() => setRamanDatabaseSelectedElements((current) => current.includes(element) ? current.filter((item) => item !== element) : [...current, element])}>{element}</button>;
                      })}
                    </div>
                  </Field>
                  {ramanDatabaseStatus === "loading" ? <div className="callout">Chargement de la base Raman…</div>
                    : ramanDatabaseStatus === "error" ? <div className="callout">La base Raman locale n’a pas pu être chargée. Rechargez la page pour réessayer.</div>
                      : ramanDatabaseMatches.length ? <div className="library-list">{ramanDatabaseMatches.map((entry) => <div key={`${entry.name}-${entry.formula || entry.metadata?.RRUFFID || entry.metadata?.NAMES || entry.metadata?.CIF_FORMULA || "entry"}`} className="library-row"><span><strong>{entry.name}</strong><small>{entry.formula || entry.metadata?.RRUFFID || entry.sourceKind || "base locale"}</small></span><Button variant="secondary" onClick={() => addLibraryPhase(entry, activeMode)}>Ajouter</Button></div>)}</div> : <div className="callout">{tr("Aucune correspondance trouvée. Essayez un nom, une formule, ou des symboles d’éléments.")}</div>}
                </Section>}
                <Section title="Annotations de phases">
                  <Toggle label="Afficher les annotations" checked={S.showAnnotations} onChange={setPhaseAnnotationsVisible} description="Si aucune phase visible n’est sélectionnée, leur activation est restaurée automatiquement." />
                  {S.showAnnotations && <>
                    {phases.length ? <Field label="Phases annotées" hint="Ce réglage est identique au bouton ANNOTATION de chaque carte de phase.">
                      <div className="phase-annotation-toggles">
                        {phases.map((phase) => <Toggle key={`annotation-toggle-${phase.id}`} label={phase.name} checked={Boolean(phase.inAnnot)} onChange={(value) => updatePhase(phase.id, "inAnnot", value)} description={phase.visible ? undefined : "Phase masquée : ses annotations restent invisibles."} />)}
                      </div>
                    </Field> : <div className="callout">{tr("Importer d’abord des phases de référence.")}</div>}
                    <SliderField label="Seuil des bâtonnets" value={S.tickMinI} min={0} max={50} step={0.5} suffix="%" onChange={(value) => patchSettings("tickMinI", value)} /><SliderField label="Seuil des labels" value={S.labelMinI} min={0} max={100} step={1} suffix="%" onChange={(value) => patchSettings("labelMinI", value)} /><SliderField label="Séparation des labels" value={S.labelMinSep} min={0.1} max={10} step={0.1} onChange={(value) => patchSettings("labelMinSep", value)} /><SliderField label="Hauteur" value={S.tickScale} min={0.1} max={1.5} step={0.02} onChange={(value) => patchSettings("tickScale", value)} /><SliderField label="Écart au patron" value={S.annotGap} min={0.3} max={3} step={0.02} onChange={(value) => patchSettings("annotGap", value)} /><SliderField label="Taille des labels" value={S.annotFontSize} min={5} max={18} step={0.5} onChange={(value) => patchSettings("annotFontSize", value)} /><Toggle label="Clé des abréviations" checked={S.showAbbrevKey} onChange={(value) => patchSettings("showAbbrevKey", value)} />
                  </>}
                </Section>
                <Section title="Références sur la figure" defaultOpen={phases.some((phase) => phase.inOverlay)} targetId="overlay-legend-options">
                  <div className="callout">{tr("Trace les bâtonnets des phases cochées ci-dessous directement dans la zone du graphe, superposés aux courbes (style EVA/HighScore), avec une légende intégrée déplaçable à la souris.")}</div>
                  {phases.length ? phases.map((phase) => (
                    <div key={`overlay-toggle-${phase.id}`}>
                      <Toggle label={phase.name} checked={Boolean(phase.inOverlay)} onChange={(value) => updatePhase(phase.id, "inOverlay", value)} />
                      {phase.inOverlay && <>
                        <Toggle label={`— Valeurs des pics (${S.mode === "drx" ? "2θ" : "cm⁻¹"})`} checked={Boolean(phase.overlayShowValues)} onChange={(value) => updatePhase(phase.id, "overlayShowValues", value)} />
                        {!S.phaseOverlayFullHeight && <SliderField label="— Hauteur propre à la phase" value={Number.isFinite(Number(phase.overlayScale)) && phase.overlayScale !== null && phase.overlayScale !== undefined ? Number(phase.overlayScale) : (S.phaseOverlayScale ?? 0.85)} min={0.05} max={3} step={0.05} onChange={(value) => updatePhase(phase.id, "overlayScale", value)} />}
                        {phase.overlayScale !== null && phase.overlayScale !== undefined && <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => updatePhase(phase.id, "overlayScale", null)}>Revenir à la hauteur globale</Button></div>}
                        {(phase.overlayPeakScales?.length || 0) > 0 && <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => updatePhase(phase.id, "overlayPeakScales", [])}>Réinitialiser les {phase.overlayPeakScales.length} hauteur(s) individuelle(s)</Button></div>}
                        {(phase.overlayValueExceptions?.length || 0) > 0 && <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => updatePhase(phase.id, "overlayValueExceptions", [])}>Réinitialiser les {phase.overlayValueExceptions.length} exception(s)</Button></div>}
                      </>}
                    </div>
                  )) : <div className="callout">{tr("Importer d’abord des phases de référence.")}</div>}
                  {phases.some((phase) => phase.inOverlay) && <div className="callout">{tr("Cliquer sur un bâtonnet (ou sur sa valeur) dans la figure pour afficher ou masquer sa valeur individuellement, quel que soit le réglage global de la phase.")}</div>}
                  {phases.some((phase) => phase.inOverlay) && <>
                    <Toggle label="Lignes pleine hauteur" checked={Boolean(S.phaseOverlayFullHeight)} onChange={(value) => patchSettings("phaseOverlayFullHeight", value)} />

                    <Toggle label="Tenir compte de l’intensité des fiches" checked={Boolean(S.phaseOverlayUseIntensity)} onChange={(value) => patchSettings("phaseOverlayUseIntensity", value)} description="Désactivé, tous les bâtonnets superposés partent de la même hauteur, ajustable individuellement. Les panneaux et les annotations conservent l’intensité dans tous les cas." />
                    <SliderField label="Épaisseur" value={S.phaseOverlayWidth ?? 1} min={0.3} max={4} step={0.05} onChange={(value) => patchSettings("phaseOverlayWidth", value)} />
                    <SliderField label="Opacité" value={S.phaseOverlayOpacity ?? 0.7} min={0.05} max={1} step={0.05} onChange={(value) => patchSettings("phaseOverlayOpacity", value)} />
                    <SliderField label="Taille des valeurs" value={S.phaseOverlayValueSize ?? 8.5} min={5} max={16} step={0.5} suffix="pt" onChange={(value) => patchSettings("phaseOverlayValueSize", value)} />
                    <Toggle label="Valeurs en gras" checked={Boolean(S.phaseOverlayValueBold)} onChange={(value) => patchSettings("phaseOverlayValueBold", value)} />
                    <SelectField label="Affichage des références" value={S.phaseOverlayDisplay || "both"} onChange={(value) => patchSettings("phaseOverlayDisplay", value)} options={[["both", "Bâtonnets et valeurs"], ["sticks", "Bâtonnets seuls"], ["values", "Valeurs seules"]]} />
                    <SelectField label="Position des valeurs" value={S.phaseOverlayValueAnchor === "peak" ? "peak" : "stick"} onChange={(value) => patchSettings("phaseOverlayValueAnchor", value)} options={[["stick", "À l'extrémité du bâtonnet"], ["peak", "Au-dessus du pic mesuré"]]} />
                    {S.phaseOverlayValueAnchor === "peak" && <NumberField label={`${tr("Fenêtre de recherche du sommet")} (${activeMode === "drx" ? "°" : "cm⁻¹"})`} value={S.phaseOverlayValueWindow ?? 0} min={0} step={activeMode === "drx" ? 0.05 : 1} onChange={(value) => patchSettings("phaseOverlayValueWindow", value)} hint={`0 = automatique (${activeMode === "drx" ? "0,2°" : "8 cm⁻¹"}).`} />}
                    <Toggle label="Poignées de hauteur sur la figure" checked={S.showOverlayHandles !== false} onChange={(value) => patchSettings("showOverlayHandles", value)} description="Une poignée au sommet de chaque bâtonnet : la glisser ne règle que ce bâtonnet, double-clic pour revenir à la hauteur commune de la phase. Les poignées ne sont pas exportées." />
                    <Toggle label="Légende dans la figure" checked={S.showOverlayLegend !== false} onChange={(value) => patchSettings("showOverlayLegend", value)} />
                    {S.showOverlayLegend !== false && <>
                      <SliderField label="Taille du texte de légende" value={S.overlayLegendFontSize ?? 10} min={6} max={20} step={0.5} suffix="pt" onChange={(value) => patchSettings("overlayLegendFontSize", value)} />
                      <Toggle label="Texte de légende en gras" checked={Boolean(S.overlayLegendFontBold)} onChange={(value) => patchSettings("overlayLegendFontBold", value)} />
                      <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => patchSettingsValues({ overlayLegendX: null, overlayLegendY: null })}>Réinitialiser la position de la légende</Button></div>
                    </>}
                  </>}
                </Section>
                <Section title="Panneau de références" targetId="reference-panel-options">
                  <Toggle label="Afficher le panneau" checked={S.showPdfPanel} onChange={setReferencePanelVisible} description="Si aucune phase visible n’est sélectionnée, leur ajout au panneau est restauré automatiquement." />
                  {S.showPdfPanel && <>
                    {phases.length ? <Field label="Phases dans le panneau" hint="Ce réglage est identique au bouton PANNEAU de chaque carte de phase.">
                      <div className="phase-annotation-toggles">
                        {phases.map((phase) => <Toggle key={`panel-toggle-${phase.id}`} label={phase.name} checked={Boolean(phase.inPanel)} onChange={(value) => updatePhase(phase.id, "inPanel", value)} description={phase.visible ? undefined : "Phase masquée : elle reste absente du panneau."} />)}
                      </div>
                    </Field> : <div className="callout">{tr("Importer d’abord des phases de référence.")}</div>}
                    <SliderField label="Hauteur" value={S.pdfPanelH} min={60} max={500} step={10} suffix="px" onChange={(value) => patchSettings("pdfPanelH", value)} />
                    <SliderField label="Épaisseur des bâtonnets" value={S.pdfStickW} min={0.3} max={4} step={0.05} onChange={(value) => patchSettings("pdfStickW", value)} />
                    <Toggle label="Noms des lignes" checked={S.showRowLabels} onChange={(value) => patchSettings("showRowLabels", value)} />
                    <Toggle label="Sous-titres des lignes" checked={S.showRowSubtitles} onChange={(value) => patchSettings("showRowSubtitles", value)} />
                    {S.showRowSubtitles && <NumberField label="Longueur maximale" value={S.phaseSubtitleMaxLength} min={0} max={120} step={1} suffix="car." onChange={(value) => patchSettings("phaseSubtitleMaxLength", Math.round(value))} />}
                    <Toggle label="Encart de légende" checked={S.showPdfLegend} onChange={(value) => patchSettings("showPdfLegend", value)} />
                    {S.showPdfLegend && <>
                      <SliderField label="Largeur de la légende" value={S.phaseLegendWidth || 210} min={140} max={500} step={5} suffix="px" onChange={(value) => patchSettings("phaseLegendWidth", value)} />
                      <SliderField label="Taille du texte" value={S.phaseLegendFontSize || 8} min={6} max={16} step={0.5} suffix="pt" onChange={(value) => patchSettings("phaseLegendFontSize", value)} />
                      <Toggle label="Texte de légende en gras" checked={Boolean(S.phaseLegendFontBold)} onChange={(value) => patchSettings("phaseLegendFontBold", value)} />
                      <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({ ...currentWorkspace, settings: { ...currentWorkspace.settings, phaseLegendX: null, phaseLegendY: null, phaseLegendWidth: 210, phaseLegendFontSize: 8 } })))}>Réinitialiser la légende</Button></div>
                      <div className="callout">{tr("Glisser l’en-tête de l’encart dans la figure pour le déplacer ; utiliser le carré inférieur droit pour le redimensionner.")}</div>
                    </>}
                  </>}
                </Section>
                {activeMode === "drx" && <Section title="Bibliothèque de phases DRX" defaultOpen={false}>
                  <div className="inline-actions"><Button variant="secondary" icon="save" onClick={saveSelectedPhasesToLibrary}>Enregistrer sélection / visibles</Button><Button variant="secondary" icon="reset" onClick={recalculateCifPhases}>Recalculer CIF</Button></div>
                  {phaseLibrary.length ? <div className="library-list">{phaseLibrary.map((entry) => <div key={entry.libraryKey || entry.name} className="library-row"><span><strong>{entry.name}</strong><small>{entry.metadata?.CIF_FORMULA || entry.metadata?.RRUFFID || entry.sourceKind}</small></span><Button variant="secondary" onClick={() => addLibraryPhase(entry)}>Ajouter</Button><IconButton icon="trash" danger title="Retirer de la bibliothèque" onClick={() => setPhaseLibrary((current) => current.filter((item) => item !== entry))} /></div>)}</div> : <div className="callout">{tr("La bibliothèque est locale au navigateur. Importer une fiche ou un CIF, sélectionner la phase puis l’enregistrer ici.")}</div>}
                </Section>}
              </>
            )}

            {rightTab === "inspector" && renderPatternProperties()}

            {rightTab === "export" && (
              <>
                <Section title="Format de publication">
                  <SliderField label="Échelle PNG" value={S.pngScale} min={1} max={6} step={1} suffix="×" onChange={(value) => patchSettings("pngScale", value)} />
                  <SliderField label="Résolution PDF / TIFF" value={S.exportDpi} min={72} max={600} step={12} suffix="dpi" onChange={(value) => patchSettings("exportDpi", Math.round(value))} />
                  <Field label="Fond de la figure"><div className="color-field"><input type="color" value={S.pageBackground} onChange={(event) => patchSettings("pageBackground", event.target.value)} /><code>{S.pageBackground}</code></div></Field>
                  <Toggle label="Fond transparent à l’export" checked={S.transparentExport} onChange={(value) => patchSettings("transparentExport", value)} description="Le PDF utilise toujours un fond opaque ; le TIFF conserve le canal alpha." />
                  <TextField label="Nom du fichier" value={S.fileName} onChange={(value) => patchSettings("fileName", value.replace(/[\\/:*?"<>|]/g, "_"))} />
                  <div className="export-summary"><span>PNG : {Math.round(W * S.pngScale)} × {Math.round(H * S.pngScale)} px</span><span>PDF / TIFF : {S.exportDpi} dpi</span><span>SVG : vectoriel éditable</span></div>
                </Section>
                <Section title="Prévisualiser et exporter">
                  <div className="inline-actions"><Button variant="primary" icon="preview" disabled={isExporting} onClick={() => openExportPreview("png")}>Ouvrir la prévisualisation</Button><Button variant="secondary" icon="duplicate" disabled={isExporting} onClick={copyPngToClipboard}>Copier PNG</Button></div>
                  <div className="callout">La prévisualisation utilise le même SVG normalisé que les fichiers PNG, TIFF, SVG et PDF. Le zoom de l’éditeur n’affecte pas le résultat.</div>
                </Section>
                <Section title="Données et projet" defaultOpen={false}>
                  <div className="export-grid"><Button variant="secondary" icon="csv" onClick={exportProcessedCsv}>CSV traité</Button><Button variant="secondary" icon="csv" onClick={exportDetectedPeaksCsv}>CSV pics</Button>{supportsZones && <Button variant="secondary" icon="csv" onClick={exportZonesCsv}>CSV zones</Button>}<Button variant="secondary" icon="save" onClick={saveSessionFile}>Session JSON</Button></div>
                </Section>
              </>
            )}
          </div>
        </aside>
      </main>

      <input ref={patternInputRef} type="file" accept=".xy,.txt,.csv,.dat,.xml,.xrdml,.0,.1,.2,.3,.opus" multiple hidden onChange={(event) => { importPatterns([...event.target.files]); event.target.value = ""; }} />
      <input ref={phaseInputRef} type="file" accept=".dif,.cif,.txt,.csv,.dat" multiple hidden onChange={(event) => { importPhases([...event.target.files]); event.target.value = ""; }} />
      <input ref={sessionInputRef} type="file" accept=".json" hidden onChange={(event) => { loadSessionFile([...event.target.files]); event.target.value = ""; }} />
      <input ref={appendPhaseInputRef} type="file" accept=".dif,.txt,.csv,.dat" hidden onChange={(event) => { appendPhaseFile([...event.target.files]); event.target.value = ""; }} />

      {message && <div className="toast"><span className="toast__icon"><Icon name="check" size={13} /></span><span>{translateMessage(message, language)}</span><button type="button" onClick={() => setMessage("")}><Icon name="close" size={14} /></button></div>}
      {isExporting && <div className="export-overlay"><div className="export-orbit"><Icon name="download" size={20} /></div><strong>{tr("Génération de la figure")}</strong><span>{tr("Préparation du fichier haute résolution…")}</span></div>}
      {exportPreview.open && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeExportPreview(); }}>
        <section className="export-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="export-preview-title">
          <header className="export-preview-dialog__header"><div><strong id="export-preview-title">Prévisualisation de l’export</strong><span>Rendu normalisé · indépendant du zoom de l’éditeur</span></div><IconButton icon="close" title="Fermer" onClick={closeExportPreview} /></header>
          <div className="export-preview-dialog__body">
            <div className="export-preview-stage" style={{ background: S.transparentExport ? "repeating-conic-gradient(#e9edf2 0 25%, #ffffff 0 50%) 50% / 18px 18px" : S.pageBackground }}>
              <img src={svgDataUrl(exportPreview.serialized)} alt="Prévisualisation exacte de la figure exportée" />
            </div>
            <aside className="export-preview-controls">
              <label><span>Format</span><select value={exportPreview.format} onChange={(event) => setExportPreview((current) => ({ ...current, format: event.target.value }))}><option value="png">PNG</option><option value="tiff">TIFF</option><option value="svg">SVG</option><option value="pdf">PDF</option></select></label>
              <div className="export-summary"><span>Figure : {Math.round(W)} × {Math.round(H)} unités</span>{exportPreview.format === "png" && <span>PNG : {Math.round(W * S.pngScale)} × {Math.round(H * S.pngScale)} px</span>}{["tiff", "pdf"].includes(exportPreview.format) && <span>Résolution demandée : {S.exportDpi} dpi</span>}<span>Fond : {S.transparentExport && exportPreview.format !== "pdf" ? "transparent" : S.pageBackground}</span><span>Épaisseur des courbes : {S.lineWidth}</span></div>
              <div className="export-preview-actions"><Button variant="secondary" onClick={closeExportPreview}>Annuler</Button><Button variant="primary" icon="download" disabled={isExporting} onClick={downloadPreviewedFigure}>Exporter {exportPreview.format.toUpperCase()}</Button></div>
            </aside>
          </div>
        </section>
      </div>}
      {addNoteMode && <div className="mode-banner"><Icon name="note" /><span>Cliquer dans la zone principale de la figure pour placer la note.</span><button type="button" onClick={() => setAddNoteMode(false)}>Annuler</button></div>}
    </div>
  );
}
