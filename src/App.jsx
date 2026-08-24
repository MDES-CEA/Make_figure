Warning: truncated output (original token count: 101103)
Total output lines: 5619

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
  zoneBoundaryEdges,
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

const REPORT_ISSUE_URL = "https://github.com/MDES-CEA/Make_figure/issues/new?template=bug_report.yml";

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
    bug: <><path d="M9 9h6v8a3 3 0 0 1-6 0z"/><path d="M10 9V7a2 2 0 0 1 4 0v2M6 13h3M15 13h3M6 17h3M15 17h3M8 7 6 5M16 7l2-2"/></>,
  };
  return <svg {...common}>{paths[name] || paths.more}</svg>;
}

function Logo() {
  return (
    <div className="app-logo" aria-hidden="true">
      <svg width="36" height="32" viewBox="0 0 36 32">
        <circle className="app-logo__orbit" cx="18" cy="16" r="13" fill="none" stroke="#667486" strokeWidth=".8" strokeDasharray="3 5" />
        {[0, 1, 2].map((index) => (
          <path
            className={`app-logo__trace app-logo__trace--${index + 1}`}
            key={index}
            d={`M3 ${25 - index * 7} L10 ${25 - index * 7} L13 ${12 - index * 7 + 4} L16 ${25 - index * 7} L23 ${25 - index * 7} L26 ${18 - index * 7 + 2} L29 ${25 - index * 7} L33 ${25 - index * 7}`}
            fill="none"
            stroke="#d28a55"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
}

const WORKSPACE_ASSET_COLORS = {
  drx: "#d28a55",
  raman: "#5f9fb1",
  ir: "#c77868",
};

const APP_NAME = "Diffraction & Spectra Studio";

function WorkspaceIllustration({ mode = "drx", compact = false }) {
  const resolvedMode = resolveMode(mode);
  const signalColor = WORKSPACE_ASSET_COLORS[resolvedMode];
  return (
    <svg className={`workspace-asset ${compact ? "is-compact" : ""}`} viewBox="0 0 320 170" aria-hidden="true">
      <path className="workspace-asset__grid" d="M35 132H286M35 100H286M35 68H286M76 35V143M126 35V143M176 35V143M226 35V143M276 35V143" />
      <path className="workspace-asset__axis" d="M35 30V143H291" />
      {resolvedMode === "raman" && (
        <>
          <path pathLength="1" className="workspace-asset__signal workspace-asset__signal--back" d="M38 126C54 124 61 116 72 119c13 4 20 8 31-10 13-22 24-5 35-7 13-2 15-29 28-29 15 0 15 46 32 42 12-2 15-17 28-17 13 0 17 23 31 19 11-3 13-14 29-12" />
          <path pathLength="1" className="workspace-asset__signal" stroke={signalColor} d="M38 131C57 128 62 122 75 124c15 2 20 0 29-15 12-20 23-3 35-6 14-3 14-45 30-45 16 0 14 56 33 51 14-3 15-25 30-23 14 2 16 31 32 22 8-5 13-11 23-8" />
        </>
      )}
      {resolvedMode === "drx" && (
        <>
          {[58, 84, 112, 144, 169, 213, 251, 276].map((x, index) => (
            <line key={x} pathLength="1" className="workspace-asset__stick" x1={x} x2={x} y1="132" y2={132 - [22, 46, 29, 79, 36, 62, 27, 45][index]} stroke={signalColor} />
          ))}
          <path pathLength="1" className="workspace-asset__signal" stroke={signalColor} d="M38 130 52 129 58 108 63 129 79 128 84 87 90 129 107 128 112 103 117 129 139 128 144 52 150 129 164 128 169 96 175 129 207 128 213 68 220 129 246 128 251 104 257 129 271 128 276 88 282 130" />
        </>
      )}
      {resolvedMode === "ir" && (
        // Allure d’un spectre en transmittance : ligne de base haute, bandes vers le bas.
        <>
          <path pathLength="1" className="workspace-asset__signal workspace-asset__signal--back" d="M38 52c22 1 30 3 44 5 12 2 16 34 27 34 12 0 14-30 25-29 15 1 12 12 24 13 14 1 18 46 31 46 12 0 13-44 26-45 15-1 16 22 30 23 13 1 19 12 36 11" />
          <path pathLength="1" className="workspace-asset__signal" stroke={signalColor} d="M38 48c22 1 31 2 45 4 12 2 15 41 27 41 13 0 14-35 26-34 15 1 12 14 25 15 14 1 17 54 31 54 13 0 13-51 27-52 15-1 16 26 30 27 13 1 20 13 37 12" />
        </>
      )}
      <g className="workspace-asset__labels">
        {/* En IR le haut du cadre est occupé par la ligne de base : badge en bas à gauche. */}
        <rect x="43" y={resolvedMode === "ir" ? 112 : 40} width="62" height="18" rx="9" />
        <text x="74" y={resolvedMode === "ir" ? 124 : 52} textAnchor="middle">{tr(modeLabel(resolvedMode)).toUpperCase()}</text>
        <rect x="218" y="141" width="65" height="14" rx="7" />
      </g>
    </svg>
  );
}

function MiniAsset({ kind = "pattern" }) {
  const icon = kind === "phase" ? "phase" : kind === "zone" ? "zone" : kind === "note" ? "note" : kind === "selection" ? "cursor" : "waveform";
  return <span className={`mini-asset mini-asset--${kind}`}><Icon name={icon} size={20} /></span>;
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
        <input type="range" value={value} min={min} max={max} step={step} aria-label={`${tr(label)} — ${tr("curseur")}`} onChange={commitRange} />
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
    <button type="button" className="toggle-row" aria-pressed={checked} onClick={() => onChange(!checked)}>
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
          aria-label={`${tr("Nom de la courbe")} ${index + 1}`}
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
          {pattern.isAverage ? <span className="derived-badge"><Icon name="average" size={10} /> {tr("patron moyen")}</span> : <span className="type-badge"><Icon name="waveform" size={10} /> {tr("acquisition")}</span>}
          {pattern.locked && <span className="type-badge type-badge--locked"><Icon name="lock" size={10} /> {tr("verrouillé")}</span>}
          {pattern.processingOverrides?.enabled && <span className="type-badge"><Icon name="waveform" size={10} /> {tr("traitement individuel")}</span>}
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
        title={tr("Couleur de la phase")}
        aria-label={`${tr("Couleur de la phase")} — ${phase.name}`}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onUpdate("color", event.target.value)}
      />
      <div className="data-item__content">
        <input
          className="data-item__name"
          aria-label={tr("Nom de la référence")}
          value={phase.name}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate("name", event.target.value)}
        />
        <span className="data-item__meta">{phase.peaks.length} {tr("pics")} · {truncateLabel(phaseSubtitle(phase), 44)}</span>
        <div className="data-item__chips">
          <span className="type-badge"><Icon name="phase" size={10} /> {phase.sourceKind === "manual" ? tr("manuel") : phase.sourceKind === "raman-spectrum" ? "RRUFF" : tr("référence")}</span>
          <button type="button" className={annotationActive ? "chip is-on" : "chip"} title={!annotationsVisible && phase.inAnnot ? tr("L’affichage global est désactivé. Cliquer pour le réactiver.") : undefined} onClick={(event) => { event.stopPropagation(); onUpdate("inAnnot", !annotationActive); }}>{tr("annotation")}</button>
          <button type="button" className={panelActive ? "chip is-on" : "chip"} title={!panelVisible && phase.inPanel ? tr("L’affichage global du panneau est désactivé. Cliquer pour le réactiver.") : undefined} onClick={(event) => { event.stopPropagation(); onUpdate("inPanel", !panelActive); }}>{tr("panneau")}</button>
          <button type="button" className={phase.inOverlay ? "chip is-on" : "chip"} title={tr("Superposer les bâtonnets directement sur la figure")} onClick={(event) => { event.stopPropagation(); onUpdate("inOverlay", !phase.inOverlay); }}>{tr("figure")}</button>
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
        <input className="data-item__name" aria-label={tr("Texte de la note")} value={safe.text} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdate("text", event.target.value)} />
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
      <input type="color" value={zone.color} className="color-dot" title={tr("Couleur de la zone")} aria-label={`${tr("Couleur de la zone")} — ${zone.name}`} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdate("color", event.target.value)} />
      <div className="data-item__content">
        <input className="data-item__name" aria-label={tr("Nom de la zone")} value={zone.name} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdate("name", event.target.value)} />
        <span className="data-item__meta">{Number(zone.xmin).toLocaleString(uiLocale())}–{Number(zone.xmax).toLocaleString(uiLocale())} cm⁻¹</span>
      </div>
      <div className="data-item__actions">
        <IconButton icon={zone.visible ? "eye" : "eyeOff"} title={zone.visible ? "Masquer" : "Afficher"} onClick={(event) => { event?.stopPropagation?.(); onUpdate("visible", !zone.visible); }} />
        <IconButton icon="trash" title="Supprimer" danger onClick={(event) => { event?.stopPropagation?.(); onDelete(); }} />
      </div>
    </article>
  );
}

