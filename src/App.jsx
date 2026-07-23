import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useHistoryState from "./useHistoryState";
import ramanDatabaseSeed from "./ramanDatabaseSeed.json";
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
} from "./lib";

const EMPTY_PROJECT = createEmptyProject();

function updateWorkspaceProject(project, mode, updater) {
  const resolvedMode = mode === "raman" ? "raman" : "drx";
  const currentWorkspace = project.workspaces?.[resolvedMode] || createWorkspace(resolvedMode);
  const nextWorkspace = typeof updater === "function" ? updater(currentWorkspace) : { ...currentWorkspace, ...updater };
  return {
    ...project,
    version: 17,
    updatedAt: Date.now(),
    workspaces: {
      ...(project.workspaces || {}),
      [resolvedMode]: nextWorkspace,
    },
  };
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
    rotation: clamp(finiteNumber(note?.rotation, 0), -180, 180),
    vline: Boolean(note?.vline),
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

function WorkspaceIllustration({ mode = "drx", compact = false }) {
  const isRaman = mode === "raman";
  return (
    <svg className={`workspace-asset ${compact ? "is-compact" : ""}`} viewBox="0 0 320 170" aria-hidden="true">
      <defs>
        <linearGradient id={`assetGradient-${mode}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={isRaman ? "#7c6cff" : "#e39a62"} />
          <stop offset="1" stopColor={isRaman ? "#d55aa3" : "#7d6dff"} />
        </linearGradient>
        <radialGradient id={`assetGlow-${mode}`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={isRaman ? "#7c6cff" : "#e39a62"} stopOpacity=".32" />
          <stop offset="1" stopColor={isRaman ? "#7c6cff" : "#e39a62"} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="workspace-asset__glow" cx="160" cy="88" rx="120" ry="65" fill={`url(#assetGlow-${mode})`} />
      <path className="workspace-asset__grid" d="M35 132H286M35 100H286M35 68H286M76 35V143M126 35V143M176 35V143M226 35V143M276 35V143" />
      <path className="workspace-asset__axis" d="M35 30V143H291" />
      {isRaman ? (
        <>
          <path className="workspace-asset__signal workspace-asset__signal--back" d="M38 126C54 124 61 116 72 119c13 4 20 8 31-10 13-22 24-5 35-7 13-2 15-29 28-29 15 0 15 46 32 42 12-2 15-17 28-17 13 0 17 23 31 19 11-3 13-14 29-12" />
          <path className="workspace-asset__signal" stroke={`url(#assetGradient-${mode})`} d="M38 131C57 128 62 122 75 124c15 2 20 0 29-15 12-20 23-3 35-6 14-3 14-45 30-45 16 0 14 56 33 51 14-3 15-25 30-23 14 2 16 31 32 22 8-5 13-11 23-8" />
          <circle className="workspace-asset__particle workspace-asset__particle--1" cx="169" cy="58" r="3" />
          <circle className="workspace-asset__particle workspace-asset__particle--2" cx="232" cy="86" r="2.4" />
        </>
      ) : (
        <>
          {[58, 84, 112, 144, 169, 213, 251, 276].map((x, index) => (
            <line key={x} className="workspace-asset__stick" x1={x} x2={x} y1="132" y2={132 - [22, 46, 29, 79, 36, 62, 27, 45][index]} stroke={`url(#assetGradient-${mode})`} />
          ))}
          <path className="workspace-asset__signal" stroke={`url(#assetGradient-${mode})`} d="M38 130 52 129 58 108 63 129 79 128 84 87 90 129 107 128 112 103 117 129 139 128 144 52 150 129 164 128 169 96 175 129 207 128 213 68 220 129 246 128 251 104 257 129 271 128 276 88 282 130" />
        </>
      )}
      <g className="workspace-asset__labels">
        <rect x="43" y="40" width="62" height="18" rx="9" />
        <text x="74" y="52" textAnchor="middle">{isRaman ? "RAMAN" : "DRX"}</text>
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
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      {children && <span>{children}</span>}
    </button>
  );
}

function IconButton({ icon, title, active = false, disabled = false, danger = false, onClick }) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "is-active" : ""} ${danger ? "is-danger" : ""}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function Section({ title, children, defaultOpen = true, badge, targetId }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`property-section ${open ? "is-open" : ""}`} data-context-target={targetId || undefined}>
      <button type="button" className="property-section__header" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="property-section__chevron"><Icon name="chevronRight" size={14} /></span>
        <span>{title}</span>
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
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
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
        <NumericInput value={value} min={min} max={max} step={step} onCommit={onChange} ariaLabel={label} />
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
          <NumericInput value={value} min={min} max={max} step={step} onCommit={onChange} ariaLabel={label} />
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
          return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
        })}
      </select>
    </Field>
  );
}

function Toggle({ label, checked, onChange, description }) {
  return (
    <button type="button" className="toggle-row" onClick={() => onChange(!checked)}>
      <span>
        <span className="toggle-row__label">{label}</span>
        {description && <span className="toggle-row__description">{description}</span>}
      </span>
      <span className={`switch ${checked ? "is-on" : ""}`}><span /></span>
    </button>
  );
}