function Resizer({ side, onResize, onReset, min = 250, max = 560 }) {
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
  return <div className={`panel-resizer panel-resizer--${side}`} role="separator" aria-label={tr(side === "left" ? "Redimensionner le panneau de données" : "Redimensionner le panneau d’outils")} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(onResize.currentWidth())} tabIndex="0" onKeyDown={keyboardResize} onDoubleClick={onReset} onPointerDown={start} />;
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
            <div><span>{tr("Bibliothèque locale")}</span><strong>{entries.length} {tr("projet(s)")}</strong></div>
            <IconButton icon="close" title="Fermer" onClick={onToggle} />
          </div>
          <div className="project-menu__search"><Icon name="folder" size={13} /><input value={search} aria-label={tr("Rechercher un projet…")} onChange={(event) => setSearch(event.target.value)} placeholder={tr("Rechercher un projet…")} /></div>
          <div className="project-menu__list">
            {filtered.map((entry) => (
              <button type="button" key={entry.id} className={`project-row ${entry.id === project.id ? 'is-active' : ''}`} onClick={() => onSwitch(entry.id)}>
                <span className="project-row__mark">{entry.id === project.id ? <Icon name="check" size={12} /> : null}</span>
                <span className="project-row__copy"><strong>{entry.name}</strong><small>{entry.drxCount} {tr("DRX")} · {entry.ramanCount} Raman · {entry.irCount || 0} IR · {new Date(entry.updatedAt).toLocaleDateString(uiLocale())}</small></span>
              </button>
            ))}
            {!filtered.length && <div className="project-menu__empty">{tr("Aucun projet correspondant.")}</div>}
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
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" role="img" aria-label={tr("Navigateur de plage X")}>
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
    panels = [{ title: `${selectedA.label} · ${tr("brut")}`, series: [{ ...raw, values: raw.displayY }] }, { title: `${selectedA.label} · ${tr("traité")}`, series: [{ ...selectedA, values: selectedA.displayY }] }];
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
      { title: `${selectedA.label} − ${selectedB.label}`, zero: true, series: [{ id: "difference", sourceX: xValues, values: difference, label: tr("Différence"), syntheticColor: colors.get(selectedA.id) || "#333" }] },
      { title: `${selectedA.label} / ${selectedB.label}`, zero: false, series: [{ id: "ratio", sourceX: xValues, values: ratio, label: tr("Rapport"), syntheticColor: colors.get(selectedB.id) || "#555" }] },
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
        <text x={(inner.left + inner.right) / 2} y={py + panelHeight - 7} textAnchor="middle" fontSize={settings.panelAxisFontSize || 9} fontWeight={settings.panelAxisFontBold ? "700" : "400"} fill="#343a40" style={{ cursor: "pointer" }} onClick={(event) => onTextSelect?.(event, { kind: "settings", label: "Axes des panneaux", sizeKey: "panelAxisFontSize", boldKey: "panelAxisFontBold" })}>{settings.mode === "drx" ? "2θ (°)" : tr(settings.mode === "ir" ? "Nombre d’onde (cm⁻¹)" : "Décalage Raman (cm⁻¹)")}</text>
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
  const [rightWidth, setRightWidth] = useState(390);
  const [leftCollapsed, setLeftCollapsed] = useState(() => readLocalSetting("make-figure-left-collapsed", "false") === "true");
  const [rightCollapsed, setRightCollapsed] = useState(true);
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
  const [zoneDraft, setZoneDraft] = useState({ name: "", xmin: 500, xmax: 700, color: "#5f9fb1", opacity: 0.12 });
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
  useEffect(() => {
    writeLocalSetting("make-figure-language", language);
    document.documentElement.lang = language;
  }, [language]);
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
      const stockNames = [["Premier projet", "First project"], ["Projet sans titre", "Untitled project"], ["Projet", "Project"]];
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
    setMessage(`${tr(type === "pattern" ? "Patron" : "Phase")} déplacé vers l’espace ${tr(modeLabel(destination))}.`);
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
      const summary = importedModes.map((mode) => `${additionsByMode[mode].length} ${tr("vers")} ${tr(modeLabel(mode))}`).join(" · ");
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
        c…51103 tokens truncated…
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
                          <text x={M.left + plotWidth + 38} y={M.top + mainHeight / 2} textAnchor="middle" fontSize={Math.max(7, S.axisFontSize - 2)} fontWeight={S.axisFontBold ? "700" : "400"} fill="#15191f" transform={`rotate(90 ${M.left + plotWidth + 38} ${M.top + mainHeight / 2})`} onClick={(event) => activateTextTarget(event, { kind: "settings", label: "Titres des axes", sizeKey: "axisFontSize", boldKey: "axisFontBold" })}>{tr("Intensité relative (%)")}</text>
                        </g>}
                        {breakActive && <g>
                          <path d={`M${xToPx(Number(S.brokenAxisStart)) + 2} ${axisY - 4}l5 8M${xToPx(Number(S.brokenAxisStart)) + 8} ${axisY - 4}l5 8`} stroke="#15191f" strokeWidth="1" fill="none" />
                          <path d={`M${xToPx(Number(S.brokenAxisStart)) + 2} ${M.top - 4}l5 8M${xToPx(Number(S.brokenAxisStart)) + 8} ${M.top - 4}l5 8`} stroke="#15191f" strokeWidth="1" fill="none" />
                        </g>}
                      </g>;
                    })()}
                    {dragPreview?.type === "overlayValueMove" && dragPreview.snapped && <circle data-ui-only="true" cx={dragPreview.stickX} cy={dragPreview.stickY + dragPreview.dy} r="7" fill="none" stroke="#e0507a" strokeWidth="1.2" strokeDasharray="3 2" pointerEvents="none" />}
                    {dragPreview?.type === "zoomRect" && <rect data-ui-only="true" x={Math.min(dragPreview.x1, dragPreview.x2)} y={M.top} width={Math.abs(dragPreview.x2 - dragPreview.x1)} height={mainHeight} fill="#dc7848" opacity="0.12" stroke="#dc7848" strokeWidth="1" strokeDasharray="4 3" pointerEvents="none" />}
                    {dragPreview?.type === "curveOrder" && <line data-ui-only="true" x1={M.left} x2={M.left + plotWidth + M.right - 8} y1={dragPreview.svgY} y2={dragPreview.svgY} stroke="#dc7848" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.8" />}
                    {cursor && <g data-ui-only="true" pointerEvents="none"><line x1={cursor.svgX} x2={cursor.svgX} y1={M.top} y2={M.top + mainHeight} stroke={cursor.snapped ? "#dc7848" : "#67707c"} strokeWidth="0.7" strokeDasharray="3 3" opacity="0.75"/></g>}
                    {Array.isArray(dragPreview?.guides) && dragPreview.guides.map((guide, index) => guide.axis === "x"
                      ? <line data-ui-only="true" key={`guide-${index}`} x1={guide.px} x2={guide.px} y1={M.top} y2={M.top + mainHeight} stroke="#e0507a" strokeWidth="1" strokeDasharray="5 3" opacity="0.85" pointerEvents="none" />
                      : <line data-ui-only="true" key={`guide-${index}`} x1={M.left} x2={M.left + plotWidth + M.right - 8} y1={guide.px} y2={guide.px} stroke="#e0507a" strokeWidth="1" strokeDasharray="5 3" opacity="0.85" pointerEvents="none" />)}
                  </svg>
                </div>
              </div>
            )}
          </div>

          <footer className="statusbar">
            <span title={project.name}><strong>{truncateLabel(project.name, 24)}</strong></span><span><strong>{tr(modeLabel(activeMode))}</strong></span><span><strong>{patterns.length}</strong> {tr("patrons")}</span>
            <span><strong>{phases.length}</strong> {tr("phases")}</span>
            <span><strong>{visibleCount}</strong> {tr("visibles")}</span>
            {selectionCount > 0 && <span className="statusbar__selection"><strong>{selectionCount}</strong> {tr("sélectionné(s)")}</span>}
            <span><strong>{processed.reduce((sum, pattern) => sum + (pattern.detectedPeaks?.length || 0), 0)}</strong> {tr("pics détectés")}</span>
            <span>{tr(LAYOUT_OPTIONS.find(([value]) => value === S.layoutMode)?.[1])}</span>
            <span className="statusbar__spacer" />
            {cursor ? <><span>x = <strong>{cursor.dataX.toFixed(S.mode === "drx" ? 3 : 1)}</strong></span>{cursor.nearest && <span>{activePattern?.label}: <strong>{cursor.nearest.y.toFixed(4)}</strong></span>}</> : <span>{tr("Déplacer le curseur sur la figure pour lire les coordonnées.")}</span>}
          </footer>
        </section>

        <aside className={`side-panel side-panel--right workspace-tool-drawer ${rightCollapsed ? "is-collapsed" : ""}`} aria-hidden={rightCollapsed} style={{ width: rightWidth }}>
          <div className="panel-titlebar"><div><strong>{tr(workspaceToolTitle)}</strong><span>{selectionCount ? `${selectionCount} ${tr("sélectionné(s)")}` : `${tr(modeLabel(activeMode))} · ${patterns.length + phases.length + notes.length + zones.length} ${tr("éléments")}`}</span></div><IconButton icon="close" title={tr("Fermer les outils")} onClick={() => setRightCollapsed(true)} /></div>
          <div className="side-panel__content properties-scroll">
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
                  <div className="callout">{tr("Cliquer sur un texte de la figure affiche aussi les contrôles de taille et de gras directement sur la feuille.")}</div>
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
                    {!breakActive && <div className="callout">{tr("La coupure n’est pas appliquée : les bornes doivent être strictement comprises dans la fenêtre affichée")}{activeMode === "drx" ? tr(" et l’axe principal doit être 2θ") : ""}.</div>}
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
                  {activePattern && ((activePattern.userPeaks?.length || 0) + (activePattern.excludedPeaks?.length || 0) > 0) && <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => resetPeakEdits(activePattern.id)}>{tr("Réinitialiser ajouts/retraits")} ({(activePattern.userPeaks?.length || 0)} + / {(activePattern.excludedPeaks?.length || 0)} −)</Button></div>}
                  <SliderField label="Hauteur minimale" value={S.peakMinHeight} min={0} max={100} step={1} suffix="%" onChange={(value) => patchSettings("peakMinHeight", value)} />
                  <SliderField label="Proéminence minimale" value={S.peakMinProminence} min={0} max={100} step={0.5} suffix="%" onChange={(value) => patchSettings("peakMinProminence", value)} />
                  <NumberField label="Distance minimale X" value={S.peakMinDistance} min={0} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => patchSettings("peakMinDistance", value)} />
                  <SliderField label="Fenêtre de proéminence" value={S.peakLookaround} min={2} max={250} step={1} suffix="pts" onChange={(value) => patchSettings("peakLookaround", Math.round(value))} />
                  <SliderField label="Nombre maximal de labels" value={S.peakMaxLabels} min={0} max={100} step={1} onChange={(value) => patchSettings("peakMaxLabels", Math.round(value))} />
                  {activeProcessedPattern ? <div className="peak-results">
                    <div className="peak-results__header"><strong>{truncateLabel(activeProcessedPattern.label, 28)}</strong><span>{activeProcessedPattern.detectedPeaks?.length || 0} {tr("maximum(s)")}</span></div>
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
                  {alignmentPreview && <div className="alignment-preview"><div className="alignment-preview__header"><strong>{tr("Référence :")} {truncateLabel(alignmentPreview.referenceLabel, 24)}</strong><span>{alignmentPreview.xmin}–{alignmentPreview.xmax}</span></div>{alignmentPreview.results.map((result) => <div className="alignment-preview__row" key={result.id}><span>{truncateLabel(result.label, 24)}{result.reference ? ` · ${tr("référence")}` : result.locked ? ` · ${tr("verrouillé")}` : ""}</span><strong>{result.shift >= 0 ? "+" : ""}{result.shift.toFixed(activeMode === "drx" ? 4 : 1)}</strong><small>{Number.isFinite(result.score) ? `r = ${result.score.toFixed(4)}` : tr("corrélation indisponible")}</small></div>)}</div>}
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
                    <div className="inline-actions"><Button variant="primary" onClick={runPeakFit}>Ajuster le pic sélectionné</Button>{peakFitResult && <Button variant="secondary" icon="close" onClick={removePeakFit}>Retirer l’ajustement</Button>}</div>
                    {peakFitResult && <div className="analysis-result"><strong>{processed.find((pattern) => pattern.id === peakFitResult.patternId)?.label || tr("Courbe indisponible")}</strong><span>{tr("Centre :")} {peakFitResult.center.toFixed(4)}°</span><span>FWHM : {peakFitResult.fwhm.toFixed(4)}° · {tr("corrigée")} {peakFitResult.betaCorrectedDegrees.toFixed(4)}°</span><span>{tr("Aire :")} {peakFitResult.area.toExponential(4)} · R² : {peakFitResult.r2.toFixed(5)}</span><span>d : {peakFitResult.dSpacing.toFixed(4)} Å · Q : {peakFitResult.q.toFixed(4)} Å⁻¹</span><span>{tr("Taille apparente :")} {peakFitResult.crystalliteNm ? `${peakFitResult.crystalliteNm.toFixed(1)} nm` : tr("n.d.")}</span><span>{tr("Microdéformation apparente :")} {peakFitResult.strain ? `${(peakFitResult.strain * 1e6).toFixed(0)} µε` : tr("n.d.")}</span></div>}
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
                    <input type="text" value={ramanDatabaseQuery} aria-label={tr("Rechercher dans la base Raman")} placeholder={tr("ex. hydroxyapatite, Ca, P, O")} onChange={(event) => setRamanDatabaseQuery(event.target.value)} />
                  </Field>
                  <Field label="Éléments" hint="Filtre les résultats par composition chimique">
                    <div className="inline-actions">
                      {ramanDatabaseElements.slice(0, 18).map((element) => {
                        const active = ramanDatabaseSelectedElements.includes(element);
                        return <button key={element} type="button" className={active ? "chip is-on" : "chip"} onClick={() => setRamanDatabaseSelectedElements((current) => current.includes(element) ? current.filter((item) => item !== element) : [...current, element])}>{element}</button>;
                      })}
                    </div>
                  </Field>
                  {ramanDatabaseStatus === "loading" ? <div className="callout">{tr("Chargement de la base Raman…")}</div>
                    : ramanDatabaseStatus === "error" ? <div className="callout">{tr("La base Raman locale n’a pas pu être chargée. Rechargez la page pour réessayer.")}</div>
                      : ramanDatabaseMatches.length ? <div className="library-list">{ramanDatabaseMatches.map((entry) => <div key={`${entry.name}-${entry.formula || entry.metadata?.RRUFFID || entry.metadata?.NAMES || entry.metadata?.CIF_FORMULA || "entry"}`} className="library-row"><span><strong>{entry.name}</strong><small>{entry.formula || entry.metadata?.RRUFFID || entry.sourceKind || tr("base locale")}</small></span><Button variant="secondary" onClick={() => addLibraryPhase(entry, activeMode)}>Ajouter</Button></div>)}</div> : <div className="callout">{tr("Aucune correspondance trouvée. Essayez un nom, une formule, ou des symboles d’éléments.")}</div>}
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
                        {(phase.overlayPeakScales?.length || 0) > 0 && <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => updatePhase(phase.id, "overlayPeakScales", [])}>{tr("Réinitialiser les")} {phase.overlayPeakScales.length} {tr("hauteur(s) individuelle(s)")}</Button></div>}
                        {(phase.overlayValueExceptions?.length || 0) > 0 && <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => updatePhase(phase.id, "overlayValueExceptions", [])}>{tr("Réinitialiser les")} {phase.overlayValueExceptions.length} {tr("exception(s)")}</Button></div>}
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
                  <div className="export-summary"><span>PNG : {Math.round(W * S.pngScale)} × {Math.round(H * S.pngScale)} px</span><span>PDF / TIFF : {S.exportDpi} dpi</span><span>{tr("SVG : vectoriel éditable")}</span></div>
                </Section>
                <Section title="Prévisualiser et exporter">
                  <div className="inline-actions"><Button variant="primary" icon="preview" disabled={isExporting} onClick={() => openExportPreview("png")}>Ouvrir la prévisualisation</Button><Button variant="secondary" icon="duplicate" disabled={isExporting} onClick={copyPngToClipboard}>Copier PNG</Button></div>
                  <div className="callout">{tr("La prévisualisation utilise le même SVG normalisé que les fichiers PNG, TIFF, SVG et PDF. Le zoom de l’éditeur n’affecte pas le résultat.")}</div>
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

      {message && <div className="toast" role="status" aria-live="polite"><span className="toast__icon"><Icon name="check" size={13} /></span><span>{translateMessage(message, language)}</span><button type="button" aria-label={tr("Fermer la notification")} title={tr("Fermer la notification")} onClick={() => setMessage("")}><Icon name="close" size={14} /></button></div>}
      {isExporting && <div className="export-overlay"><div className="export-orbit"><Icon name="download" size={20} /></div><strong>{tr("Génération de la figure")}</strong><span>{tr("Préparation du fichier haute résolution…")}</span></div>}
      {exportPreview.open && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeExportPreview(); }}>
        <section className="export-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="export-preview-title">
          <header className="export-preview-dialog__header"><div><strong id="export-preview-title">{tr("Prévisualisation de l’export")}</strong><span>{tr("Rendu normalisé · indépendant du zoom de l’éditeur")}</span></div><IconButton icon="close" title="Fermer" onClick={closeExportPreview} /></header>
          <div className="export-preview-dialog__body">
            <div className="export-preview-stage" style={{ background: S.transparentExport ? "repeating-conic-gradient(#e9edf2 0 25%, #ffffff 0 50%) 50% / 18px 18px" : S.pageBackground }}>
              <img src={svgDataUrl(exportPreview.serialized)} alt={tr("Prévisualisation exacte de la figure exportée")} />
            </div>
            <aside className="export-preview-controls">
              <label><span>{tr("Format")}</span><select value={exportPreview.format} onChange={(event) => setExportPreview((current) => ({ ...current, format: event.target.value }))}><option value="png">PNG</option><option value="tiff">TIFF</option><option value="svg">SVG</option><option value="pdf">PDF</option></select></label>
              <div className="export-summary"><span>{tr("Figure :")} {Math.round(W)} × {Math.round(H)} {tr("unités")}</span>{exportPreview.format === "png" && <span>PNG : {Math.round(W * S.pngScale)} × {Math.round(H * S.pngScale)} px</span>}{["tiff", "pdf"].includes(exportPreview.format) && <span>{tr("Résolution demandée :")} {S.exportDpi} dpi</span>}<span>{tr("Fond :")} {S.transparentExport && exportPreview.format !== "pdf" ? tr("transparent") : S.pageBackground}</span><span>{tr("Épaisseur des courbes :")} {S.lineWidth}</span></div>
              <div className="export-preview-actions"><Button variant="secondary" onClick={closeExportPreview}>Annuler</Button><Button variant="primary" icon="download" disabled={isExporting} onClick={downloadPreviewedFigure}>{tr("Exporter")} {exportPreview.format.toUpperCase()}</Button></div>
            </aside>
          </div>
        </section>
      </div>}
      {addNoteMode && <div className="mode-banner"><Icon name="note" /><span>{tr("Cliquer dans la zone principale de la figure pour placer la note.")}</span><button type="button" onClick={() => setAddNoteMode(false)}>{tr("Annuler")}</button></div>}
    </div>
  );
}