function EmptyPanel({ title, body, kind = "pattern" }) {
  return (
    <div className={`empty-panel empty-panel--${kind}`}>
      <MiniAsset kind={kind} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function PatternItem({
  pattern, index, color, selected, onSelect, onUpdate, onDelete, onDragStart, onDrop,
  averageSelectable = false, averageChecked = false, onAverageToggle,
}) {
  const meta = pattern.isAverage
    ? `${pattern.replicateCount || pattern.sourcePatternIds?.length || 0} acquisitions moyennées · ${pattern.x.length.toLocaleString("fr-FR")} points`
    : `${pattern.x.length.toLocaleString("fr-FR")} points · #${index + 1}`;
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
        <span className="data-item__meta">{meta}{pattern.orderValue !== undefined && pattern.orderValue !== null ? ` · ordre ${pattern.orderValue}` : ""}{pattern.groupName ? ` · ${pattern.groupName}` : ""}</span>
        {averageSelectable && (
          <label className={`average-pick ${averageChecked ? "is-checked" : ""}`} onClick={(event) => event.stopPropagation()}>
            <input type="checkbox" checked={averageChecked} onChange={(event) => onAverageToggle?.(event.target.checked)} />
            <span>Inclure dans la moyenne Raman</span>
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

function PhaseItem({ phase, selected, onSelect, onUpdate, onDelete, onAppend, onDragStart, onDrop }) {
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
        <span className="data-item__meta">{phase.peaks.length} pics · {truncateLabel(phaseSubtitle(phase), 44)}</span>
        <div className="data-item__chips">
          <span className="type-badge"><Icon name="phase" size={10} /> {phase.sourceKind === "manual" ? "manuel" : phase.sourceKind === "raman-spectrum" ? "RRUFF" : "référence"}</span>
          <button type="button" className={phase.inAnnot ? "chip is-on" : "chip"} onClick={(event) => { event.stopPropagation(); onUpdate("inAnnot", !phase.inAnnot); }}>annotation</button>
          <button type="button" className={phase.inPanel ? "chip is-on" : "chip"} onClick={(event) => { event.stopPropagation(); onUpdate("inPanel", !phase.inPanel); }}>panneau</button>
          <button type="button" className="chip chip--action" onClick={(event) => { event.stopPropagation(); onAppend(); }}>+ fiche</button>
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
        <span className="data-item__meta">x = {safe.x.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} · y = {Math.round(safe.yFrac * 100)} %</span>
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
        <span className="data-item__meta">{Number(zone.xmin).toLocaleString("fr-FR")}–{Number(zone.xmax).toLocaleString("fr-FR")} cm⁻¹</span>
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
        <span className="project-switcher__kicker">Projet actif</span>
        <strong title={project.name}>{project.name || 'Projet sans titre'}</strong>
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div className="project-menu" role="dialog" aria-label="Bibliothèque de projets">
          <div className="project-menu__header">
            <div><span>Bibliothèque locale</span><strong>{entries.length} projet(s)</strong></div>
            <IconButton icon="close" title="Fermer" onClick={onToggle} />
          </div>
          <div className="project-menu__search"><Icon name="folder" size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un projet…" /></div>
          <div className="project-menu__list">
            {filtered.map((entry) => (
              <button type="button" key={entry.id} className={`project-row ${entry.id === project.id ? 'is-active' : ''}`} onClick={() => onSwitch(entry.id)}>
                <span className="project-row__mark">{entry.id === project.id ? <Icon name="check" size={12} /> : null}</span>
                <span className="project-row__copy"><strong>{entry.name}</strong><small>{entry.drxCount} DRX · {entry.ramanCount} Raman · {new Date(entry.updatedAt).toLocaleDateString('fr-FR')}</small></span>
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
      <div className="bulk-bar__count"><strong>{count}</strong><span>sélectionné{count > 1 ? 's' : ''}</span></div>
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

function RangeNavigator({ patterns, fullRange, xmin, xmax, axisMode = "native", wavelength = 1.5406, unitLabel = "", onPreview, onCommit, onCancel }) {
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
  const toPct = (axisValue) => ((axisValue - fullAxisRange.minimum) / axisWidth) * 100;
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
    const delta = ((event.clientX - drag.startClientX) / Math.max(1, drag.rectWidth)) * fullWidth;
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

  const leftPct = clamp(toPct(viewAxisRange.minimum), 0, 100);
  const rightPct = clamp(toPct(viewAxisRange.maximum), 0, 100);
  return (
    <div
      className={`range-navigator ${draft ? "is-dragging" : ""}`}
      ref={ref}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" aria-label="Navigateur de plage X">
        {overview.map((item, index) => <path key={item.id} d={item.path} fill="none" stroke="currentColor" opacity={0.14 + index * 0.04} strokeWidth="0.45" />)}
        <rect x="0" y="1" width={Math.max(0, leftPct)} height="40" className="range-navigator__outside" />
        <rect x={rightPct} y="1" width={Math.max(0, 100 - rightPct)} height="40" className="range-navigator__outside" />
        <rect x={leftPct} y="1" width={Math.max(0.5, rightPct - leftPct)} height="40" className="range-navigator__selection" onPointerDown={(event) => start(event, "move")} />
        <g className="range-navigator__grip" onPointerDown={(event) => start(event, "left")}>
          <rect x={leftPct - 1.4} y="1" width="2.8" height="40" rx="0.7" />
          <line x1={leftPct} x2={leftPct} y1="4" y2="38" />
        </g>
        <g className="range-navigator__grip" onPointerDown={(event) => start(event, "right")}>
          <rect x={rightPct - 1.4} y="1" width="2.8" height="40" rx="0.7" />
          <line x1={rightPct} x2={rightPct} y1="4" y2="38" />
        </g>
      </svg>
      <span>{formatAxis(fullAxisRange.minimum)}</span><strong>{formatAxis(viewAxisRange.minimum)} — {formatAxis(viewAxisRange.maximum)}{unitLabel && <small>{unitLabel}</small>}</strong><span>{formatAxis(fullAxisRange.maximum)}</span>
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
      <text x={margin.left} y="21" fontSize="12" fontWeight="700" fill="#303743">DONNÉES BRUTES</text>
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

function FigureLayoutLayer({ mode, processed, rawProcessed, activePatternId, settings, colors, bounds, xmin, xmax }) {
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
      const xTo = (value) => inner.left + ((value - xmin) / Math.max(1e-12, xmax - xmin)) * (inner.right - inner.left);
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
        <text x={px + 8} y={py + 16} fontSize={Math.max(8, Number(settings.tickFontSize) || 10)} fontWeight="700" fill="#20252b">{settings.panelLettering !== false ? `(${String.fromCharCode(panelLetterStart + panelIndex)}) ` : ""}{truncateLabel(panel.title, 42)}</text>
        <text x={(inner.left + inner.right) / 2} y={py + panelHeight - 7} textAnchor="middle" fontSize={Math.max(7, Number(settings.tickFontSize) - 1 || 9)} fill="#343a40">{settings.mode === "drx" ? "2θ (°)" : "Raman shift (cm⁻¹)"}</text>
      </g>;
    })}
    {settings.sharedPatternLegend && <g>
      {processed.slice(0, 8).map((pattern, index) => <g key={`shared-${pattern.id}`} transform={`translate(${x + width - 150},${y + 12 + index * 14})`}><line x1="0" x2="18" y1="-3" y2="-3" stroke={colors.get(pattern.id) || "#222"} strokeWidth="2"/><text x="24" y="0" fontSize="8" fill="#20252b">{truncateLabel(pattern.label, 22)}</text></g>)}
    </g>}
  </g>;
}

export default function App() {
  const history = useHistoryState(EMPTY_PROJECT);
  const project = history.value;
  const activeMode = project.activeMode === "raman" ? "raman" : "drx";
  const workspace = project.workspaces?.[activeMode] || createWorkspace(activeMode);
  const { settings: S, patterns, phases, notes, zones = [] } = workspace;
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
    return { drx: summarize("drx"), raman: summarize("raman") };
  }, [project.workspaces]);

  const [leftTab, setLeftTab] = useState("patterns");
  const [rightTab, setRightTab] = useState("inspector");
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
  const [snapToPeak, setSnapToPeak] = useState(() => readLocalSetting("make-figure-snap-to-peak", "true") === "true");
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
  const [ramanAverageSelection, setRamanAverageSelection] = useState([]);
  const [ramanAverageLabel, setRamanAverageLabel] = useState("");
  const [manualPhase, setManualPhase] = useState({ name: "", abbrev: "", peaks: "", color: PHASE_COLORS[0] });
  const [zoneDraft, setZoneDraft] = useState({ name: "", xmin: 500, xmax: 700, color: "#7c5cff", opacity: 0.12 });
  const [peakFitResult, setPeakFitResult] = useState(null);
  const [alignmentPreview, setAlignmentPreview] = useState(null);
  const [ramanDatabaseQuery, setRamanDatabaseQuery] = useState("");
  const [ramanDatabaseSelectedElements, setRamanDatabaseSelectedElements] = useState([]);
  const [phaseLibrary, setPhaseLibrary] = useState(() => {
    try { return JSON.parse(readLocalSetting("make-figure-drx-phase-library", "[]")) || []; } catch { return []; }
  });
  const [styleTemplates, setStyleTemplates] = useState(() => {
    try { return JSON.parse(readLocalSetting("make-figure-style-templates", "[]")) || []; } catch { return []; }
  });
  const [templateName, setTemplateName] = useState("");
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
    setRightTab(tab);
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
  }, [contextTarget, rightTab, selection, reduceMotion]);

  const patchSettings = useCallback((key, value, options) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      settings: { ...currentWorkspace.settings, [key]: value },
    })), options);
  }, [activeMode, history]);

  const patchSettingsValues = useCallback((values, options) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      settings: { ...currentWorkspace.settings, ...values },
    })), options);
  }, [activeMode, history]);

  const updatePattern = useCallback((id, key, value) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((pattern) => pattern.id === id
        ? (pattern.locked && key !== "locked" ? pattern : { ...pattern, [key]: value })
        : pattern),
    })));
  }, [activeMode, history]);


  const updatePhase = useCallback((id, key, value) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      phases: currentWorkspace.phases.map((phase) => phase.id === id ? { ...phase, [key]: value } : phase),
    })));
  }, [activeMode, history]);

  const updateNote = useCallback((id, key, value) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      notes: currentWorkspace.notes.map((note) => note.id === id ? { ...note, [key]: value } : note),
    })));
  }, [activeMode, history]);

  const updateZone = useCallback((id, key, value) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      zones: currentWorkspace.zones.map((zone) => zone.id === id ? { ...zone, [key]: value } : zone),
    })));
  }, [activeMode, history]);

  const moveItemToWorkspace = useCallback((type, id, targetMode) => {
    const destination = targetMode === "raman" ? "raman" : "drx";
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
    setMessage(`${type === "pattern" ? "Patron" : "Phase"} déplacé vers l’espace ${destination === "drx" ? "DRX" : "Raman"}.`);
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
          restored = legacy ? validateProject(legacy) : createEmptyProject("drx", { name: "Premier projet" });
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
          await refreshProjectIndex();
          setAutosaveState("saved");
        })
        .catch(() => setAutosaveState("error"));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [project, autosaveState === "loading", refreshProjectIndex]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [snapToPeak, showNavigator]);

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
    const additions = [];
    const warnings = [];
    for (const file of files) {
      try {
        const parsed = parseXYText(await file.text());
        if (parsed.x.length < 5) {
          warnings.push(`${file.name}: moins de 5 points valides`);
          continue;
        }
        additions.push({
          id: newId("pattern"),
          label: file.name.replace(/\.(xy|txt|csv|dat)$/i, ""),
          fileName: file.name,
          x: parsed.x,
          y: parsed.y,
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
        if (parsed.ignored) warnings.push(`${file.name}: ${parsed.ignored} ligne(s) ignorée(s)`);
      } catch {
        warnings.push(`${file.name}: lecture impossible`);
      }
    }
    if (additions.length) {
      history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
        ...currentWorkspace,
        patterns: [...currentWorkspace.patterns, ...additions],
      })));
      setLeftTab("patterns");
      setSelection([{ type: "pattern", id: additions[0].id }]); selectionAnchorRef.current = { type: "pattern", id: additions[0].id };
      setMessage(`${additions.length} patron(s) importé(s) dans ${activeMode === "drx" ? "DRX" : "Raman"}${warnings.length ? ` · ${warnings.join(" · ")}` : ""}`);
    } else if (warnings.length) setMessage(warnings.join(" · "));
  }, [activeMode, history]);

  const importPhases = useCallback(async (files) => {
    const additionsByMode = { drx: [], raman: [] };
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

    const importedModes = ["drx", "raman"].filter((mode) => additionsByMode[mode].length);
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
      const summary = importedModes.map((mode) => `${additionsByMode[mode].length} vers ${mode === "drx" ? "DRX" : "Raman"}`).join(" · ");
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
    history.set((current) => updateWorkspaceProject(current, "raman", (currentWorkspace) => ({
      ...currentWorkspace,
      zones: [...currentWorkspace.zones, zone],
    })));
    setZoneDraft((current) => ({ ...current, name: "" }));
    setSelection([{ type: "zone", id: zone.id }]); selectionAnchorRef.current = { type: "zone", id: zone.id };
    setRightTab("inspector");
    setMessage(`Zone Raman « ${name} » ajoutée.`);
  };

  const toggleRamanAveragePattern = (id, checked) => {
    setRamanAverageSelection((current) => checked
      ? (current.includes(id) ? current : [...current, id])
      : current.filter((value) => value !== id));
  };

  const createRamanAverage = () => {
    const selected = patterns.filter((pattern) => ramanAverageSelection.includes(pattern.id) && !pattern.isAverage);
    if (selected.length < 2) {
      setMessage("Sélectionner au moins deux acquisitions Raman.");
      return;
    }
    try {
      const averaged = averagePatterns(selected, {
        label: ramanAverageLabel || `Moyenne Raman · ${selected.length} acquisitions`,
        method: S.ramanAverageMethod,
        normalizeMode: S.ramanAverageNormalize,
      });
      history.set((current) => updateWorkspaceProject(current, "raman", (currentWorkspace) => ({
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
      setMessage(error.message || "Impossible de calculer la moyenne Raman.");
    }
  };

  const setMode = (mode) => {
    const resolvedMode = mode === "raman" ? "raman" : "drx";
    if (resolvedMode === activeMode) return;
    history.set((current) => ({ ...current, activeMode: resolvedMode }), { replace: true });
    setSelection([]); selectionAnchorRef.current = null;
    setCursor(null);
    if (resolvedMode === "drx" && leftTab === "zones") setLeftTab("patterns");
    setMessage(`Espace ${resolvedMode === "drx" ? "DRX" : "Raman"} actif. Les données de l’autre espace restent conservées.`);
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
    const destination = targetMode === "raman" ? "raman" : "drx";
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
    const defaultName = `Projet ${projectIndex.length + 1}`;
    const name = window.prompt("Nom du nouveau projet", defaultName);
    if (name === null) return;
    const next = createEmptyProject(activeMode, { name: name.trim() || defaultName });
    history.replace(next);
    clearSelection();
    setZoom(1);
    setLeftTab("patterns");
    setRightTab("appearance");
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
      setMessage("Aucune zone Raman à exporter.");
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
    downloadBlob(`\ufeff${rows.join("\n")}`, "text/csv;charset=utf-8", `${S.fileName || "figure"}_raman_zones.csv`);
    setMessage(`${zones.length} zone(s) Raman exportée(s) en CSV.`);
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
  const M = { left: S.figureLayoutMode === "single" ? 62 : 22, right: S.figureLayoutMode === "single" ? S.rightMargin : 22, top: (S.title ? 48 : 22) + insetDockTopHeight, gap: 10, axisHeight: S.figureLayoutMode === "single" ? 50 : 10 };
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
  const breakActive = activeMode === "drx" && drxAxisMode === "2theta" && S.brokenAxisEnabled && Number(S.brokenAxisEnd) > Number(S.brokenAxisStart) && Number(S.brokenAxisStart) > viewXMin && Number(S.brokenAxisEnd) < viewXMax;
  const xToPx = useCallback((x) => {
    if (breakActive) {
      const start = Number(S.brokenAxisStart); const end = Number(S.brokenAxisEnd); const gap = Math.max(8, Number(S.brokenAxisGapPx) || 18);
      const leftSpan = start - viewXMin; const rightSpan = viewXMax - end; const usable = Math.max(1, plotWidth - gap); const total = Math.max(1e-12, leftSpan + rightSpan);
      const leftWidth = usable * leftSpan / total;
      if (x <= start) return M.left + ((x - viewXMin) / Math.max(1e-12, leftSpan)) * leftWidth;
      if (x >= end) return M.left + leftWidth + gap + ((x - end) / Math.max(1e-12, rightSpan)) * (usable - leftWidth);
      return M.left + leftWidth + gap / 2;
    }
    const current = axisCoordinate(x);
    return M.left + ((current - primaryAxisWindow.minimum) / Math.max(1e-12, primaryAxisWindow.maximum - primaryAxisWindow.minimum)) * plotWidth;
  }, [M.left, S.brokenAxisEnd, S.brokenAxisGapPx, S.brokenAxisStart, axisCoordinate, breakActive, plotWidth, primaryAxisWindow.maximum, primaryAxisWindow.minimum, viewXMax, viewXMin]);
  const pxToDataX = useCallback((px) => {
    const bounded = clamp(Number(px), M.left, M.left + plotWidth);
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
  }, [M.left, S.brokenAxisEnd, S.brokenAxisGapPx, S.brokenAxisStart, activeMode, breakActive, drxAxisMode, plotWidth, primaryAxisWindow.maximum, primaryAxisWindow.minimum, viewXMax, viewXMin, wavelength]);
  const yToPx = useCallback((y) => M.top + mainHeight - ((y - yMinimum) / (yMaximum - yMinimum)) * mainHeight, [M.top, mainHeight, yMinimum, yMaximum]);
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
    const targetMode = mode === "raman" ? "raman" : "drx";
    const phase = { ...entry, id: newId("phase"), libraryKey: undefined, savedAt: undefined, files: [...(entry.files || []), "bibliothèque locale"] };
    history.set((current) => updateWorkspaceProject(current, targetMode, (currentWorkspace) => ({ ...currentWorkspace, phases: [...currentWorkspace.phases, phase] })));
    setMessage(`Phase « ${phase.name} » ajoutée dans l’espace ${targetMode === "drx" ? "DRX" : "Raman"}.`);
  }, [activeMode, history]);

  const applyJournalPreset = useCallback((key) => {
    const preset = JOURNAL_PRESETS[key];
    if (!preset) return;
    history.set((current) => ({
      ...current,
      version: 17,
      workspaces: {
        ...current.workspaces,
        drx: { ...current.workspaces.drx, settings: { ...current.workspaces.drx.settings, ...preset } },
        raman: { ...current.workspaces.raman, settings: { ...current.workspaces.raman.settings, ...preset } },
      },
    }));
    setMessage(`Gabarit « ${preset.label} » appliqué aux espaces DRX et Raman.`);
  }, [history]);

  const saveStyleTemplate = useCallback(() => {
    const name = templateName.trim();
    if (!name) { setMessage("Saisir un nom de style."); return; }
    const keys = ["figWidth", "axisFontSize", "tickFontSize", "titleFontSize", "lineWidth", "showFill", "fillAlpha", "cmap", "cmapMin", "cmapMax", "cmapReverse", "useCustomColors", "pageBackground", "rightMargin", "patternLabelSize", "patternLabelBold", "pdfStickW", "annotFontSize", "figureLayoutMode", "gridColumns", "panelGap", "panelLettering", "sharedPatternLegend"];
    const settings = Object.fromEntries(keys.map((key) => [key, S[key]]));
    setStyleTemplates((current) => [...current.filter((entry) => entry.name !== name), { id: newId("style"), name, settings, savedAt: Date.now() }]);
    setTemplateName("");
    setMessage(`Style « ${name} » enregistré localement.`);
  }, [S, templateName]);

  const applyStyleTemplate = useCallback((entry) => {
    history.set((current) => ({
      ...current,
      workspaces: {
        ...current.workspaces,
        drx: { ...current.workspaces.drx, settings: { ...current.workspaces.drx.settings, ...entry.settings } },
        raman: { ...current.workspaces.raman, settings: { ...current.workspaces.raman.settings, ...entry.settings } },
      },
    }));
    setMessage(`Style « ${entry.name} » appliqué aux deux espaces.`);
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
    const clone = svgRef.current.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.querySelectorAll("[data-ui-only]").forEach((element) => element.remove());
    const background = clone.querySelector("[data-figure-background]");
    if (background) background.setAttribute("fill", transparent ? "none" : S.pageBackground);
    return new XMLSerializer().serializeToString(clone);
  };

  const downloadSvg = () => {
    const serialized = serializeSvg();
    if (!serialized) return;
    downloadBlob(serialized, "image/svg+xml;charset=utf-8", `${S.fileName || "figure"}.svg`);
  };

  const rasterizeSvg = async (requestedScale, transparent = S.transparentExport) => {
    const serialized = serializeSvg({ transparent });
    if (!serialized) throw new Error("Figure SVG indisponible.");
    const maximumDimension = 10000;
    const maximumPixels = 28000000;
    const pixelLimitedScale = Math.sqrt(maximumPixels / Math.max(1, W * H));
    const scale = Math.max(0.25, Math.min(requestedScale, maximumDimension / W, maximumDimension / H, pixelLimitedScale));
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Échec du rendu SVG."));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
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
      const requestedScale = Math.max(1, S.exportDpi / 96);
      const { canvas, scale } = await rasterizeSvg(requestedScale, false);
      const effectiveDpi = Math.round(scale * 96);
      const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.97));
      if (!jpegBlob) throw new Error("Encodage JPEG intermédiaire impossible.");
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      const pdf = buildPdfFromJpeg(jpegBytes, canvas.width, canvas.height, effectiveDpi);
      downloadBlob(pdf, "application/pdf", `${S.fileName || "figure"}.pdf`);
      setMessage(`Figure PDF exportée à ${effectiveDpi} dpi${effectiveDpi < S.exportDpi ? " — résolution limitée par la taille du canvas" : ""}.`);
    } catch (error) {
      setMessage(`Échec PDF : ${error.message}`);
    } finally {
      setIsExporting(false);
    }
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

  const onSvgPointerDown = () => {};

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
        setDragPreview({ type: "note", id: interaction.payload.id, x: clamp(point.dataX, S.xmin, S.xmax), yFrac: clamp(1 - ((point.svgY - M.top) / mainHeight), 0, 1), fontSize: interaction.payload.fontSize });
      } else if (interaction.type === "noteResize") {
        setDragPreview({ type: "noteResize", id: interaction.payload.id, fontSize: clamp(interaction.payload.fontSize + (point.svgX - interaction.start.svgX) / 4, 5, 60) });
      } else if (interaction.type === "patternLabel") {
        setDragPreview({ type: "patternLabel", id: interaction.payload.id, dx: interaction.payload.dx + (point.svgX - interaction.start.svgX), dy: interaction.payload.dy + (point.svgY - interaction.start.svgY), fontSize: interaction.payload.fontSize });
      } else if (interaction.type === "patternLabelResize") {
        setDragPreview({ type: "patternLabelResize", id: interaction.payload.id, fontSize: clamp(interaction.payload.fontSize + (point.svgX - interaction.start.svgX) / 4, 6, 42) });
      } else if (interaction.type === "phaseLegendMove") {
        setDragPreview({ type: "phaseLegendMove", x: interaction.payload.x + (point.svgX - interaction.start.svgX), y: interaction.payload.y + (point.svgY - interaction.start.svgY), width: interaction.payload.width });
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
          deltaPx: point.svgX - interaction.start.svgX,
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

  const onSvgClick = (event) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    const point = svgPoint(event);
    if (!point?.insidePlot || interactionRef.current) return;
    if (!addNoteMode) return;
    const note = {
      id: newId("note"),
      x: Math.round(point.dataX * 1000) / 1000,
      yFrac: clamp(Math.round((1 - ((point.svgY - M.top) / mainHeight)) * 1000) / 1000, 0, 1),
      text: "Annotation",
      color: "#2d333b",
      fontSize: 10,
      rotation: 0,
      vline: false,
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
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
      } else if (event.key === "Escape") {
        if (interactionRef.current) {
          try { svgRef.current?.releasePointerCapture?.(interactionRef.current.pointerId); } catch { /* no-op */ }
          interactionRef.current = null;
          setDragPreview(null);
        }
        setAddNoteMode(false);
        setTool("cursor");
        setDropActive(false);
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
  }, [clearSelection, history, removeSelection, saveSessionFile, selectAllCurrentTab, tool]);

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
          <div className="callout">Les actions suivantes s’appliquent aux {selectedByType.pattern.size} patrons sélectionnés.</div>
          <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={resetSelectedPatternTransforms}>Réinitialiser Y et Δx</Button><Button variant="secondary" icon="lock" onClick={() => setSelectedLock(true)}>Verrouiller</Button><Button variant="secondary" icon="unlock" onClick={() => setSelectedLock(false)}>Déverrouiller</Button></div>
          <SelectField label="Déplacer vers" value={activeMode} onChange={moveSelectionToWorkspace} options={[[activeMode, activeMode.toUpperCase()], [activeMode === "drx" ? "raman" : "drx", activeMode === "drx" ? "Raman" : "DRX"]]} />
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
          <SelectField label="Déplacer vers" value={activeMode} onChange={moveSelectionToWorkspace} options={[[activeMode, activeMode.toUpperCase()], [activeMode === "drx" ? "raman" : "drx", activeMode === "drx" ? "Raman" : "DRX"]]} />
        </Section>
      )}
      <Section title="Raccourcis" defaultOpen={false}><div className="shortcut-list"><span><kbd>Ctrl/Cmd</kbd> Ajouter ou retirer</span><span><kbd>Shift</kbd> Sélectionner une plage</span><span><kbd>Ctrl/Cmd+A</kbd> Tout sélectionner dans l’onglet</span><span><kbd>Suppr.</kbd> Supprimer la sélection</span></div></Section>
    </>
  ) : activePattern ? (
    <>
      <Section title="Patron sélectionné" targetId="pattern-inspector">
        <TextField targetId="pattern-name" label="Nom" value={activePattern.label} onChange={(value) => updatePattern(activePattern.id, "label", value)} />
        <SelectField label="Espace de travail" value={activeMode} onChange={(value) => moveItemToWorkspace("pattern", activePattern.id, value)} options={[["drx", "DRX"], ["raman", "Raman"]]} />
        <div className="two-columns">
          <NumberField label="Facteur Y" value={activePattern.yscale} step={0.05} onChange={(value) => updatePattern(activePattern.id, "yscale", value)} />
          <NumberField label="Décalage X" value={activePattern.xoffset} step={0.01} onChange={(value) => updatePattern(activePattern.id, "xoffset", value)} />
        </div>
        <Field label="Couleur manuelle">
          <div className="color-field">
            <input type="color" value={activePattern.color} onChange={(event) => updatePattern(activePattern.id, "color", event.target.value)} />
            <code>{activePattern.color}</code>
          </div>
        </Field>
        <Toggle label="Visible" checked={activePattern.visible} onChange={(value) => updatePattern(activePattern.id, "visible", value)} />
        <Section title="Étiquette de courbe" defaultOpen={false} targetId="pattern-label-options">
          <div className="two-columns"><NumberField label="Décalage horizontal" value={activePattern.labelDx || 0} step={2} suffix="px" onChange={(value) => updatePattern(activePattern.id, "labelDx", value)} /><NumberField label="Décalage vertical" value={activePattern.labelDy || 0} step={2} suffix="px" onChange={(value) => updatePattern(activePattern.id, "labelDy", value)} /></div>
          <NumberField label="Taille individuelle" value={activePattern.labelFontSize || S.patternLabelSize} min={6} max={42} step={0.5} suffix="pt" onChange={(value) => updatePattern(activePattern.id, "labelFontSize", value)} />
          <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({ ...currentWorkspace, patterns: currentWorkspace.patterns.map((pattern) => pattern.id === activePattern.id ? { ...pattern, labelDx: 0, labelDy: 0, labelFontSize: null } : pattern) })))}>Réinitialiser l’étiquette</Button></div>
        </Section>
        <Toggle label="Verrouiller le patron" checked={Boolean(activePattern.locked)} onChange={(value) => updatePattern(activePattern.id, "locked", value)} description="Empêche le renommage, le déplacement, les transformations et la suppression accidentelle." />
        <TextAreaField label="Notes du patron" value={activePattern.userNotes || ""} onChange={(value) => updatePattern(activePattern.id, "userNotes", value)} rows={4} placeholder="Observations expérimentales, préparation, anomalie…" />
        <div className="two-columns">
          <SelectField label="Type de groupe" value={activePattern.groupType || ""} onChange={(value) => updatePattern(activePattern.id, "groupType", value)} options={[["", "Aucun"], ["sample", "Échantillon"], ["time", "Temps"], ["temperature", "Température"], ["treatment", "Traitement"]]} />
          <NumberField label="Valeur d’ordre" value={activePattern.orderValue ?? ""} step={0.1} onChange={(value) => updatePattern(activePattern.id, "orderValue", value)} />
        </div>
        <TextField label="Nom du groupe" value={activePattern.groupName || ""} onChange={(value) => updatePattern(activePattern.id, "groupName", value)} />
        <div className="info-box">
          <span>{activePattern.fileName}</span>
          <span>{activePattern.x.length.toLocaleString("fr-FR")} points</span>
          <span>Plage : {Number(activePattern.x[0]).toLocaleString("fr-FR")} — {Number(activePattern.x.at(-1)).toLocaleString("fr-FR")}</span>
          {activePattern.fileMetadata && <span>Fichier : {formatBytes(activePattern.fileMetadata.size)}{activePattern.fileMetadata.lastModified ? ` · ${new Date(activePattern.fileMetadata.lastModified).toLocaleString("fr-FR")}` : ""}</span>}
          <span>Traitement : {activePattern.processingOverrides?.enabled ? "individuel" : "réglages globaux"} · lissage {activePattern.processingOverrides?.smoothW ?? S.smoothW} · fond {activePattern.processingOverrides?.baselineMode ?? S.baselineMode} · normalisation {activePattern.processingOverrides?.normalizeMode ?? S.normalizeMode}</span>
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
        <Toggle label="Remplacer les réglages globaux" checked={Boolean(activePattern.processingOverrides?.enabled)} onChange={(enabled) => updatePattern(activePattern.id, "processingOverrides", enabled ? { enabled: true, smoothW: S.smoothW, clipPct: S.clipPct, baselineMode: S.baselineMode, normalizeMode: S.normalizeMode } : { enabled: false })} />
        {activePattern.processingOverrides?.enabled && <>
          <SliderField label="Lissage" value={activePattern.processingOverrides.smoothW ?? S.smoothW} min={1} max={51} step={1} onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, smoothW: Math.round(value) })} />
          <SliderField label="Écrêtage" value={activePattern.processingOverrides.clipPct ?? S.clipPct} min={90} max={100} step={0.1} suffix="%" onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, clipPct: value })} />
          <SelectField label="Ligne de base" value={activePattern.processingOverrides.baselineMode ?? S.baselineMode} onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, baselineMode: value })} options={BASELINE_OPTIONS} />
          <SelectField label="Normalisation" value={activePattern.processingOverrides.normalizeMode ?? S.normalizeMode} onChange={(value) => updatePattern(activePattern.id, "processingOverrides", { ...activePattern.processingOverrides, normalizeMode: value })} options={NORMALIZATION_OPTIONS} />
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
        <SelectField label="Espace de travail" value={activeMode} onChange={(value) => moveItemToWorkspace("phase", activePhase.id, value)} options={[["drx", "DRX"], ["raman", "Raman"]]} />
        <Field label="Couleur">
          <div className="color-field">
            <input type="color" value={activePhase.color} onChange={(event) => updatePhase(activePhase.id, "color", event.target.value)} />
            <code>{activePhase.color}</code>
          </div>
        </Field>
        <Toggle label="Visible" checked={activePhase.visible} onChange={(value) => updatePhase(activePhase.id, "visible", value)} />
        <Toggle label="Annotations supérieures" checked={activePhase.inAnnot} onChange={(value) => updatePhase(activePhase.id, "inAnnot", value)} />
        <Toggle label="Panneau de références" checked={activePhase.inPanel} onChange={(value) => updatePhase(activePhase.id, "inPanel", value)} />
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
          <div className="callout">Les fichiers Raman RRUFF sont lus comme des spectres continus. Seuls les maxima répondant à ces critères sont transformés en bâtonnets de référence.</div>
        </Section>
      )}
      <Section title="Édition manuelle des pics" defaultOpen={activePhase.sourceKind === "manual"}>
        <PhasePeaksEditor phase={activePhase} onApply={(peaks) => updatePhase(activePhase.id, "peaks", peaks)} />
      </Section>
    </>
  ) : activeZone ? (
    <Section title="Zone Raman sélectionnée" targetId="zone-inspector">
      <TextField targetId="zone-name" label="Nom" value={activeZone.name} onChange={(value) => updateZone(activeZone.id, "name", value)} />
      <div className="two-columns">
        <NumberField label="X min" value={activeZone.xmin} step={1} suffix="cm⁻¹" onChange={(value) => updateZone(activeZone.id, "xmin", value)} />
        <NumberField label="X max" value={activeZone.xmax} step={1} suffix="cm⁻¹" onChange={(value) => updateZone(activeZone.id, "xmax", value)} />
      </div>
      <Field label="Couleur"><div className="color-field"><input type="color" value={activeZone.color} onChange={(event) => updateZone(activeZone.id, "color", event.target.value)} /><code>{activeZone.color}</code></div></Field>
      <SliderField label="Opacité" value={activeZone.opacity ?? 0.12} min={0.02} max={0.5} step={0.01} onChange={(value) => updateZone(activeZone.id, "opacity", value)} />
      <Toggle label="Visible" checked={activeZone.visible} onChange={(value) => updateZone(activeZone.id, "visible", value)} />
      <Toggle label="Afficher le nom" checked={activeZone.showLabel !== false} onChange={(value) => updateZone(activeZone.id, "showLabel", value)} />
    </Section>
  ) : activeNote ? (
    <Section title="Note sélectionnée" targetId="note-inspector">
      <TextField targetId="note-text" label="Texte" value={String(activeNote.text ?? "Annotation")} onChange={(value) => updateNote(activeNote.id, "text", value)} />
      <div className="two-columns">
        <NumberField label="Position X" value={finiteNumber(activeNote.x, (S.xmin + S.xmax) / 2)} step={0.05} onChange={(value) => updateNote(activeNote.id, "x", value)} />
        <NumberField label="Position Y" value={clamp(finiteNumber(activeNote.yFrac, 0.72), 0, 1)} min={0} max={1} step={0.01} onChange={(value) => updateNote(activeNote.id, "yFrac", value)} />
      </div>
      <div className="two-columns">
        <NumberField label="Taille" value={clamp(finiteNumber(activeNote.fontSize, 10), 5, 60)} min={5} max={40} step={0.5} onChange={(value) => updateNote(activeNote.id, "fontSize", value)} />
        <NumberField label="Rotation" value={clamp(finiteNumber(activeNote.rotation, 0), -180, 180)} min={-180} max={180} step={5} suffix="°" onChange={(value) => updateNote(activeNote.id, "rotation", value)} />
      </div>
      <Field label="Couleur"><div className="color-field"><input type="color" value={safeNoteModel(activeNote, S.xmin, S.xmax).color} onChange={(event) => updateNote(activeNote.id, "color", event.target.value)} /><code>{activeNote.color}</code></div></Field>
      <Toggle label="Visible" checked={activeNote.visible !== false} onChange={(value) => updateNote(activeNote.id, "visible", value)} /><Toggle label="Ligne verticale" checked={activeNote.vline} onChange={(value) => updateNote(activeNote.id, "vline", value)} />
    </Section>
  ) : (
    <>
      <Section title="Projet actif">
        <TextField label="Nom du projet" value={project.name || ""} onChange={(value) => history.set((current) => ({ ...current, name: value, updatedAt: Date.now() }), { replace: true })} />
        <TextAreaField label="Description" value={project.description || ""} onChange={(value) => history.set((current) => ({ ...current, description: value, updatedAt: Date.now() }), { replace: true })} rows={3} placeholder="Objet de la série, conditions expérimentales…" />
        <div className="project-stats-grid"><span><strong>{workspaceStats.drx.total}</strong>DRX</span><span><strong>{workspaceStats.raman.total}</strong>Raman</span><span><strong>{patterns.length + phases.length}</strong>éléments actifs</span><span><strong>{new Date(project.updatedAt || Date.now()).toLocaleDateString("fr-FR")}</strong>mise à jour</span></div>
        <div className="inline-actions"><Button variant="primary" icon="plus" onClick={createNewProject}>Nouveau projet</Button><Button variant="secondary" icon="duplicate" onClick={duplicateCurrentProject}>Dupliquer</Button></div>
      </Section>
      <Section title="Disposition de l’interface">
        <SelectField label="Densité" value={uiDensity} onChange={setUiDensity} options={[["compact", "Compacte"], ["standard", "Standard"], ["comfortable", "Confortable"]]} />
        <Toggle label="Panneau de données" checked={!leftCollapsed} onChange={(value) => setLeftCollapsed(!value)} />
        <Toggle label="Panneau de propriétés" checked={!rightCollapsed} onChange={(value) => setRightCollapsed(!value)} />
        <div className="inline-actions"><Button variant="secondary" icon="layout" onClick={resetLayout}>Réinitialiser la disposition</Button></div>
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
            {autosaveState === "saving" ? "Enregistrement" : autosaveState === "error" ? "Autosauvegarde indisponible" : "Sauvegardé localement"}
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
            {[["drx", "DRX", "xray"], ["raman", "Raman", "waveform"]].map(([value, label, icon]) => (
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
              <IconButton icon={reduceMotion ? "motionOff" : "motion"} active={reduceMotion} title={reduceMotion ? "Animations réduites" : "Réduire les animations"} onClick={() => setReduceMotion((value) => !value)} />
              <Button variant="secondary" disabled={isExporting} onClick={downloadSvg}>SVG</Button>
              <Button variant="primary" icon="download" disabled={isExporting} onClick={downloadPng}>{isExporting ? "Export…" : "Exporter PNG"}</Button>
            </div>
          </div>
        </div>

        <div className="masthead__ticker" aria-label="Résumé du projet actif">
          <span className="masthead__breaking">{activeMode === "drx" ? "DRX" : "Raman"}</span>
          <span><b>{patterns.length}</b> patrons</span>
          <span><b>{phases.length}</b> phases</span>
          {activeMode === "raman" && <span><b>{zones.length}</b> zones</span>}
          <span><b>{notes.length}</b> notes</span>
        </div>
      </header>

      <main className="workbench" style={{ gridTemplateColumns: `${leftCollapsed ? 0 : leftWidth}px minmax(300px, 1fr) ${rightCollapsed ? 0 : rightWidth}px` }}>
        <aside className={`side-panel side-panel--left ${leftCollapsed ? "is-collapsed" : ""}`} aria-hidden={leftCollapsed}>
          <div className="panel-titlebar"><div><strong>Données · {activeMode === "drx" ? "DRX" : "Raman"}</strong><span>{patterns.length + phases.length + notes.length + zones.length} éléments</span></div><IconButton icon="panelLeft" title="Replier le panneau de données" onClick={() => setLeftCollapsed(true)} /></div>
          <nav className="panel-tabs">
            {[
              ["patterns", "Patrons", patterns.length],
              ["phases", "Phases", phases.length],
              ...(activeMode === "raman" ? [["zones", "Zones", zones.length]] : []),
              ["notes", "Notes", notes.length],
            ].map(([value, label, count]) => (
              <button type="button" key={value} className={leftTab === value ? "is-active" : ""} onClick={() => setLeftTab(value)}><Icon name={value === "patterns" ? "waveform" : value === "phases" ? "phase" : value === "zones" ? "zone" : "note"} size={12} />{label}<span>{count}</span></button>
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
          <div className="project-filter"><Icon name="cursor" size={12} /><input value={listFilter} onChange={(event) => setListFilter(event.target.value)} placeholder="Filtrer la liste active…" /><kbd>Ctrl+A</kbd></div>
          <div className="side-panel__content">
            {leftTab === "patterns" && (
              <>
                <button type="button" className="drop-button" onClick={() => patternInputRef.current?.click()}><span className="drop-button__asset"><Icon name="waveform" /></span><span><strong>Importer des patrons</strong><small>.xy · .txt · .csv · .dat</small></span><Icon name="upload" size={14} /></button>
                <div className="pattern-organizer">
                  <div className="pattern-organizer__row">
                    <label><span><Icon name="sort" size={12} /> Trier</span><select value={patternSort.key} onChange={(event) => setPatternSort((current) => ({ ...current, key: event.target.value }))}><option value="manual">Ordre manuel</option><option value="filename">Nom du fichier</option><option value="date">Date du fichier</option><option value="numeric">Valeur numérique</option><option value="group">Groupe</option></select></label>
                    <button type="button" className="organizer-direction" onClick={() => setPatternSort((current) => ({ ...current, direction: current.direction === "asc" ? "desc" : "asc" }))}>{patternSort.direction === "asc" ? "↑" : "↓"}</button>
                    <Button variant="secondary" disabled={patternSort.key === "manual"} onClick={sortPatterns}>Appliquer</Button>
                  </div>
                  <div className="pattern-organizer__row">
                    <label><span><Icon name="group" size={12} /> Grouper l’affichage</span><select value={groupViewBy} onChange={(event) => setGroupViewBy(event.target.value)}><option value="none">Aucun</option><option value="group">Tous les groupes</option><option value="sample">Échantillon</option><option value="time">Temps</option><option value="temperature">Température</option><option value="treatment">Traitement</option></select></label>
                  </div>
                </div>
                {S.mode === "raman" && (
                  <div className="average-builder">
                    <div className="average-builder__header">
                      <div><strong>Moyenne d’acquisitions Raman</strong><span>{ramanAverageSelection.length} acquisition(s) sélectionnée(s)</span></div>
                      <button type="button" onClick={() => setRamanAverageSelection(patterns.filter((pattern) => pattern.visible && !pattern.isAverage).map((pattern) => pattern.id))}>Sélectionner visibles</button>
                    </div>
                    <input type="text" value={ramanAverageLabel} placeholder="Nom du patron moyen" onChange={(event) => setRamanAverageLabel(event.target.value)} />
                    <div className="average-builder__grid">
                      <label><span>Agrégation</span><select value={S.ramanAverageMethod} onChange={(event) => patchSettings("ramanAverageMethod", event.target.value)}><option value="mean">Moyenne</option><option value="median">Médiane</option></select></label>
                      <label><span>Avant moyenne</span><select value={S.ramanAverageNormalize} onChange={(event) => patchSettings("ramanAverageNormalize", event.target.value)}><option value="none">Intensités brutes</option><option value="max">Normaliser au maximum</option><option value="area">Normaliser à l’aire</option><option value="minmax">Min–max</option></select></label>
                    </div>
                    <Toggle label="Masquer les acquisitions source" checked={S.ramanAverageHideSources} onChange={(value) => patchSettings("ramanAverageHideSources", value)} />
                    <div className="average-builder__actions">
                      <Button variant="secondary" onClick={() => setRamanAverageSelection([])}>Effacer</Button>
                      <Button variant="primary" disabled={ramanAverageSelection.length < 2} onClick={createRamanAverage}>Créer la moyenne</Button>
                    </div>
                    <p>Les acquisitions sont interpolées sur leur plage commune. Les données sources ne sont pas modifiées.</p>
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
                          averageSelectable={S.mode === "raman" && !pattern.isAverage}
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
                <button type="button" className="drop-button" onClick={() => phaseInputRef.current?.click()}><span className="drop-button__asset"><Icon name="phase" /></span><span><strong>Importer des phases</strong><small>{activeMode === "drx" ? ".dif ou liste de pics DRX" : "RRUFF ou liste de pics Raman"}</small></span><Icon name="upload" size={14} /></button>
                <div className="manual-builder">
                  <div className="manual-builder__header"><strong>Ajouter une phase manuellement</strong><span>Positions seules ou position:intensité</span></div>
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
                  <div className="manual-builder__header"><strong>Ajouter une zone Raman</strong><span>Bandes, vibrations ou domaines d’attribution</span></div>
                  <input type="text" value={zoneDraft.name} placeholder="Nom, ex. ν IO — iode" onChange={(event) => setZoneDraft((current) => ({ ...current, name: event.target.value }))} />
                  <div className="manual-builder__grid">
                    <label><span>X min</span><NumericInput value={zoneDraft.xmin} step={1} onCommit={(value) => setZoneDraft((current) => ({ ...current, xmin: value }))} ariaLabel="X min de la zone" /></label>
                    <label><span>X max</span><NumericInput value={zoneDraft.xmax} step={1} onCommit={(value) => setZoneDraft((current) => ({ ...current, xmax: value }))} ariaLabel="X max de la zone" /></label>
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
                  )) : <EmptyPanel kind="zone" title="Aucune zone" body="Ajouter une plage Raman nommée, par exemple une vibration phosphate ou une zone attribuée à l’iode." />}
                </div>
              </>
            )}
            {leftTab === "notes" && (
              <>
                <button type="button" className={`drop-button ${addNoteMode ? "is-active" : ""}`} onClick={() => { setAddNoteMode((value) => !value); setTool("cursor"); }}><span className="drop-button__asset"><Icon name="note" /></span><span><strong>{addNoteMode ? "Cliquer sur la figure…" : "Ajouter une note"}</strong><small>Placement interactif</small></span><Icon name="plus" size={14} /></button>
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
              <IconButton icon="cursor" title="Sélection" active={tool === "cursor"} onClick={() => setTool("cursor")} />
              <IconButton icon="hand" title="Déplacer la feuille · espace" active={tool === "hand"} onClick={() => setTool("hand")} />
              <IconButton icon="magnet" title="Accrochage aux pics" active={snapToPeak} onClick={() => setSnapToPeak((value) => !value)} />
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
            {dropActive && <div className="drop-overlay"><div className="drop-overlay__asset"><WorkspaceIllustration mode={activeMode} compact /></div><Icon name="upload" size={24} /><strong>Déposer les fichiers</strong><span>.dif → DRX · RRUFF Raman → Raman · autres fichiers → espace actif.</span></div>}
            {!visibleCount ? (
              <div className="welcome-card">
                <div className="welcome-card__visual"><WorkspaceIllustration mode={activeMode} /></div>
                <span className="welcome-card__eyebrow"><Icon name="sparkles" size={12} /> Espace {activeMode === "drx" ? "DRX" : "Raman"}</span>
                <h1>{activeMode === "drx" ? "Composer une figure de diffraction" : "Composer une figure Raman"}</h1>
                <p>Importer les acquisitions, ajouter les références, appliquer le traitement du signal puis produire une figure scientifique prête à publier.</p>
                <div className="welcome-card__actions">
                  <Button variant="primary" icon="upload" onClick={() => patternInputRef.current?.click()}>Importer des patrons</Button>
                  <Button variant="secondary" icon="phase" onClick={() => phaseInputRef.current?.click()}>Ajouter des phases</Button>
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

                    {S.title && <text x={M.left + plotWidth / 2} y={M.top - 17} textAnchor="middle" fontSize={S.titleFontSize} fontWeight="700" fill="#15191f" fontFamily="Arial, Helvetica, sans-serif" style={{ cursor: "pointer" }} onDoubleClick={(event) => openContextOptions(event, { tab: "appearance", target: "figure-title" })}>{S.title}</text>}

                    {S.figureLayoutMode === "single" && S.mode === "raman" && zones.filter((zone) => zone.visible && Number(zone.xmax) > viewXMin && Number(zone.xmin) < viewXMax).map((zone) => {
                      const previewMin = dragPreview?.type === "zoneBoundary" && dragPreview.id === zone.id && dragPreview.edge === "min" ? dragPreview.x : Number(zone.xmin);
                      const previewMax = dragPreview?.type === "zoneBoundary" && dragPreview.id === zone.id && dragPreview.edge === "max" ? dragPreview.x : Number(zone.xmax);
                      const start = Math.max(viewXMin, previewMin);
                      const end = Math.min(viewXMax, previewMax);
                      const x = xToPx(start);
                      const width = Math.max(0, xToPx(end) - x);
                      const selected = isSelected("zone", zone.id);
                      return (
                        <g key={`zone-${zone.id}`} opacity={selected ? 1 : 0.94} onClick={(event) => selectItem(event, "zone", zone.id)} onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "zone", id: zone.id, target: "zone-name" })} style={{ cursor: "pointer" }}>
                          <rect x={x} y={M.top} width={width} height={mainHeight} fill={zone.color} opacity={zone.opacity ?? 0.12} />
                          {zone.showLabel !== false && width > 12 && <text x={x + width / 2} y={M.top + 14} textAnchor="middle" fontSize="9" fontWeight="700" fill={zone.color} fontFamily="Arial, Helvetica, sans-serif">{zone.name}</text>}
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
                      const labelledPeaks = [...(pattern.detectedPeaks || [])]
                        .sort((a, b) => b.prominence - a.prominence)
                        .slice(0, S.peakMaxLabels)
                        .sort((a, b) => a.displayX - b.displayX);
                      return (
                        <g key={pattern.id} opacity={selectedByType.pattern.size && !isSelected("pattern", pattern.id) ? 0.72 : 1}>
                          <g clipPath="url(#plot-clip)">
                            {S.layoutMode === "difference" && <line x1={M.left} x2={M.left + plotWidth} y1={baselineY} y2={baselineY} stroke={color} strokeWidth="0.55" strokeDasharray="3 3" opacity="0.35" />}
                            {S.showFill && !breakActive && <path d={fillPath} fill={color} opacity={S.fillAlpha * (pattern.curveOpacity ?? 1)} />}
                            <path d={path} fill="none" stroke={color} strokeWidth={S.lineWidth} opacity={pattern.curveOpacity ?? 1} vectorEffect="non-scaling-stroke" />
                            {S.showDetectedPeaks && (pattern.detectedPeaks || []).map((peak, peakIndex) => (
                              <circle key={`peak-marker-${pattern.id}-${peakIndex}`} cx={xToPx(peak.displayX)} cy={yToPx(peak.displayY + offset)} r={S.peakMarkerSize} fill={S.pageBackground} stroke={color} strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
                            ))}
                            {S.showDetectedPeaks && labelledPeaks.map((peak, peakIndex) => {
                              const x = xToPx(peak.displayX);
                              const y = yToPx(peak.displayY + offset) - 7 - (peakIndex % 2) * 7;
                              return <text key={`peak-label-${pattern.id}-${peakIndex}`} x={x} y={y} textAnchor="start" fontSize={S.peakLabelSize} fill={color} fontFamily="Arial, Helvetica, sans-serif" transform={`rotate(-90 ${x} ${y})`}>{peak.x.toFixed(S.mode === "drx" ? 2 : 0)}</text>;
                            })}
                          </g>
                          {(() => {
                            const moving = dragPreview?.type === "patternLabel" && dragPreview.id === pattern.id ? dragPreview : null;
                            const resizing = dragPreview?.type === "patternLabelResize" && dragPreview.id === pattern.id ? dragPreview : null;
                            const dx = moving ? moving.dx : Number(pattern.labelDx) || 0;
                            const dy = moving ? moving.dy : Number(pattern.labelDy) || 0;
                            const fontSize = resizing ? resizing.fontSize : Number(pattern.labelFontSize) || S.patternLabelSize;
                            const text = `${pattern.label}${pattern.isDifferenceReference ? " (réf.)" : ""}`;
                            const labelX = xToPx(viewXMax) + 10 + dx;
                            const labelYpx = dragPreview?.type === "curveOrder" && dragPreview.id === pattern.id ? dragPreview.svgY : yToPx(labelY) + dy;
                            const estimatedWidth = Math.max(30, text.length * fontSize * 0.57);
                            const selected = isSelected("pattern", pattern.id);
                            return <g>
                              <text data-ui-only="true" x={labelX - 12} y={labelYpx} dominantBaseline="middle" fontSize={Math.max(8, fontSize * 0.75)} fill={color} opacity="0.65" style={{ cursor: pattern.locked ? "not-allowed" : "ns-resize", userSelect: "none" }} onPointerDown={(event) => { if (!pattern.locked) beginCanvasDrag(event, "curveOrder", { id: pattern.id }); }}>↕</text>
                              <text
                                x={labelX} y={labelYpx} dominantBaseline="middle" fontSize={fontSize}
                                fontWeight={S.patternLabelBold ? "700" : "400"} fill={color} fontFamily="Arial, Helvetica, sans-serif"
                                style={{ cursor: pattern.locked ? "not-allowed" : "move", userSelect: "none" }}
                                onClick={(event) => selectItem(event, "pattern", pattern.id)}
                                onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "pattern", id: pattern.id, target: "pattern-name" })}
                                onPointerDown={(event) => { if (event.detail >= 2) { openContextOptions(event, { tab: "inspector", type: "pattern", id: pattern.id, target: "pattern-name" }); return; } if (!pattern.locked) beginCanvasDrag(event, "patternLabel", { id: pattern.id, dx, dy, fontSize }); }}
                              >{text}</text>
                              {selected && !pattern.locked && <g data-ui-only="true">
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
                      />
                    )}

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
                      const ix = (value) => inner.left + ((axisCoordinate(value) - insetAxisMin) / Math.max(1e-12, insetAxisMax - insetAxisMin)) * (inner.right - inner.left);
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
                        <text x={left + 7} y={top + 13} fontSize="8" fontWeight="700" fill="#20252b" pointerEvents="none">{truncateLabel(insetPattern.label, 28)}</text>
                        <text x={(inner.left + inner.right) / 2} y={top + height - 7} textAnchor="middle" fontSize="7" fill="#343a40">{insetAxisMin.toFixed(drxAxisMode === "2theta" ? 1 : 2)}–{insetAxisMax.toFixed(drxAxisMode === "2theta" ? 1 : 2)} {primaryAxisUnit}</text>
                        {collision && <text data-ui-only="true" x={left + width - 7} y={top + 13} textAnchor="end" fontSize="8" fontWeight="700" fill="#e05a47">collision</text>}
                        <rect data-ui-only="true" x={left + width - 10} y={top + height - 10} width="10" height="10" rx="2" fill={color} stroke="#fff" strokeWidth="1" style={{ cursor: "nwse-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "insetResize", { xFrac, yFrac, widthPct, heightPct })} />
                      </g>;
                    })()}

                    {S.figureLayoutMode === "single" && hasAnnotations && annotationData.ticks.map((tick, index) => {
                      const height = (tick.intensity / 100) * S.tickScale;
                      return <line key={`annotation-tick-${index}`} x1={xToPx(tick.x)} x2={xToPx(tick.x)} y1={yToPx(annotationBase)} y2={yToPx(annotationBase + height)} stroke={tick.color} strokeWidth="0.85" opacity="0.88" />;
                    })}
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
                        fontSize={S.annotFontSize}
                        fontWeight="700"
                        fill={tick.color}
                        fontFamily="Arial, Helvetica, sans-serif"
                        transform={`rotate(-90 ${x} ${y})`}
                        style={{ cursor: "move", userSelect: "none" }}
                        onClick={(event) => selectItem(event, "phase", tick.phaseId)}
                        onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "phase", id: tick.phaseId, target: "phase-name" })}
                        onPointerDown={(event) => { if (event.detail >= 2) { openContextOptions(event, { tab: "inspector", type: "phase", id: tick.phaseId, target: "phase-name" }); return; } beginCanvasDrag(event, "phaseLabel", { id: tick.phaseId, xOffset: tick.labelOffsetX, yOffset: tick.labelOffsetY }); }}
                      >{tick.abbreviation}</text>;
                    })}
                    {S.figureLayoutMode === "single" && hasAnnotations && S.showAbbrevKey && phases.filter((phase) => phase.visible && phase.inAnnot).map((phase, index) => (
                      <text key={`key-${phase.id}`} x={xToPx(viewXMax) + 10} y={yToPx(annotationBase + S.tickScale * 0.84) + index * 14} fontSize="9" fontStyle="italic" fill={phase.color} fontFamily="Arial, Helvetica, sans-serif" style={{ cursor: "pointer" }} onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "phase", id: phase.id, target: "phase-name" })}>{phase.abbrev} = {phase.name}</text>
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
                      const estimatedWidth = Math.max(24, safe.text.length * fontSize * 0.58);
                      const boxLeft = x - estimatedWidth / 2 - 4;
                      const boxTop = y - fontSize - 4;
                      return (
                        <g key={safe.id} opacity={selected ? 1 : 0.92}>
                          {safe.vline && <line x1={x} x2={x} y1={M.top} y2={M.top + mainHeight} stroke={safe.color} strokeWidth="0.75" strokeDasharray="4 3" opacity="0.75" />}
                          <text
                            x={x} y={y} textAnchor="middle" fontSize={fontSize} fill={safe.color} fontFamily="Arial, Helvetica, sans-serif"
                            transform={safe.rotation ? `rotate(${safe.rotation} ${x} ${y})` : undefined}
                            style={{ cursor: "pointer", userSelect: "none" }}
                            onClick={(event) => { event.stopPropagation(); selectItem(event, "note", safe.id); }}
                            onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "note", id: safe.id, target: "note-text" })}
                          >{safe.text}</text>
                          {selected && <g data-ui-only="true">
                            <rect x={boxLeft} y={boxTop} width={estimatedWidth + 8} height={fontSize + 10} fill="none" stroke={safe.color} strokeWidth="0.8" strokeDasharray="3 2" opacity="0.78" pointerEvents="none" />
                            <g style={{ cursor: "move" }} onPointerDown={(event) => beginCanvasDrag(event, "note", { id: safe.id, x: safe.x, yFrac: safe.yFrac, fontSize })}>
                              <rect x={boxLeft - 11} y={boxTop - 1} width="10" height="10" rx="2" fill={safe.color} stroke="#fff" strokeWidth="1" />
                              <path d={`M${boxLeft - 8.5} ${boxTop + 4}h5M${boxLeft - 6} ${boxTop + 1.5}v5`} stroke="#fff" strokeWidth="1" pointerEvents="none" />
                            </g>
                            <rect x={x + estimatedWidth / 2 + 1} y={y - 5} width="8" height="8" rx="2" fill={safe.color} stroke="#fff" strokeWidth="1" style={{ cursor: "nwse-resize" }} onPointerDown={(event) => beginCanvasDrag(event, "noteResize", { id: safe.id, fontSize })} />
                          </g>}
                        </g>
                      );
                    })}

                    {S.figureLayoutMode === "single" && <><line x1={M.left} x2={M.left} y1={M.top} y2={M.top + mainHeight} stroke="#15191f" strokeWidth="1" /><text x="21" y={M.top + mainHeight / 2} fontSize={S.axisFontSize} fill="#15191f" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" transform={`rotate(-90 21 ${M.top + mainHeight / 2})`} style={{ cursor: "pointer" }} onDoubleClick={(event) => openContextOptions(event, { tab: "appearance", target: "axis-y-label" })}>{S.ylabel}</text></>}

                    {panelHeight > 0 && (
                      <g>
                        {panelPhases.map((phase, rowIndex) => {
                          const rowTop = panelTop + rowIndex * rowHeight;
                          const subtitle = truncateLabel(phaseSubtitle(phase), S.phaseSubtitleMaxLength);
                          const showSubtitle = S.showRowSubtitles && phase.showSubtitle !== false && subtitle;
                          return (
                            <g key={phase.id} onDoubleClick={(event) => openContextOptions(event, { tab: "inspector", type: "phase", id: phase.id, target: "phase-name" })} style={{ cursor: "pointer" }}>
                              {phase.peaks.map(([x, intensity], index) => x >= viewXMin && x <= viewXMax && (!breakActive || x <= Number(S.brokenAxisStart) || x >= Number(S.brokenAxisEnd)) ? (
                                <line key={index} x1={xToPx(x)} x2={xToPx(x)} y1={rowTop + rowHeight - 4} y2={rowTop + rowHeight - 4 - (intensity / 100) * rowHeight * 0.78} stroke={phase.color} strokeWidth={S.pdfStickW} opacity="0.9" />
                              ) : null)}
                              {S.showRowLabels && <>
                                <text x={M.left + 8} y={rowTop + rowHeight * 0.3} fontSize="10.5" fontWeight="700" fill={phase.color} fontFamily="Arial, Helvetica, sans-serif">{phase.name}</text>
                                {showSubtitle && <text x={M.left + 8} y={rowTop + rowHeight * 0.3 + 12} fontSize="7.5" fontStyle="italic" fill={phase.color} fontFamily="Arial, Helvetica, sans-serif">{subtitle}</text>}
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
                            <text x={boxX + boxWidth / 2} y={boxY + 14} textAnchor="middle" fontSize={fontSize + 1} fontWeight="700" fill="#343a40" pointerEvents="none">Références de phase</text>
                            {panelPhases.map((phase, index) => {
                              const subtitle = truncateLabel(phaseSubtitle(phase), S.phaseSubtitleMaxLength);
                              const suffix = S.showRowSubtitles && phase.showSubtitle !== false && subtitle ? ` — ${subtitle}` : "";
                              const y = boxY + 26 + index * lineHeight;
                              return <g key={phase.id}><line x1={boxX + 9} x2={boxX + 27} y1={y - 3} y2={y - 3} stroke={phase.color} strokeWidth="2"/><text x={boxX + 34} y={y} fontSize={fontSize} fill="#20252b">{truncateLabel(`${phase.name}${suffix}`, Math.max(12, Math.round((boxWidth - 42) / (fontSize * 0.55))))}</text></g>;
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
                        {xTickObjects.map((tick) => <g key={tick.x}><line x1={xToPx(tick.x)} x2={xToPx(tick.x)} y1={axisY} y2={axisY + 5} stroke="#15191f" strokeWidth="1"/><text x={xToPx(tick.x)} y={axisY + 20} textAnchor="middle" fontSize={S.tickFontSize} fill="#15191f" fontFamily="Arial, Helvetica, sans-serif">{tick.label}</text></g>)}
                        <text x={M.left + plotWidth / 2} y={axisY + 42} textAnchor="middle" fontSize={S.axisFontSize} fill="#15191f" fontFamily="Arial, Helvetica, sans-serif">{activeMode === "drx" && drxAxisMode === "d" ? "d-spacing (Å)" : activeMode === "drx" && drxAxisMode === "q" ? "Q (Å⁻¹)" : S.xlabel}</text>
                        {activeMode === "drx" && S.showSecondaryXAxis && <g>
                          <line x1={M.left} x2={M.left + plotWidth} y1={M.top} y2={M.top} stroke="#15191f" strokeWidth="0.8" />
                          {xTickObjects.map((tick) => { const value = convertDrxX(tick.x, S.secondaryXAxisMode || "d", Number(S.wavelength) || 1.5406); return <g key={`secondary-${tick.x}`}><line x1={xToPx(tick.x)} x2={xToPx(tick.x)} y1={M.top} y2={M.top - 4} stroke="#15191f" strokeWidth="0.8"/><text x={xToPx(tick.x)} y={M.top - 7} textAnchor="middle" fontSize={Math.max(6, S.tickFontSize - 2)} fill="#15191f">{Number.isFinite(value) ? value.toFixed(2) : ""}</text></g>; })}
                          <text x={M.left + plotWidth / 2} y={Math.max(9, M.top - 22)} textAnchor="middle" fontSize={Math.max(7, S.axisFontSize - 2)} fill="#15191f">{S.secondaryXAxisMode === "q" ? "Q (Å⁻¹)" : S.secondaryXAxisMode === "2theta" ? "2θ (°)" : "d-spacing (Å)"}</text>
                        </g>}
                        {activeMode === "drx" && S.showSecondaryYAxis && <g>
                          <line x1={M.left + plotWidth} x2={M.left + plotWidth} y1={M.top} y2={M.top + mainHeight} stroke="#15191f" strokeWidth="0.8" />
                          {[0, 25, 50, 75, 100].map((value) => { const yy = M.top + mainHeight - (value / 100) * mainHeight; return <g key={`secondary-y-${value}`}><line x1={M.left + plotWidth} x2={M.left + plotWidth + 4} y1={yy} y2={yy} stroke="#15191f" strokeWidth="0.8"/><text x={M.left + plotWidth + 7} y={yy + 3} fontSize={Math.max(6, S.tickFontSize - 2)} fill="#15191f">{value}</text></g>; })}
                          <text x={M.left + plotWidth + 38} y={M.top + mainHeight / 2} textAnchor="middle" fontSize={Math.max(7, S.axisFontSize - 2)} fill="#15191f" transform={`rotate(90 ${M.left + plotWidth + 38} ${M.top + mainHeight / 2})`}>Relative intensity (%)</text>
                        </g>}
                        {breakActive && <g>
                          <path d={`M${xToPx(Number(S.brokenAxisStart)) + 2} ${axisY - 4}l5 8M${xToPx(Number(S.brokenAxisStart)) + 8} ${axisY - 4}l5 8`} stroke="#15191f" strokeWidth="1" fill="none" />
                          <path d={`M${xToPx(Number(S.brokenAxisStart)) + 2} ${M.top - 4}l5 8M${xToPx(Number(S.brokenAxisStart)) + 8} ${M.top - 4}l5 8`} stroke="#15191f" strokeWidth="1" fill="none" />
                        </g>}
                      </g>;
                    })()}
                    {dragPreview?.type === "curveOrder" && <line data-ui-only="true" x1={M.left} x2={M.left + plotWidth + S.rightMargin - 8} y1={dragPreview.svgY} y2={dragPreview.svgY} stroke="#dc7848" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.8" />}
                    {cursor && <g data-ui-only="true" pointerEvents="none"><line x1={cursor.svgX} x2={cursor.svgX} y1={M.top} y2={M.top + mainHeight} stroke={cursor.snapped ? "#dc7848" : "#67707c"} strokeWidth="0.7" strokeDasharray="3 3" opacity="0.75"/></g>}
                  </svg>
                </div>
              </div>
            )}
          </div>

          <footer className="statusbar">
            <span title={project.name}><strong>{truncateLabel(project.name, 24)}</strong></span><span><strong>{activeMode === "drx" ? "DRX" : "Raman"}</strong></span><span><strong>{patterns.length}</strong> patrons</span>
            <span><strong>{phases.length}</strong> phases</span>
            <span><strong>{visibleCount}</strong> visibles</span>
            {selectionCount > 0 && <span className="statusbar__selection"><strong>{selectionCount}</strong> sélectionné(s)</span>}
            <span><strong>{processed.reduce((sum, pattern) => sum + (pattern.detectedPeaks?.length || 0), 0)}</strong> pics détectés</span>
            <span>{LAYOUT_OPTIONS.find(([value]) => value === S.layoutMode)?.[1]}</span>
            <span className="statusbar__spacer" />
            {cursor ? <><span>x = <strong>{cursor.dataX.toFixed(S.mode === "drx" ? 3 : 1)}</strong></span>{cursor.nearest && <span>{activePattern?.label}: <strong>{cursor.nearest.y.toFixed(4)}</strong></span>}</> : <span>Déplacer le curseur sur la figure pour lire les coordonnées.</span>}
          </footer>
        </section>

        <aside className={`side-panel side-panel--right ${rightCollapsed ? "is-collapsed" : ""}`} aria-hidden={rightCollapsed}>
          {!rightCollapsed && <Resizer side="right" onReset={() => setRightWidth(350)} onResize={{ currentWidth: () => rightWidth, apply: (value) => setRightWidth(clamp(value, 280, 560)) }} />}
          <div className="panel-titlebar"><div><strong>Atelier</strong><span>{selectionCount ? `${selectionCount} sélectionné(s)` : "Aucune sélection"}</span></div><IconButton icon="panelRight" title="Replier le panneau de propriétés" onClick={() => setRightCollapsed(true)} /></div>
          <nav className="panel-tabs panel-tabs--right">
            {[ ["inspector", "Inspecteur", "cursor"], ["processing", "Traitement", "waveform"], ["references", "Références", "phase"], ["appearance", "Apparence", "sparkles"], ["export", "Export", "download"] ].map(([value, label, icon]) => <button type="button" key={value} className={rightTab === value ? "is-active" : ""} onClick={() => setRightTab(value)}><Icon name={icon} size={12} />{label}{value === "inspector" && selectionCount > 0 && <span>{selectionCount}</span>}</button>)}
          </nav>
          <div className="side-panel__content properties-scroll">
            {rightTab === "appearance" && (
              <>
                <Section title="Interface" defaultOpen={false}>
                  <SelectField label="Densité des contrôles" value={uiDensity} onChange={setUiDensity} options={[["compact", "Compacte"], ["standard", "Standard"], ["comfortable", "Confortable"]]} />
                  <Toggle label="Afficher le panneau de données" checked={!leftCollapsed} onChange={(value) => setLeftCollapsed(!value)} />
                  <Toggle label="Afficher le panneau de propriétés" checked={!rightCollapsed} onChange={(value) => setRightCollapsed(!value)} />
                  <Toggle label="Réduire les animations" checked={reduceMotion} onChange={setReduceMotion} description="Désactive les transitions décoratives et respecte le confort visuel." />
                  <div className="motion-preview"><span /><span /><span /><small>{reduceMotion ? "Mouvement réduit" : "Animations actives"}</small></div>
                  <div className="inline-actions"><Button variant="secondary" icon="layout" onClick={resetLayout}>Réinitialiser la disposition</Button></div>
                </Section>
                <Section title="Interaction avec la figure">
                  <Toggle label="Accrochage aux pics" checked={snapToPeak} onChange={setSnapToPeak} description="Les curseurs et la lecture du pointeur s’alignent sur un pic proche." />
                  <Toggle label="Navigateur de plage" checked={showNavigator} onChange={setShowNavigator} />
                  <Toggle label="Comparaison brut / traité" checked={comparisonView} onChange={setComparisonView} />
                  <Toggle label="Édition plein écran" checked={editorFullscreen} onChange={setEditorFullscreen} />
                </Section>
                <Section title="Texte et axes" targetId="axes-options">
                  <TextField targetId="figure-title" label="Titre" value={S.title} onChange={(value) => patchSettings("title", value)} placeholder="Titre facultatif" />
                  <TextField targetId="axis-x-label" label="Axe X" value={S.xlabel} onChange={(value) => patchSettings("xlabel", value)} />
                  <TextField targetId="axis-y-label" label="Axe Y" value={S.ylabel} onChange={(value) => patchSettings("ylabel", value)} />
                  <div className="two-columns"><NumberField label={`X minimum (${primaryAxisUnit})`} value={primaryAxisWindow.minimum} step={primaryAxisStep} onChange={(value) => commitPrimaryAxisBound("minimum", value)} /><NumberField label={`X maximum (${primaryAxisUnit})`} value={primaryAxisWindow.maximum} step={primaryAxisStep} onChange={(value) => commitPrimaryAxisBound("maximum", value)} /></div>
                  <NumberField label={`Pas des graduations (${primaryAxisUnit})`} value={S.xTickStep} min={0} step={primaryAxisStep} onChange={(value) => patchSettings("xTickStep", value)} hint="0 = automatique" />
                  <Toggle label="Grille verticale" checked={S.showGrid} onChange={(value) => patchSettings("showGrid", value)} />
                  {S.showGrid && <SliderField label="Opacité de la grille" value={S.gridOpacity} min={0.1} max={1} step={0.05} onChange={(value) => patchSettings("gridOpacity", value)} />}
                </Section>
                <Section title="Disposition">
                  <SelectField label="Mode de représentation" value={S.layoutMode} onChange={(value) => patchSettings("layoutMode", value)} options={LAYOUT_OPTIONS} />
                  {S.layoutMode === "difference" && <SelectField label="Patron de référence" value={S.differenceReferenceId} onChange={(value) => patchSettings("differenceReferenceId", value)} options={[["", "Premier patron visible"], ...patterns.filter((pattern) => pattern.visible).map((pattern) => [pattern.id, pattern.label])]} />}
                  {S.layoutMode === "waterfall" && <SliderField label="Décalage horizontal par patron" value={S.waterfallXShiftPct} min={-8} max={8} step={0.1} suffix="%" onChange={(value) => patchSettings("waterfallXShiftPct", value)} />}
                  {S.layoutMode !== "overlay" && <SliderField label="Décalage vertical" value={S.vstep} min={0.1} max={4} step={0.05} onChange={(value) => patchSettings("vstep", value)} />}
                  <SliderField label="Échelle verticale" value={S.pxPerUnit} min={30} max={220} step={5} suffix="px" onChange={(value) => patchSettings("pxPerUnit", value)} />
                  {S.layoutMode !== "overlay" && <Toggle label="Inverser l’ordre" checked={S.reverseStack} onChange={(value) => patchSettings("reverseStack", value)} />}
                </Section>
                <Section title="Typographie" defaultOpen={false}>
                  <SliderField label="Titre" value={S.titleFontSize} min={10} max={36} step={0.5} suffix="pt" onChange={(value) => patchSettings("titleFontSize", value)} />
                  <SliderField label="Axes" value={S.axisFontSize} min={8} max={28} step={0.5} suffix="pt" onChange={(value) => patchSettings("axisFontSize", value)} />
                  <SliderField label="Graduations" value={S.tickFontSize} min={6} max={24} step={0.5} suffix="pt" onChange={(value) => patchSettings("tickFontSize", value)} />
                  <SliderField label="Labels de patrons" value={S.patternLabelSize} min={7} max={26} step={0.5} suffix="pt" onChange={(value) => patchSettings("patternLabelSize", value)} />
                  <Toggle label="Labels en gras" checked={S.patternLabelBold} onChange={(value) => patchSettings("patternLabelBold", value)} />
                </Section>

                <Section title="Courbes">
                  <SliderField label="Épaisseur" value={S.lineWidth} min={0.3} max={4} step={0.05} onChange={(value) => patchSettings("lineWidth", value)} />
                  <Toggle label="Remplissage sous les courbes" checked={S.showFill} onChange={(value) => patchSettings("showFill", value)} />
                  {S.showFill && <SliderField label="Opacité" value={S.fillAlpha} min={0} max={0.5} step={0.01} onChange={(value) => patchSettings("fillAlpha", value)} />}
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

                <Section title="Dimensions et gabarits">
                  <SelectField label="Gabarit de revue" value="" onChange={applyJournalPreset} options={[["", "Choisir…"], ...Object.entries(JOURNAL_PRESETS).map(([key, preset]) => [key, preset.label])]} />
                  <SelectField label="Preset général" value="" onChange={applyPreset} options={[["", "Choisir…"], ...Object.entries(PRESETS).map(([key, preset]) => [key, preset.label])]} />
                  <SliderField label="Largeur de figure" value={S.figWidth} min={500} max={3000} step={25} suffix="px" onChange={(value) => patchSettings("figWidth", value)} />
                  <SliderField label="Marge droite" value={S.rightMargin} min={50} max={400} step={5} suffix="px" onChange={(value) => patchSettings("rightMargin", value)} />
                </Section>

                <Section title="Composition multi-panneaux" defaultOpen={false}>
                  <SelectField label="Structure de la figure" value={S.figureLayoutMode || "single"} onChange={(value) => patchSettings("figureLayoutMode", value)} options={FIGURE_LAYOUT_OPTIONS} />
                  {S.figureLayoutMode === "grid" && <SliderField label="Colonnes" value={S.gridColumns} min={1} max={4} step={1} onChange={(value) => patchSettings("gridColumns", Math.round(value))} />}
                  {S.figureLayoutMode !== "single" && <><SliderField label="Espace entre panneaux" value={S.panelGap} min={4} max={60} step={2} suffix="px" onChange={(value) => patchSettings("panelGap", value)} /><Toggle label="Lettrage automatique (a), (b)…" checked={S.panelLettering} onChange={(value) => patchSettings("panelLettering", value)} /><Toggle label="Légende partagée" checked={S.sharedPatternLegend} onChange={(value) => patchSettings("sharedPatternLegend", value)} /></>}
                  {["sideBySide", "beforeAfter", "differenceRatio"].includes(S.figureLayoutMode) && <SelectField label="Patron A" value={S.comparisonPatternAId || ""} onChange={(value) => patchSettings("comparisonPatternAId", value)} options={[["", "Sélection / premier visible"], ...patterns.filter((pattern) => pattern.visible).map((pattern) => [pattern.id, pattern.label])]} />}
                  {["sideBySide", "differenceRatio"].includes(S.figureLayoutMode) && <SelectField label="Patron B" value={S.comparisonPatternBId || ""} onChange={(value) => patchSettings("comparisonPatternBId", value)} options={[["", "Deuxième patron visible"], ...patterns.filter((pattern) => pattern.visible).map((pattern) => [pattern.id, pattern.label])]} />}
                  <div className="callout">Les modes multi-panneaux utilisent un rendu volontairement simplifié : annotations de phases, notes et panneau de références sont réservés à la figure unique afin d’éviter une composition illisible.</div>
                </Section>

                {activeMode === "drx" && <Section title="Axes DRX avancés" defaultOpen={false} targetId="inset-options">
                  <SelectField label="Axe X principal" value={S.xAxisMode || "2theta"} onChange={(value) => patchSettingsValues({ xAxisMode: value, xTickStep: 0 })} options={[["2theta", "2θ"], ["d", "d-spacing"], ["q", "Q"]]} />
                  <Toggle label="Axe X secondaire en haut" checked={S.showSecondaryXAxis} onChange={(value) => patchSettings("showSecondaryXAxis", value)} />
                  {S.showSecondaryXAxis && <SelectField label="Unité secondaire" value={S.secondaryXAxisMode} onChange={(value) => patchSettings("secondaryXAxisMode", value)} options={[["d", "d-spacing (Å)"], ["q", "Q (Å⁻¹)"], ["2theta", "2θ (°)"]]} />}
                  <Toggle label="Axe Y secondaire" checked={S.showSecondaryYAxis} onChange={(value) => patchSettings("showSecondaryYAxis", value)} />
                  <Toggle label="Axe X brisé" checked={S.brokenAxisEnabled} onChange={(value) => patchSettings("brokenAxisEnabled", value)} description="Disponible lorsque l’axe principal est 2θ." />
                  {S.brokenAxisEnabled && <><div className="two-columns"><NumberField label="Début de coupure" value={S.brokenAxisStart} step={0.5} suffix="°" onChange={(value) => patchSettings("brokenAxisStart", value)} /><NumberField label="Fin de coupure" value={S.brokenAxisEnd} step={0.5} suffix="°" onChange={(value) => patchSettings("brokenAxisEnd", value)} /></div><SliderField label="Largeur visuelle de coupure" value={S.brokenAxisGapPx} min={8} max={50} step={1} suffix="px" onChange={(value) => patchSettings("brokenAxisGapPx", value)} /></>}
                  <Toggle label="Encart de zoom" checked={S.showInset} onChange={(value) => patchSettings("showInset", value)} />
                  {S.showInset && <><SelectField label="Patron de l’encart" value={S.insetPatternId || ""} onChange={(value) => patchSettings("insetPatternId", value)} options={[["", "Patron sélectionné"], ...patterns.filter((pattern) => pattern.visible).map((pattern) => [pattern.id, pattern.label])]} /><div className="two-columns"><NumberField label={`X min encart (${primaryAxisUnit})`} value={insetAxisWindow.minimum} step={primaryAxisStep} onChange={(value) => commitInsetAxisBound("minimum", value)} /><NumberField label={`X max encart (${primaryAxisUnit})`} value={insetAxisWindow.maximum} step={primaryAxisStep} onChange={(value) => commitInsetAxisBound("maximum", value)} /></div><SelectField label="Placement" value={S.insetPlacementMode || "overlay"} onChange={(value) => patchSettings("insetPlacementMode", value)} options={[["overlay", "Superposition libre"], ["dock-right", "Zone réservée à droite"], ["dock-top", "Zone réservée en haut"]]} /><SliderField label="Largeur de l’encart" value={S.insetWidthPct} min={15} max={70} step={1} suffix="%" onChange={(value) => patchSettings("insetWidthPct", value)} /><SliderField label="Hauteur de l’encart" value={S.insetHeightPct} min={15} max={70} step={1} suffix="%" onChange={(value) => patchSettings("insetHeightPct", value)} /><Toggle label="Rectangle de la zone agrandie" checked={S.insetShowSourceRect !== false} onChange={(value) => patchSettings("insetShowSourceRect", value)} />{S.insetShowSourceRect !== false && <Toggle label="Traits de liaison" checked={S.insetShowConnectors !== false} onChange={(value) => patchSettings("insetShowConnectors", value)} />}<div className="callout">En superposition, déplacer l’encart par sa barre supérieure et le redimensionner avec la poignée. Un contour rouge signale une collision probable avec les annotations. Les docks agrandissent la figure sans masquer les données.</div><div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => history.set((current) => updateWorkspaceProject(current, activeMode, (workspace) => ({ ...workspace, settings: { ...workspace.settings, insetXFrac: 0.63, insetYFrac: 0.06, insetWidthPct: 34, insetHeightPct: 34 } })))}>Réinitialiser l’encart</Button></div></>}
                </Section>}

                <Section title="Styles réutilisables" defaultOpen={false}>
                  <TextField label="Nom du style" value={templateName} onChange={setTemplateName} placeholder="Ex. Water Research · DRX" />
                  <div className="inline-actions"><Button variant="secondary" icon="save" onClick={saveStyleTemplate}>Enregistrer le style courant</Button></div>
                  {styleTemplates.length ? <div className="library-list">{styleTemplates.map((entry) => <div key={entry.id} className="library-row"><span><strong>{entry.name}</strong><small>{new Date(entry.savedAt).toLocaleDateString("fr-FR")}</small></span><Button variant="secondary" onClick={() => applyStyleTemplate(entry)}>Appliquer</Button><IconButton icon="trash" danger title="Supprimer" onClick={() => setStyleTemplates((current) => current.filter((item) => item.id !== entry.id))} /></div>)}</div> : <div className="callout">Aucun style local enregistré.</div>}
                </Section>
              </>
            )}

            {rightTab === "processing" && (
              <>
                <Section title="Prétraitement">
                  <SliderField label="Lissage — moyenne mobile" value={S.smoothW} min={1} max={41} step={1} onChange={(value) => patchSettings("smoothW", value)} />
                  <SliderField label="Écrêtage percentile" value={S.clipPct} min={90} max={100} step={0.1} suffix="%" onChange={(value) => patchSettings("clipPct", value)} />
                  <SelectField label="Normalisation" value={S.normalizeMode} onChange={(value) => patchSettings("normalizeMode", value)} options={NORMALIZATION_OPTIONS} />
                  {S.normalizeMode === "referencePeak" && <div className="two-columns"><NumberField label="Position du pic" value={S.normalizeReferenceX} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => patchSettings("normalizeReferenceX", value)} /><NumberField label="Demi-fenêtre" value={S.normalizeReferenceWindow} min={0.01} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => patchSettings("normalizeReferenceWindow", value)} /></div>}
                  {S.normalizeMode === "none" && <div className="callout">Les amplitudes relatives sont conservées ; une échelle globale commune est utilisée uniquement pour l’affichage.</div>}
                </Section>

                <Section title="Correction de ligne de base">
                  <SelectField label="Méthode" value={S.baselineMode} onChange={(value) => patchSettings("baselineMode", value)} options={BASELINE_OPTIONS} />
                  {S.baselineMode === "rolling" && <SliderField label="Fenêtre" value={S.baselineWindow} min={5} max={501} step={2} suffix="pts" onChange={(value) => patchSettings("baselineWindow", Math.round(value) | 1)} />}
                  {S.baselineMode === "snip" && <SliderField label="Itérations SNIP" value={S.snipIterations} min={4} max={120} step={1} onChange={(value) => patchSettings("snipIterations", Math.round(value))} />}
                  {S.baselineMode === "polynomial" && <SliderField label="Ordre du polynôme" value={S.baselinePolyOrder} min={1} max={6} step={1} onChange={(value) => patchSettings("baselinePolyOrder", Math.round(value))} />}
                  {S.baselineMode === "als" && <SliderField label="Rigidité log₁₀(λ)" value={S.baselineLambdaLog} min={1} max={9} step={0.25} onChange={(value) => patchSettings("baselineLambdaLog", value)} />}
                  {["polynomial", "als"].includes(S.baselineMode) && <><SliderField label="Asymétrie p" value={S.baselineAsymmetry} min={0.001} max={0.2} step={0.001} onChange={(value) => patchSettings("baselineAsymmetry", value)} /><SliderField label="Itérations" value={S.baselineIterations} min={1} max={20} step={1} onChange={(value) => patchSettings("baselineIterations", Math.round(value))} /></>}
                  {S.baselineMode !== "none" && <Toggle label="Ramener les valeurs négatives à zéro" checked={S.baselineClamp} onChange={(value) => patchSettings("baselineClamp", value)} />}
                  {S.baselineMode === "als" && <div className="callout">ALS est plus coûteux que les autres méthodes. Une rigidité élevée produit une ligne de base plus lisse.</div>}
                </Section>

                <Section title="Repérage des pics expérimentaux" defaultOpen={false}>
                  <div className="callout">Détecte les maxima du patron sélectionné pour les exporter, les suivre dans une série ou lancer un ajustement. Ce module ne réalise pas une identification de phase.</div>
                  <Toggle label="Afficher les marqueurs sur la figure" checked={S.showDetectedPeaks} onChange={(value) => patchSettings("showDetectedPeaks", value)} />
                  <SliderField label="Hauteur minimale" value={S.peakMinHeight} min={0} max={100} step={1} suffix="%" onChange={(value) => patchSettings("peakMinHeight", value)} />
                  <SliderField label="Proéminence minimale" value={S.peakMinProminence} min={0} max={100} step={0.5} suffix="%" onChange={(value) => patchSettings("peakMinProminence", value)} />
                  <NumberField label="Distance minimale X" value={S.peakMinDistance} min={0} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => patchSettings("peakMinDistance", value)} />
                  <SliderField label="Fenêtre de proéminence" value={S.peakLookaround} min={2} max={250} step={1} suffix="pts" onChange={(value) => patchSettings("peakLookaround", Math.round(value))} />
                  <SliderField label="Nombre maximal de labels" value={S.peakMaxLabels} min={0} max={100} step={1} onChange={(value) => patchSettings("peakMaxLabels", Math.round(value))} />
                  {activeProcessedPattern ? <div className="peak-results">
                    <div className="peak-results__header"><strong>{truncateLabel(activeProcessedPattern.label, 28)}</strong><span>{activeProcessedPattern.detectedPeaks?.length || 0} maximum(s)</span></div>
                    <div className="peak-results__table"><div className="peak-results__row is-head"><span>Position</span><span>Hauteur</span><span>Prom.</span><span>Actions</span></div>{(activeProcessedPattern.detectedPeaks || []).slice(0, 30).map((peak, index) => <div className="peak-results__row" key={`${peak.x}-${index}`}><span>{Number(peak.x).toFixed(activeMode === "drx" ? 4 : 1)}</span><span>{Number(peak.heightPct).toFixed(1)} %</span><span>{Number(peak.prominencePct).toFixed(1)} %</span><span><button type="button" title="Ajouter au suivi de série" onClick={() => addDetectedPeakToTracking(peak, index)}>Suivre</button>{activeMode === "drx" && <button type="button" title="Ajuster ce pic" onClick={() => fitDetectedPeak(peak)}>Ajuster</button>}</span></div>)}</div>
                  </div> : <div className="callout">Sélectionner un patron visible pour afficher sa table de maxima.</div>}
                  <div className="inline-actions"><Button variant="secondary" icon="csv" onClick={exportDetectedPeaksCsv}>Exporter la table complète</Button></div>
                </Section>

                <Section title="Aligner une série d’acquisitions" defaultOpen={false}>
                  <div className="callout">Cette opération compense de petits décalages entre acquisitions comparables. Elle ne remplace pas la correction instrumentale du zéro DRX, située plus bas.</div>
                  <SelectField label="Acquisition de référence" value={S.alignmentReferenceId} onChange={(value) => { patchSettings("alignmentReferenceId", value); setAlignmentPreview(null); }} options={[["", activePattern ? `Sélection : ${activePattern.label}` : "Premier patron visible"], ...patterns.filter((pattern) => pattern.visible).map((pattern) => [pattern.id, pattern.label])]} />
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
                    <div className="callout">La longueur d’onde est utilisée pour d, Q, Scherrer, la déformation et le calcul des phases CIF.</div>
                    <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={recalculateCifPhases}>Recalculer les phases CIF</Button></div>
                  </Section>

                  <Section title="Corrections instrumentales DRX" defaultOpen={false}>
                    <Toggle label="Suppression Kα₂ — Rachinger" checked={S.ka2Strip} onChange={(value) => patchSettings("ka2Strip", value)} />
                    {S.ka2Strip && <><NumberField label="λ Kα₂" value={S.ka2Wavelength} min={0.1} max={5} step={0.00001} suffix="Å" onChange={(value) => patchSettings("ka2Wavelength", value)} /><SliderField label="Rapport I(Kα₂)/I(Kα₁)" value={S.ka2Ratio} min={0.05} max={0.8} step={0.01} onChange={(value) => patchSettings("ka2Ratio", value)} /></>}
                    <SelectField label="Phase pour le zéro" value={S.zeroShiftReferencePhaseId || ""} onChange={(value) => patchSettings("zeroShiftReferencePhaseId", value)} options={[["", "Première phase visible"], ...phases.filter((phase) => phase.visible).map((phase) => [phase.id, phase.name])]} />
                    <div className="two-columns"><NumberField label="Tolérance" value={S.zeroShiftTolerance} min={0.02} max={2} step={0.02} suffix="°" onChange={(value) => patchSettings("zeroShiftTolerance", value)} /><NumberField label="I min phase" value={S.zeroShiftMinIntensity} min={0} max={100} step={1} suffix="%" onChange={(value) => patchSettings("zeroShiftMinIntensity", value)} /></div>
                    <div className="inline-actions"><Button variant="primary" onClick={applyZeroShift}>Corriger le zéro</Button><Button variant="secondary" icon="reset" onClick={removeZeroShift}>Retirer</Button></div>
                    <div className="callout">La correction utilise la médiane robuste des écarts entre pics expérimentaux et pics de la phase choisie. Elle requiert au moins deux correspondances.</div>
                  </Section>

                  <Section title="Ajustement de pic et microstructure" defaultOpen={false}>
                    <SelectField label="Profil" value={S.peakFitModel} onChange={(value) => patchSettings("peakFitModel", value)} options={[["gaussian", "Gaussien"], ["lorentzian", "Lorentzien"], ["pseudoVoigt", "Pseudo-Voigt"]]} />
                    <div className="two-columns"><NumberField label="Centre attendu" value={S.peakFitCenter} step={0.05} suffix="°" onChange={(value) => patchSettings("peakFitCenter", value)} /><NumberField label="Demi-fenêtre" value={S.peakFitWindow} min={0.05} step={0.05} suffix="°" onChange={(value) => patchSettings("peakFitWindow", value)} /></div>
                    <div className="two-columns"><NumberField label="FWHM instrumentale" value={S.instrumentFwhm} min={0} step={0.005} suffix="°" onChange={(value) => patchSettings("instrumentFwhm", value)} /><NumberField label="Constante de Scherrer K" value={S.scherrerK} min={0.5} max={1.5} step={0.01} onChange={(value) => patchSettings("scherrerK", value)} /></div>
                    <div className="inline-actions"><Button variant="primary" onClick={runPeakFit}>Ajuster le pic sélectionné</Button></div>
                    {peakFitResult && <div className="analysis-result"><strong>{activeProcessedPattern?.label}</strong><span>Centre : {peakFitResult.center.toFixed(4)}°</span><span>FWHM : {peakFitResult.fwhm.toFixed(4)}° · corrigée {peakFitResult.betaCorrectedDegrees.toFixed(4)}°</span><span>Aire : {peakFitResult.area.toExponential(4)} · R² : {peakFitResult.r2.toFixed(5)}</span><span>d : {peakFitResult.dSpacing.toFixed(4)} Å · Q : {peakFitResult.q.toFixed(4)} Å⁻¹</span><span>Taille apparente : {peakFitResult.crystalliteNm ? `${peakFitResult.crystalliteNm.toFixed(1)} nm` : "n.d."}</span><span>Microdéformation apparente : {peakFitResult.strain ? `${(peakFitResult.strain * 1e6).toFixed(0)} µε` : "n.d."}</span></div>}
                    <div className="callout">Scherrer et la microdéformation sur un seul pic sont des estimations apparentes. Une analyse Williamson–Hall multi-pics reste préférable.</div>
                  </Section>

                  <Section title="Suivi de pics à travers une série" defaultOpen={false}>
                    <TextAreaField label="Positions à suivre" value={S.trackingTargets} rows={4} onChange={(value) => patchSettings("trackingTargets", value)} placeholder="HAp 002:25.9; Calcite 104:29.4" hint="Nom:position ; Nom:position" />
                    <div className="two-columns"><NumberField label="Demi-fenêtre" value={S.trackingWindow} min={0.02} step={0.02} suffix="°" onChange={(value) => patchSettings("trackingWindow", value)} /><SelectField label="Signal" value={S.trackingSignal} onChange={(value) => patchSettings("trackingSignal", value)} options={[["corrected", "Corrigé du fond"], ["normalized", "Normalisé"], ["raw", "Brut"]]} /></div>
                    <div className="inline-actions"><Button variant="secondary" icon="phase" onClick={populateTrackingFromPhase}>Utiliser la phase sélectionnée</Button><Button variant="secondary" icon="csv" onClick={exportTrackingCsv}>Exporter positions, hauteurs et aires</Button></div>
                  </Section>
                </>}
              </>
            )}

            {rightTab === "references" && (
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
                  {ramanDatabaseMatches.length ? <div className="library-list">{ramanDatabaseMatches.map((entry) => <div key={`${entry.name}-${entry.formula || entry.metadata?.RRUFFID || entry.metadata?.NAMES || entry.metadata?.CIF_FORMULA || "entry"}`} className="library-row"><span><strong>{entry.name}</strong><small>{entry.formula || entry.metadata?.RRUFFID || entry.sourceKind || "base locale"}</small></span><Button variant="secondary" onClick={() => addLibraryPhase(entry, activeMode)}>Ajouter</Button></div>)}</div> : <div className="callout">Aucune correspondance trouvée. Essayez un nom, une formule, ou des symboles d’éléments.</div>}
                </Section>}
                <Section title="Annotations de phases">
                  <Toggle label="Afficher les annotations" checked={S.showAnnotations} onChange={(value) => patchSettings("showAnnotations", value)} />
                  {S.showAnnotations && <><SliderField label="Seuil des bâtonnets" value={S.tickMinI} min={0} max={50} step={0.5} suffix="%" onChange={(value) => patchSettings("tickMinI", value)} /><SliderField label="Seuil des labels" value={S.labelMinI} min={0} max={100} step={1} suffix="%" onChange={(value) => patchSettings("labelMinI", value)} /><SliderField label="Séparation des labels" value={S.labelMinSep} min={0.1} max={10} step={0.1} onChange={(value) => patchSettings("labelMinSep", value)} /><SliderField label="Hauteur" value={S.tickScale} min={0.1} max={1.5} step={0.02} onChange={(value) => patchSettings("tickScale", value)} /><SliderField label="Écart au patron" value={S.annotGap} min={0.3} max={3} step={0.02} onChange={(value) => patchSettings("annotGap", value)} /><SliderField label="Taille des labels" value={S.annotFontSize} min={5} max={18} step={0.5} onChange={(value) => patchSettings("annotFontSize", value)} /><Toggle label="Clé des abréviations" checked={S.showAbbrevKey} onChange={(value) => patchSettings("showAbbrevKey", value)} /></>}
                </Section>
                <Section title="Panneau de références" targetId="reference-panel-options">
                  <Toggle label="Afficher le panneau" checked={S.showPdfPanel} onChange={(value) => patchSettings("showPdfPanel", value)} />
                  {S.showPdfPanel && <>
                    <SliderField label="Hauteur" value={S.pdfPanelH} min={60} max={500} step={10} suffix="px" onChange={(value) => patchSettings("pdfPanelH", value)} />
                    <SliderField label="Épaisseur des bâtonnets" value={S.pdfStickW} min={0.3} max={4} step={0.05} onChange={(value) => patchSettings("pdfStickW", value)} />
                    <Toggle label="Noms des lignes" checked={S.showRowLabels} onChange={(value) => patchSettings("showRowLabels", value)} />
                    <Toggle label="Sous-titres des lignes" checked={S.showRowSubtitles} onChange={(value) => patchSettings("showRowSubtitles", value)} />
                    {S.showRowSubtitles && <NumberField label="Longueur maximale" value={S.phaseSubtitleMaxLength} min={0} max={120} step={1} suffix="car." onChange={(value) => patchSettings("phaseSubtitleMaxLength", Math.round(value))} />}
                    <Toggle label="Encart de légende" checked={S.showPdfLegend} onChange={(value) => patchSettings("showPdfLegend", value)} />
                    {S.showPdfLegend && <>
                      <SliderField label="Largeur de la légende" value={S.phaseLegendWidth || 210} min={140} max={500} step={5} suffix="px" onChange={(value) => patchSettings("phaseLegendWidth", value)} />
                      <SliderField label="Taille du texte" value={S.phaseLegendFontSize || 8} min={6} max={16} step={0.5} suffix="pt" onChange={(value) => patchSettings("phaseLegendFontSize", value)} />
                      <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={() => history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({ ...currentWorkspace, settings: { ...currentWorkspace.settings, phaseLegendX: null, phaseLegendY: null, phaseLegendWidth: 210, phaseLegendFontSize: 8 } })))}>Réinitialiser la légende</Button></div>
                      <div className="callout">Glisser l’en-tête de l’encart dans la figure pour le déplacer ; utiliser le carré inférieur droit pour le redimensionner.</div>
                    </>}
                  </>}
                </Section>
                {activeMode === "drx" && <Section title="Bibliothèque de phases DRX" defaultOpen={false}>
                  <div className="inline-actions"><Button variant="secondary" icon="save" onClick={saveSelectedPhasesToLibrary}>Enregistrer sélection / visibles</Button><Button variant="secondary" icon="reset" onClick={recalculateCifPhases}>Recalculer CIF</Button></div>
                  {phaseLibrary.length ? <div className="library-list">{phaseLibrary.map((entry) => <div key={entry.libraryKey || entry.name} className="library-row"><span><strong>{entry.name}</strong><small>{entry.metadata?.CIF_FORMULA || entry.metadata?.RRUFFID || entry.sourceKind}</small></span><Button variant="secondary" onClick={() => addLibraryPhase(entry)}>Ajouter</Button><IconButton icon="trash" danger title="Retirer de la bibliothèque" onClick={() => setPhaseLibrary((current) => current.filter((item) => item !== entry))} /></div>)}</div> : <div className="callout">La bibliothèque est locale au navigateur. Importer une fiche ou un CIF, sélectionner la phase puis l’enregistrer ici.</div>}
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
                <Section title="Exporter">
                  <div className="export-grid"><Button variant="primary" icon="download" disabled={isExporting} onClick={downloadPng}>PNG</Button><Button variant="secondary" disabled={isExporting} onClick={downloadSvg}>SVG</Button><Button variant="secondary" disabled={isExporting} onClick={downloadPdf}>PDF</Button><Button variant="secondary" disabled={isExporting} onClick={downloadTiff}>TIFF</Button><Button variant="secondary" icon="csv" onClick={exportProcessedCsv}>CSV traité</Button><Button variant="secondary" icon="csv" onClick={exportDetectedPeaksCsv}>CSV pics</Button>{activeMode === "raman" && <Button variant="secondary" icon="csv" onClick={exportZonesCsv}>CSV zones</Button>}<Button variant="secondary" icon="save" onClick={saveSessionFile}>Session JSON</Button></div>
                </Section>
              </>
            )}
          </div>
        </aside>
      </main>

      <input ref={patternInputRef} type="file" accept=".xy,.txt,.csv,.dat" multiple hidden onChange={(event) => { importPatterns([...event.target.files]); event.target.value = ""; }} />
      <input ref={phaseInputRef} type="file" accept=".dif,.cif,.txt,.csv,.dat" multiple hidden onChange={(event) => { importPhases([...event.target.files]); event.target.value = ""; }} />
      <input ref={sessionInputRef} type="file" accept=".json" hidden onChange={(event) => { loadSessionFile([...event.target.files]); event.target.value = ""; }} />
      <input ref={appendPhaseInputRef} type="file" accept=".dif,.txt,.csv,.dat" hidden onChange={(event) => { appendPhaseFile([...event.target.files]); event.target.value = ""; }} />

      {message && <div className="toast"><span className="toast__icon"><Icon name="check" size={13} /></span><span>{message}</span><button type="button" onClick={() => setMessage("")}><Icon name="close" size={14} /></button></div>}
      {isExporting && <div className="export-overlay"><div className="export-orbit"><Icon name="download" size={20} /></div><strong>Génération de la figure</strong><span>Préparation du fichier haute résolution…</span></div>}
      {addNoteMode && <div className="mode-banner"><Icon name="note" /><span>Cliquer dans la zone principale de la figure pour placer la note.</span><button type="button" onClick={() => setAddNoteMode(false)}>Annuler</button></div>}
    </div>
  );
}
