import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useHistoryState from "./useHistoryState";
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
} from "./lib";

const EMPTY_PROJECT = createEmptyProject();

function updateWorkspaceProject(project, mode, updater) {
  const resolvedMode = mode === "raman" ? "raman" : "drx";
  const currentWorkspace = project.workspaces?.[resolvedMode] || createWorkspace(resolvedMode);
  const nextWorkspace = typeof updater === "function" ? updater(currentWorkspace) : { ...currentWorkspace, ...updater };
  return {
    ...project,
    version: 10,
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
  ["none", "Aucune — échelle globale"],
];

const BASELINE_OPTIONS = [
  ["none", "Aucune"],
  ["linear", "Linéaire — extrémités"],
  ["rolling", "Rolling minimum"],
  ["polynomial", "Polynôme robuste"],
  ["als", "ALS asymétrique"],
];

const LAYOUT_OPTIONS = [
  ["stacked", "Empilement"],
  ["overlay", "Superposition"],
  ["waterfall", "Waterfall"],
  ["difference", "Différence à une référence"],
];

const PRESETS = {
  article1: { label: "Article · 1 colonne", figWidth: 1004, axisFontSize: 13, tickFontSize: 11, titleFontSize: 15, lineWidth: 1 },
  article2: { label: "Article · 2 colonnes", figWidth: 2126, axisFontSize: 22, tickFontSize: 18, titleFontSize: 26, lineWidth: 1.8 },
  presentation: { label: "Présentation", figWidth: 1600, axisFontSize: 20, tickFontSize: 16, titleFontSize: 24, lineWidth: 1.6 },
  compact: { label: "Écran compact", figWidth: 900, axisFontSize: 12, tickFontSize: 10, titleFontSize: 14, lineWidth: 0.8 },
};

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
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
  };
  return <svg {...common}>{paths[name] || paths.more}</svg>;
}

function Logo() {
  return (
    <div className="app-logo" aria-hidden="true">
      <span className="app-logo__monogram">MF</span>
      <span className="app-logo__rules"><i /><i /><i /></span>
    </div>
  );
}

function WorkspaceIllustration({ mode = "drx", compact = false }) {
  const isRaman = mode === "raman";
  return (
    <svg className={`workspace-asset ${compact ? "is-compact" : ""}`} viewBox="0 0 320 170" aria-hidden="true">
      <rect className="workspace-asset__paper" x="18" y="16" width="284" height="138" />
      <path className="workspace-asset__grid" d="M36 132H286M36 104H286M36 76H286M76 35V143M126 35V143M176 35V143M226 35V143M276 35V143" />
      <path className="workspace-asset__axis" d="M36 31V143H291" />
      {isRaman ? (
        <>
          <path className="workspace-asset__signal workspace-asset__signal--back" d="M38 126C54 124 61 116 72 119c13 4 20 8 31-10 13-22 24-5 35-7 13-2 15-29 28-29 15 0 15 46 32 42 12-2 15-17 28-17 13 0 17 23 31 19 11-3 13-14 29-12" />
          <path className="workspace-asset__signal" d="M38 131C57 128 62 122 75 124c15 2 20 0 29-15 12-20 23-3 35-6 14-3 14-45 30-45 16 0 14 56 33 51 14-3 15-25 30-23 14 2 16 31 32 22 8-5 13-11 23-8" />
          <circle className="workspace-asset__particle workspace-asset__particle--1" cx="169" cy="58" r="3" />
          <circle className="workspace-asset__particle workspace-asset__particle--2" cx="232" cy="86" r="2.4" />
        </>
      ) : (
        <>
          {[58, 84, 112, 144, 169, 213, 251, 276].map((x, index) => (
            <line key={x} className="workspace-asset__stick" x1={x} x2={x} y1="132" y2={132 - [22, 46, 29, 79, 36, 62, 27, 45][index]} />
          ))}
          <path className="workspace-asset__signal" d="M38 130 52 129 58 108 63 129 79 128 84 87 90 129 107 128 112 103 117 129 139 128 144 52 150 129 164 128 169 96 175 129 207 128 213 68 220 129 246 128 251 104 257 129 271 128 276 88 282 130" />
        </>
      )}
      <g className="workspace-asset__labels">
        <rect x="42" y="39" width="70" height="20" />
        <text x="77" y="53" textAnchor="middle">{isRaman ? "RAMAN DESK" : "DRX DESK"}</text>
        <text x="285" y="151" textAnchor="end">FIG. 01</text>
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

function Section({ title, children, defaultOpen = true, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`property-section ${open ? "is-open" : ""}`}>
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

function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

function NumberField({ label, value, onChange, min, max, step = 1, suffix, compact = false }) {
  const commit = (event) => {
    const number = Number.parseFloat(event.target.value);
    if (Number.isFinite(number)) onChange(clamp(number, min ?? -Infinity, max ?? Infinity));
  };
  return (
    <Field label={label}>
      <div className={`input-with-suffix ${compact ? "is-compact" : ""}`}>
        <input type="number" value={value} min={min} max={max} step={step} onChange={commit} />
        {suffix && <span>{suffix}</span>}
      </div>
    </Field>
  );
}

function SliderField({ label, value, onChange, min, max, step = 1, suffix }) {
  const commit = (event) => {
    const number = Number.parseFloat(event.target.value);
    if (Number.isFinite(number)) onChange(number);
  };
  return (
    <Field label={label}>
      <div className="slider-field">
        <input type="range" value={value} min={min} max={max} step={step} onChange={commit} />
        <div className="input-with-suffix is-compact">
          <input type="number" value={value} min={min} max={max} step={step} onChange={commit} />
          {suffix && <span>{suffix}</span>}
        </div>
      </div>
    </Field>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <Field label={label}>
      <input type="text" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function TextAreaField({ label, value, onChange, placeholder, hint, rows = 4 }) {
  return (
    <Field label={label} hint={hint}>
      <textarea rows={rows} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <Field label={label}>
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
      className={`data-item ${selected ? "is-selected" : ""} ${!pattern.visible ? "is-hidden" : ""} ${pattern.isAverage ? "is-average" : ""}`}
      draggable
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
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate("label", event.target.value)}
        />
        <span className="data-item__meta">{meta}</span>
        {averageSelectable && (
          <label className={`average-pick ${averageChecked ? "is-checked" : ""}`} onClick={(event) => event.stopPropagation()}>
            <input type="checkbox" checked={averageChecked} onChange={(event) => onAverageToggle?.(event.target.checked)} />
            <span>Inclure dans la moyenne Raman</span>
          </label>
        )}
        {pattern.isAverage ? <span className="derived-badge"><Icon name="average" size={10} /> patron moyen</span> : <span className="type-badge"><Icon name="waveform" size={10} /> acquisition</span>}
      </div>
      <div className="data-item__actions">
        <IconButton icon={pattern.visible ? "eye" : "eyeOff"} title={pattern.visible ? "Masquer" : "Afficher"} onClick={(event) => { event?.stopPropagation?.(); onUpdate("visible", !pattern.visible); }} />
        <IconButton icon="trash" title="Supprimer" danger onClick={(event) => { event?.stopPropagation?.(); onDelete(); }} />
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
  return (
    <article className={`data-item data-item--note ${selected ? "is-selected" : ""} ${note.visible === false ? "is-hidden" : ""}`} onClick={onSelect}>
      <span className="data-item__swatch" style={{ background: note.color }} />
      <div className="data-item__content">
        <input className="data-item__name" value={note.text} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdate("text", event.target.value)} />
        <span className="data-item__meta">x = {note.x.toLocaleString("fr-FR")} · y = {Math.round(note.yFrac * 100)} %</span>
      </div>
      <div className="data-item__actions"><IconButton icon={note.visible === false ? "eyeOff" : "eye"} title={note.visible === false ? "Afficher" : "Masquer"} onClick={(event) => { event?.stopPropagation?.(); onUpdate("visible", note.visible === false); }} /><IconButton icon="trash" title="Supprimer" danger onClick={(event) => { event?.stopPropagation?.(); onDelete(); }} /></div>
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

function BulkActionBar({ count, onSelectAll, onShow, onHide, onDuplicate, onDelete, onClear }) {
  if (!count) return null;
  return (
    <div className="bulk-bar">
      <div className="bulk-bar__count"><strong>{count}</strong><span>sélectionné{count > 1 ? 's' : ''}</span></div>
      <div className="bulk-bar__actions">
        <IconButton icon="selectAll" title="Tout sélectionner · Ctrl+A" onClick={onSelectAll} />
        <IconButton icon="eye" title="Afficher" onClick={onShow} />
        <IconButton icon="eyeOff" title="Masquer" onClick={onHide} />
        <IconButton icon="duplicate" title="Dupliquer" onClick={onDuplicate} />
        <IconButton icon="trash" title="Supprimer" danger onClick={onDelete} />
        <IconButton icon="close" title="Désélectionner" onClick={onClear} />
      </div>
    </div>
  );
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
  const [rightTab, setRightTab] = useState("appearance");
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
  const [dropActive, setDropActive] = useState(false);
  const [autosaveState, setAutosaveState] = useState("loading");
  const [isExporting, setIsExporting] = useState(false);
  const [ramanAverageSelection, setRamanAverageSelection] = useState([]);
  const [ramanAverageLabel, setRamanAverageLabel] = useState("");
  const [manualPhase, setManualPhase] = useState({ name: "", abbrev: "", peaks: "", color: PHASE_COLORS[0] });
  const [zoneDraft, setZoneDraft] = useState({ name: "", xmin: 500, xmax: 700, color: "#7c5cff", opacity: 0.12 });
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

  const patchSettings = useCallback((key, value, options) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      settings: { ...currentWorkspace.settings, [key]: value },
    })), options);
  }, [activeMode, history]);

  const updatePattern = useCallback((id, key, value) => {
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((pattern) => pattern.id === id ? { ...pattern, [key]: value } : pattern),
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

  const processed = useMemo(() => processPatterns(patterns, S), [patterns, S]);
  const visibleCount = processed.length;

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
    const fallbackName = file.name.replace(/\.(dif|txt|csv|dat)$/i, "").replace(/^PDF\s*/i, "");
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
          : (/\.dif$/i.test(file.name) ? "drx" : activeMode);
        const targetPhases = project.workspaces?.[detectedMode]?.phases || [];
        const bucket = additionsByMode[detectedMode];
        const name = reference.name || file.name.replace(/\.(dif|txt|csv|dat)$/i, "").replace(/^PDF\s*/i, "");
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
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.filter((item) => !ids.pattern.has(item.id)),
      phases: currentWorkspace.phases.filter((item) => !ids.phase.has(item.id)),
      notes: currentWorkspace.notes.filter((item) => !ids.note.has(item.id)),
      zones: currentWorkspace.zones.filter((item) => !ids.zone.has(item.id)),
    })));
    clearSelection();
  }, [activeMode, clearSelection, history]);

  const removeSelection = useCallback(() => removeItems(selection), [removeItems, selection]);

  const setSelectedVisibility = useCallback((visible) => {
    if (!selection.length) return;
    const ids = { pattern: selectedByType.pattern, phase: selectedByType.phase, note: selectedByType.note, zone: selectedByType.zone };
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((item) => ids.pattern.has(item.id) ? { ...item, visible } : item),
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
    const patternClones = patterns.filter((item) => selectedByType.pattern.has(item.id)).map((item) => cloneItem(item, "pattern", "label"));
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
      const movedPatterns = source.patterns.filter((item) => patternIds.has(item.id));
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
      patterns: currentWorkspace.patterns.map((item) => selectedByType.pattern.has(item.id) ? { ...item, yscale: 1, xoffset: 0, alignmentShift: 0 } : item),
    })));
  }, [activeMode, history, selectedByType.pattern]);

  const saveSessionFile = useCallback(() => {
    const payload = JSON.stringify({ ...project, version: 10 }, null, 2);
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
      if (/\.dif$/i.test(file.name)) {
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

  const alignVisiblePatterns = () => {
    const visible = patterns.filter((pattern) => pattern.visible);
    if (visible.length < 2) {
      setMessage("L’alignement nécessite au moins deux patrons visibles.");
      return;
    }
    const referenceId = S.alignmentReferenceId || activePattern?.id || visible[0].id;
    const reference = visible.find((pattern) => pattern.id === referenceId) || visible[0];
    const results = new Map();
    visible.forEach((pattern) => {
      if (pattern.id === reference.id) return;
      results.set(pattern.id, estimateCorrelationShift(reference, pattern, S));
    });
    history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({
      ...currentWorkspace,
      patterns: currentWorkspace.patterns.map((pattern) => {
        const result = results.get(pattern.id);
        if (!result) return pattern;
        return {
          ...pattern,
          xoffset: (Number(pattern.xoffset) || 0) + result.shift,
          alignmentScore: result.score,
          alignmentShift: (Number(pattern.alignmentShift) || 0) + result.shift,
          alignmentReference: reference.id,
        };
      }),
      settings: { ...currentWorkspace.settings, alignmentReferenceId: reference.id },
    })));
    const valid = [...results.values()].filter((result) => result.score !== null);
    const meanScore = valid.length ? valid.reduce((sum, result) => sum + result.score, 0) / valid.length : null;
    setMessage(`Alignement sur « ${reference.label} » appliqué à ${results.size} patron(s)${meanScore === null ? "" : ` · corrélation moyenne ${meanScore.toFixed(3)}`}.`);
  };

  const M = { left: 62, right: S.rightMargin, top: S.title ? 48 : 22, gap: 10, axisHeight: 50 };
  const curveMinimum = processed.length
    ? Math.min(...processed.map((pattern) => pattern.stackOffset + pattern.displayMinimum))
    : 0;
  const curveMaximum = processed.length
    ? Math.max(...processed.map((pattern) => pattern.stackOffset + pattern.displayMaximum))
    : 1;
  const curvePadding = Math.max(0.12, (curveMaximum - curveMinimum) * 0.06);
  const annotationBase = curveMaximum + S.annotGap;
  const hasAnnotations = S.showAnnotations && phases.some((phase) => phase.visible && phase.inAnnot);
  const yMinimum = Math.min(-0.15, curveMinimum - curvePadding);
  const yMaximum = hasAnnotations
    ? annotationBase + S.tickScale + 0.65
    : Math.max(curveMaximum + curvePadding, yMinimum + 1.2);
  const mainHeight = Math.max(270, (yMaximum - yMinimum) * S.pxPerUnit);
  const panelPhases = phases.filter((phase) => phase.visible && phase.inPanel);
  const panelHeight = S.showPdfPanel && panelPhases.length ? S.pdfPanelH : 0;
  const W = S.figWidth;
  const H = M.top + mainHeight + (panelHeight ? M.gap + panelHeight : 0) + M.axisHeight;
  const plotWidth = Math.max(120, W - M.left - M.right);
  const panelTop = M.top + mainHeight + M.gap;
  const rowHeight = panelPhases.length ? panelHeight / panelPhases.length : 0;

  const xToPx = useCallback((x) => M.left + ((x - S.xmin) / (S.xmax - S.xmin)) * plotWidth, [M.left, S.xmin, S.xmax, plotWidth]);
  const yToPx = useCallback((y) => M.top + mainHeight - ((y - yMinimum) / (yMaximum - yMinimum)) * mainHeight, [M.top, mainHeight, yMinimum, yMaximum]);
  const xTicks = useMemo(() => computeTicks(S.xmin, S.xmax, S.xTickStep), [S.xmin, S.xmax, S.xTickStep]);

  const annotationData = useMemo(() => {
    if (!S.showAnnotations) return { ticks: [], labels: [] };
    const ticks = [];
    phases.forEach((phase) => {
      if (!phase.visible || !phase.inAnnot) return;
      phase.peaks.forEach(([x, intensity]) => {
        if (x >= S.xmin && x <= S.xmax && intensity >= S.tickMinI) {
          ticks.push({ x, intensity, abbreviation: phase.abbrev, color: phase.color });
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
  }, [S.showAnnotations, S.xmin, S.xmax, S.tickMinI, S.labelMinI, S.labelMinSep, phases]);

  const serializeSvg = ({ transparent = S.transparentExport } = {}) => {
    if (!svgRef.current) return null;
    const clone = svgRef.current.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
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

  const onSvgPointerMove = (event) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * W;
    const svgY = ((event.clientY - rect.top) / rect.height) * H;
    if (svgX < M.left || svgX > M.left + plotWidth || svgY < M.top || svgY > M.top + mainHeight) {
      setCursor(null);
      return;
    }
    const dataX = S.xmin + ((svgX - M.left) / plotWidth) * (S.xmax - S.xmin);
    const nearest = activePattern
      ? nearestValue(processed.find((pattern) => pattern.id === activePattern.id) || {}, dataX)
      : null;
    setCursor({ dataX, svgX, svgY, nearest });
  };

  const onSvgClick = (event) => {
    if (!addNoteMode || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * W;
    const svgY = ((event.clientY - rect.top) / rect.height) * H;
    if (svgX < M.left || svgX > M.left + plotWidth || svgY < M.top || svgY > M.top + mainHeight) return;
    const x = S.xmin + ((svgX - M.left) / plotWidth) * (S.xmax - S.xmin);
    const yFrac = 1 - ((svgY - M.top) / mainHeight);
    const note = {
      id: newId("note"),
      x: Math.round(x * 1000) / 1000,
      yFrac: clamp(Math.round(yFrac * 1000) / 1000, 0, 1),
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
          <div className="inline-actions"><Button variant="secondary" icon="reset" onClick={resetSelectedPatternTransforms}>Réinitialiser Y et Δx</Button></div>
          <SelectField label="Déplacer vers" value={activeMode} onChange={moveSelectionToWorkspace} options={[[activeMode, activeMode.toUpperCase()], [activeMode === "drx" ? "raman" : "drx", activeMode === "drx" ? "Raman" : "DRX"]]} />
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
      <Section title="Patron sélectionné">
        <TextField label="Nom" value={activePattern.label} onChange={(value) => updatePattern(activePattern.id, "label", value)} />
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
        <div className="info-box">
          <span>{activePattern.fileName}</span>
          <span>{activePattern.x.length.toLocaleString("fr-FR")} points</span>
          {activePattern.isAverage && <span>Patron dérivé : {activePattern.replicateCount} acquisitions · {activePattern.averageMethod === "median" ? "médiane" : "moyenne"}</span>}
          {activePattern.isAverage && <span>Pré-normalisation : {activePattern.averageNormalizeMode || "none"}</span>}
          {activePattern.isAverage && <span>Sources : {(activePattern.sourceFiles || []).join(", ")}</span>}
          {selectedVisibleIndex >= 0 && <span>Position visible : {selectedVisibleIndex + 1}/{visibleCount}</span>}
          {Number.isFinite(activePattern.alignmentScore) && <span>Corrélation d’alignement : {activePattern.alignmentScore.toFixed(4)}</span>}
          {Number.isFinite(activePattern.alignmentShift) && activePattern.alignmentShift !== 0 && <span>Décalage automatique cumulé : {activePattern.alignmentShift.toFixed(4)}</span>}
        </div>
      </Section>
    </>
  ) : activePhase ? (
    <>
      <Section title="Phase sélectionnée">
        <TextField label="Nom affiché" value={activePhase.name} onChange={(value) => updatePhase(activePhase.id, "name", value)} />
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
    <Section title="Zone Raman sélectionnée">
      <TextField label="Nom" value={activeZone.name} onChange={(value) => updateZone(activeZone.id, "name", value)} />
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
    <Section title="Note sélectionnée">
      <TextField label="Texte" value={activeNote.text} onChange={(value) => updateNote(activeNote.id, "text", value)} />
      <div className="two-columns">
        <NumberField label="Position X" value={activeNote.x} step={0.05} onChange={(value) => updateNote(activeNote.id, "x", value)} />
        <NumberField label="Position Y" value={activeNote.yFrac} min={0} max={1} step={0.01} onChange={(value) => updateNote(activeNote.id, "yFrac", value)} />
      </div>
      <div className="two-columns">
        <NumberField label="Taille" value={activeNote.fontSize} min={5} max={40} step={0.5} onChange={(value) => updateNote(activeNote.id, "fontSize", value)} />
        <NumberField label="Rotation" value={activeNote.rotation} min={-180} max={180} step={5} suffix="°" onChange={(value) => updateNote(activeNote.id, "rotation", value)} />
      </div>
      <Field label="Couleur"><div className="color-field"><input type="color" value={activeNote.color} onChange={(event) => updateNote(activeNote.id, "color", event.target.value)} /><code>{activeNote.color}</code></div></Field>
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
    <div className={`app-shell mode-${activeMode} density-${uiDensity} ${reduceMotion ? "reduce-motion" : ""}`}>
      <header className="topbar masthead">
        <div className="masthead__edition">
          <span>Scientific figure workshop</span>
          <span>Vol. 10 · Project foundation · Browser-local processing</span>
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
              <span>DRX · Raman · Scientific plotting desk</span>
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
          <span className="masthead__breaking">{activeMode === "drx" ? "DRX DESK" : "RAMAN DESK"}</span>
          <span><b>{patterns.length}</b> patrons</span>
          <span><b>{phases.length}</b> phases</span>
          {activeMode === "raman" && <span><b>{zones.length}</b> zones</span>}
          <span><b>{notes.length}</b> notes</span>
          <span className="masthead__ticker-copy">Figures vectorielles · traitement local · aucune donnée téléversée</span>
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
            onDelete={removeSelection}
            onClear={clearSelection}
          />
          <div className="project-filter"><Icon name="cursor" size={12} /><input value={listFilter} onChange={(event) => setListFilter(event.target.value)} placeholder="Filtrer la liste active…" /><kbd>Ctrl+A</kbd></div>
          <div className="side-panel__content">
            {leftTab === "patterns" && (
              <>
                <button type="button" className="drop-button" onClick={() => patternInputRef.current?.click()}><span className="drop-button__asset"><Icon name="waveform" /></span><span><strong>Importer des patrons</strong><small>.xy · .txt · .csv · .dat</small></span><Icon name="upload" size={14} /></button>
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
                  {filteredPatterns.length ? filteredPatterns.map((pattern) => { const index = patterns.findIndex((item) => item.id === pattern.id); return (
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
                  ); }) : <EmptyPanel kind="pattern" title="Aucun patron" body="Importer des données expérimentales ou déposer les fichiers dans l’espace central." />}
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
                    <label><span>X min</span><input type="number" value={zoneDraft.xmin} step="1" onChange={(event) => setZoneDraft((current) => ({ ...current, xmin: Number(event.target.value) }))} /></label>
                    <label><span>X max</span><input type="number" value={zoneDraft.xmax} step="1" onChange={(event) => setZoneDraft((current) => ({ ...current, xmax: Number(event.target.value) }))} /></label>
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
            </div>
            <div className="canvas-toolbar__divider" />
            <div className="canvas-toolbar__group">
              <IconButton icon="zoomOut" title="Réduire" onClick={() => setZoom((value) => clamp(value / 1.15, 0.2, 3))} />
              <button type="button" className="zoom-readout" onClick={() => setZoom(1)}>{Math.round(zoom * 100)} %</button>
              <IconButton icon="zoomIn" title="Agrandir" onClick={() => setZoom((value) => clamp(value * 1.15, 0.2, 3))} />
              <IconButton icon="fit" title="Ajuster à l’espace" onClick={fitToWorkspace} />
            </div>
            <div className="canvas-toolbar__divider" />
            <span className="canvas-toolbar__info">{W} × {Math.round(H)} px</span>
            <div className="canvas-toolbar__spacer" />
            <span className="canvas-toolbar__hint">Ctrl + molette : zoom · glisser avec l’outil main : déplacer</span>
          </div>

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
              <div className="page-stage" style={{ width: W * zoom, height: H * zoom }}>
                <div className="figure-page" style={{ width: W * zoom, height: H * zoom }}>
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${W} ${H}`}
                    width={W * zoom}
                    height={H * zoom}
                    xmlns="http://www.w3.org/2000/svg"
                    className={addNoteMode ? "is-adding-note" : ""}
                    onPointerMove={onSvgPointerMove}
                    onPointerLeave={() => setCursor(null)}
                    onClick={onSvgClick}
                  >
                    <rect data-figure-background x="0" y="0" width={W} height={H} fill={S.pageBackground} />

                    {S.title && <text x={M.left + plotWidth / 2} y={M.top - 17} textAnchor="middle" fontSize={S.titleFontSize} fontWeight="700" fill="#15191f" fontFamily="Arial, Helvetica, sans-serif">{S.title}</text>}

                    {S.mode === "raman" && zones.filter((zone) => zone.visible && Number(zone.xmax) > S.xmin && Number(zone.xmin) < S.xmax).map((zone) => {
                      const start = Math.max(S.xmin, Number(zone.xmin));
                      const end = Math.min(S.xmax, Number(zone.xmax));
                      const x = xToPx(start);
                      const width = Math.max(0, xToPx(end) - x);
                      return (
                        <g key={`zone-${zone.id}`} opacity={isSelected("zone", zone.id) ? 1 : 0.94}>
                          <rect x={x} y={M.top} width={width} height={mainHeight} fill={zone.color} opacity={zone.opacity ?? 0.12} />
                          {zone.showLabel !== false && width > 12 && <text x={x + width / 2} y={M.top + 14} textAnchor="middle" fontSize="9" fontWeight="700" fill={zone.color} fontFamily="Arial, Helvetica, sans-serif">{zone.name}</text>}
                        </g>
                      );
                    })}

                    {S.showGrid && xTicks.map((tick) => (
                      <line key={`grid-${tick}`} x1={xToPx(tick)} x2={xToPx(tick)} y1={M.top} y2={M.top + mainHeight + (panelHeight ? M.gap + panelHeight : 0)} stroke="#cfd4da" strokeWidth="0.65" opacity={S.gridOpacity} />
                    ))}

                    <defs>
                      <clipPath id="plot-clip">
                        <rect x={M.left} y={M.top} width={plotWidth} height={mainHeight} />
                      </clipPath>
                    </defs>

                    {processed.map((pattern) => {
                      if (!pattern.px?.length) return null;
                      const offset = pattern.stackOffset;
                      const color = colorMap.get(pattern.id) || "#111111";
                      const path = pattern.px.map((x, index) => `${index ? "L" : "M"}${xToPx(x).toFixed(2)},${yToPx(pattern.py[index] + offset).toFixed(2)}`).join("");
                      const baselineY = yToPx(offset);
                      const fillPath = `${path}L${xToPx(pattern.px.at(-1)).toFixed(2)},${baselineY.toFixed(2)}L${xToPx(pattern.px[0]).toFixed(2)},${baselineY.toFixed(2)}Z`;
                      const labelY = S.layoutMode === "overlay" && visibleCount > 1
                        ? curveMaximum - (pattern.stackIndex / (visibleCount - 1)) * Math.max(curveMaximum - curveMinimum, 0.8)
                        : offset + (pattern.displayMinimum + pattern.displayMaximum) * 0.5;
                      const labelledPeaks = [...(pattern.detectedPeaks || [])]
                        .sort((a, b) => b.prominence - a.prominence)
                        .slice(0, S.peakMaxLabels)
                        .sort((a, b) => a.displayX - b.displayX);
                      return (
                        <g key={pattern.id} opacity={selectedByType.pattern.size && !isSelected("pattern", pattern.id) ? 0.72 : 1}>
                          <g clipPath="url(#plot-clip)">
                            {S.layoutMode === "difference" && <line x1={M.left} x2={M.left + plotWidth} y1={baselineY} y2={baselineY} stroke={color} strokeWidth="0.55" strokeDasharray="3 3" opacity="0.35" />}
                            {S.showFill && <path d={fillPath} fill={color} opacity={S.fillAlpha} />}
                            <path d={path} fill="none" stroke={color} strokeWidth={S.lineWidth} vectorEffect="non-scaling-stroke" />
                            {S.showDetectedPeaks && (pattern.detectedPeaks || []).map((peak, peakIndex) => (
                              <circle key={`peak-marker-${pattern.id}-${peakIndex}`} cx={xToPx(peak.displayX)} cy={yToPx(peak.displayY + offset)} r={S.peakMarkerSize} fill={S.pageBackground} stroke={color} strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
                            ))}
                            {S.showDetectedPeaks && labelledPeaks.map((peak, peakIndex) => {
                              const x = xToPx(peak.displayX);
                              const y = yToPx(peak.displayY + offset) - 7 - (peakIndex % 2) * 7;
                              return <text key={`peak-label-${pattern.id}-${peakIndex}`} x={x} y={y} textAnchor="start" fontSize={S.peakLabelSize} fill={color} fontFamily="Arial, Helvetica, sans-serif" transform={`rotate(-90 ${x} ${y})`}>{peak.x.toFixed(S.mode === "drx" ? 2 : 0)}</text>;
                            })}
                          </g>
                          <text x={xToPx(S.xmax) + 10} y={yToPx(labelY)} dominantBaseline="middle" fontSize={S.patternLabelSize} fontWeight={S.patternLabelBold ? "700" : "400"} fill={color} fontFamily="Arial, Helvetica, sans-serif">{pattern.label}{pattern.isDifferenceReference ? " (réf.)" : ""}</text>
                        </g>
                      );
                    })}

                    {hasAnnotations && annotationData.ticks.map((tick, index) => {
                      const height = (tick.intensity / 100) * S.tickScale;
                      return <line key={`annotation-tick-${index}`} x1={xToPx(tick.x)} x2={xToPx(tick.x)} y1={yToPx(annotationBase)} y2={yToPx(annotationBase + height)} stroke={tick.color} strokeWidth="0.85" opacity="0.88" />;
                    })}
                    {hasAnnotations && annotationData.labels.map((tick, index) => {
                      const height = (tick.intensity / 100) * S.tickScale;
                      const x = xToPx(tick.x);
                      const y = yToPx(annotationBase + height + (index % 2 ? 0.1 : 0) + 0.04);
                      return <text key={`annotation-label-${index}`} x={x} y={y} fontSize={S.annotFontSize} fontWeight="700" fill={tick.color} fontFamily="Arial, Helvetica, sans-serif" transform={`rotate(-90 ${x} ${y})`}>{tick.abbreviation}</text>;
                    })}
                    {hasAnnotations && S.showAbbrevKey && phases.filter((phase) => phase.visible && phase.inAnnot).map((phase, index) => (
                      <text key={`key-${phase.id}`} x={xToPx(S.xmax) + 10} y={yToPx(annotationBase + S.tickScale * 0.84) + index * 14} fontSize="9" fontStyle="italic" fill={phase.color} fontFamily="Arial, Helvetica, sans-serif">{phase.abbrev} = {phase.name}</text>
                    ))}

                    {notes.filter((note) => note.visible !== false).map((note) => {
                      const x = xToPx(note.x);
                      const y = M.top + mainHeight * (1 - note.yFrac);
                      return (
                        <g key={note.id} opacity={isSelected("note", note.id) ? 1 : 0.92}>
                          {note.vline && <line x1={x} x2={x} y1={M.top} y2={M.top + mainHeight} stroke={note.color} strokeWidth="0.75" strokeDasharray="4 3" opacity="0.75" />}
                          <text x={x} y={y} textAnchor="middle" fontSize={note.fontSize} fill={note.color} fontFamily="Arial, Helvetica, sans-serif" transform={note.rotation ? `rotate(${note.rotation} ${x} ${y})` : undefined}>{note.text}</text>
                        </g>
                      );
                    })}

                    <line x1={M.left} x2={M.left} y1={M.top} y2={M.top + mainHeight} stroke="#15191f" strokeWidth="1" />
                    <text x="21" y={M.top + mainHeight / 2} fontSize={S.axisFontSize} fill="#15191f" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" transform={`rotate(-90 21 ${M.top + mainHeight / 2})`}>{S.ylabel}</text>

                    {panelHeight > 0 && (
                      <g>
                        {panelPhases.map((phase, rowIndex) => {
                          const rowTop = panelTop + rowIndex * rowHeight;
                          const subtitle = truncateLabel(phaseSubtitle(phase), S.phaseSubtitleMaxLength);
                          const showSubtitle = S.showRowSubtitles && phase.showSubtitle !== false && subtitle;
                          return (
                            <g key={phase.id}>
                              {phase.peaks.map(([x, intensity], index) => x >= S.xmin && x <= S.xmax ? (
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
                          const boxWidth = Math.min(230, Math.max(170, plotWidth * 0.26));
                          const lineHeight = 16;
                          const boxHeight = panelPhases.length * lineHeight + 24;
                          const boxX = M.left + plotWidth - boxWidth - 7;
                          const boxY = panelTop + 7;
                          return <g><rect x={boxX} y={boxY} width={boxWidth} height={boxHeight} fill="#ffffff" opacity="0.92" stroke="#aeb4bb" strokeWidth="0.7" rx="3"/><text x={boxX + boxWidth / 2} y={boxY + 14} textAnchor="middle" fontSize="9" fontWeight="700" fill="#343a40">Références de phase</text>{panelPhases.map((phase, index) => {
                            const subtitle = truncateLabel(phaseSubtitle(phase), S.phaseSubtitleMaxLength);
                            const suffix = S.showRowSubtitles && phase.showSubtitle !== false && subtitle ? ` — ${subtitle}` : "";
                            return <g key={phase.id}><line x1={boxX + 9} x2={boxX + 27} y1={boxY + 24 + index * lineHeight} y2={boxY + 24 + index * lineHeight} stroke={phase.color} strokeWidth="2"/><text x={boxX + 34} y={boxY + 27 + index * lineHeight} fontSize="8" fill="#20252b">{phase.name}{suffix}</text></g>;
                          })}</g>;
                        })()}
                      </g>
                    )}

                    {(() => {
                      const axisY = panelHeight ? panelTop + panelHeight : M.top + mainHeight;
                      return <g><line x1={M.left} x2={M.left + plotWidth} y1={axisY} y2={axisY} stroke="#15191f" strokeWidth="1"/>{xTicks.map((tick) => <g key={tick}><line x1={xToPx(tick)} x2={xToPx(tick)} y1={axisY} y2={axisY + 5} stroke="#15191f" strokeWidth="1"/><text x={xToPx(tick)} y={axisY + 20} textAnchor="middle" fontSize={S.tickFontSize} fill="#15191f" fontFamily="Arial, Helvetica, sans-serif">{tick}</text></g>)}<text x={M.left + plotWidth / 2} y={axisY + 42} textAnchor="middle" fontSize={S.axisFontSize} fill="#15191f" fontFamily="Arial, Helvetica, sans-serif">{S.xlabel}</text></g>;
                    })()}

                    {cursor && <g pointerEvents="none"><line x1={cursor.svgX} x2={cursor.svgX} y1={M.top} y2={M.top + mainHeight} stroke="#67707c" strokeWidth="0.7" strokeDasharray="3 3" opacity="0.7"/></g>}
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
            {[ ["inspector", "Inspecteur", "cursor"], ["processing", "Traitement", "waveform"], ["appearance", "Apparence", "sparkles"], ["references", "Références", "phase"], ["export", "Export", "download"] ].map(([value, label, icon]) => <button type="button" key={value} className={rightTab === value ? "is-active" : ""} onClick={() => setRightTab(value)}><Icon name={icon} size={12} />{label}{value === "inspector" && selectionCount > 0 && <span>{selectionCount}</span>}</button>)}
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
                <Section title="Texte et axes">
                  <TextField label="Titre" value={S.title} onChange={(value) => patchSettings("title", value)} placeholder="Titre facultatif" />
                  <TextField label="Axe X" value={S.xlabel} onChange={(value) => patchSettings("xlabel", value)} />
                  <TextField label="Axe Y" value={S.ylabel} onChange={(value) => patchSettings("ylabel", value)} />
                  <div className="two-columns"><NumberField label="X minimum" value={S.xmin} step={0.5} onChange={(value) => { if (value < S.xmax) patchSettings("xmin", value); else setMessage("X minimum doit rester inférieur à X maximum."); }} /><NumberField label="X maximum" value={S.xmax} step={0.5} onChange={(value) => { if (value > S.xmin) patchSettings("xmax", value); else setMessage("X maximum doit rester supérieur à X minimum."); }} /></div>
                  <NumberField label="Pas des graduations" value={S.xTickStep} min={0} step={0.5} onChange={(value) => patchSettings("xTickStep", value)} />
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
                  <SliderField label="Marge droite" value={S.rightMargin} min={50} max={400} step={5} suffix="px" onChange={(value) => patchSettings("rightMargin", value)} />
                </Section>
                <Section title="Typographie" defaultOpen={false}>
                  <SliderField label="Titre" value={S.titleFontSize} min={10} max={36} step={0.5} suffix="pt" onChange={(value) => patchSettings("titleFontSize", value)} />
                  <SliderField label="Axes" value={S.axisFontSize} min={8} max={28} step={0.5} suffix="pt" onChange={(value) => patchSettings("axisFontSize", value)} />
                  <SliderField label="Graduations" value={S.tickFontSize} min={6} max={24} step={0.5} suffix="pt" onChange={(value) => patchSettings("tickFontSize", value)} />
                  <SliderField label="Labels de patrons" value={S.patternLabelSize} min={7} max={26} step={0.5} suffix="pt" onChange={(value) => patchSettings("patternLabelSize", value)} />
                  <Toggle label="Labels en gras" checked={S.patternLabelBold} onChange={(value) => patchSettings("patternLabelBold", value)} />
                </Section>
              </>
            )}

            {rightTab === "processing" && (
              <>
                <Section title="Prétraitement">
                  <SliderField label="Lissage — moyenne mobile" value={S.smoothW} min={1} max={41} step={1} onChange={(value) => patchSettings("smoothW", value)} />
                  <SliderField label="Écrêtage percentile" value={S.clipPct} min={90} max={100} step={0.1} suffix="%" onChange={(value) => patchSettings("clipPct", value)} />
                  <SelectField label="Normalisation" value={S.normalizeMode} onChange={(value) => patchSettings("normalizeMode", value)} options={NORMALIZATION_OPTIONS} />
                  {S.normalizeMode === "none" && <div className="callout">Les amplitudes relatives sont conservées ; une échelle globale commune est utilisée uniquement pour l’affichage.</div>}
                </Section>

                <Section title="Correction de ligne de base">
                  <SelectField label="Méthode" value={S.baselineMode} onChange={(value) => patchSettings("baselineMode", value)} options={BASELINE_OPTIONS} />
                  {S.baselineMode === "rolling" && <SliderField label="Fenêtre" value={S.baselineWindow} min={5} max={501} step={2} suffix="pts" onChange={(value) => patchSettings("baselineWindow", Math.round(value) | 1)} />}
                  {S.baselineMode === "polynomial" && <SliderField label="Ordre du polynôme" value={S.baselinePolyOrder} min={1} max={6} step={1} onChange={(value) => patchSettings("baselinePolyOrder", Math.round(value))} />}
                  {S.baselineMode === "als" && <SliderField label="Rigidité log₁₀(λ)" value={S.baselineLambdaLog} min={1} max={9} step={0.25} onChange={(value) => patchSettings("baselineLambdaLog", value)} />}
                  {["polynomial", "als"].includes(S.baselineMode) && <><SliderField label="Asymétrie p" value={S.baselineAsymmetry} min={0.001} max={0.2} step={0.001} onChange={(value) => patchSettings("baselineAsymmetry", value)} /><SliderField label="Itérations" value={S.baselineIterations} min={1} max={20} step={1} onChange={(value) => patchSettings("baselineIterations", Math.round(value))} /></>}
                  {S.baselineMode !== "none" && <Toggle label="Ramener les valeurs négatives à zéro" checked={S.baselineClamp} onChange={(value) => patchSettings("baselineClamp", value)} />}
                  {S.baselineMode === "als" && <div className="callout">ALS est plus coûteux que les autres méthodes. Une rigidité élevée produit une ligne de base plus lisse.</div>}
                </Section>

                <Section title="Détection automatique de pics">
                  <Toggle label="Afficher les pics détectés" checked={S.showDetectedPeaks} onChange={(value) => patchSettings("showDetectedPeaks", value)} />
                  <SliderField label="Hauteur minimale" value={S.peakMinHeight} min={0} max={100} step={1} suffix="%" onChange={(value) => patchSettings("peakMinHeight", value)} />
                  <SliderField label="Proéminence minimale" value={S.peakMinProminence} min={0} max={100} step={0.5} suffix="%" onChange={(value) => patchSettings("peakMinProminence", value)} />
                  <NumberField label="Distance minimale X" value={S.peakMinDistance} min={0} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => patchSettings("peakMinDistance", value)} />
                  <SliderField label="Fenêtre de proéminence" value={S.peakLookaround} min={2} max={250} step={1} suffix="pts" onChange={(value) => patchSettings("peakLookaround", Math.round(value))} />
                  <SliderField label="Nombre maximal de labels" value={S.peakMaxLabels} min={0} max={100} step={1} onChange={(value) => patchSettings("peakMaxLabels", Math.round(value))} />
                  <div className="inline-actions"><Button variant="secondary" icon="csv" onClick={exportDetectedPeaksCsv}>Exporter les pics</Button></div>
                </Section>

                <Section title="Alignement par corrélation">
                  <SelectField label="Référence" value={S.alignmentReferenceId} onChange={(value) => patchSettings("alignmentReferenceId", value)} options={[["", activePattern ? `Sélection : ${activePattern.label}` : "Premier patron visible"], ...patterns.filter((pattern) => pattern.visible).map((pattern) => [pattern.id, pattern.label])]} />
                  <NumberField label="Décalage maximal ±" value={S.alignmentMaxShift} min={0} step={S.mode === "drx" ? 0.05 : 1} onChange={(value) => patchSettings("alignmentMaxShift", value)} />
                  <NumberField label="Pas de recherche" value={S.alignmentStep} min={0.0001} step={S.mode === "drx" ? 0.005 : 0.1} onChange={(value) => patchSettings("alignmentStep", value)} />
                  <div className="inline-actions"><Button variant="primary" onClick={alignVisiblePatterns}>Aligner les patrons visibles</Button><Button variant="secondary" icon="reset" onClick={() => history.set((current) => updateWorkspaceProject(current, activeMode, (currentWorkspace) => ({ ...currentWorkspace, patterns: currentWorkspace.patterns.map((pattern) => ({ ...pattern, xoffset: (Number(pattern.xoffset) || 0) - (Number(pattern.alignmentShift) || 0), alignmentShift: 0, alignmentScore: undefined, alignmentReference: undefined })) })))}>Retirer l’alignement auto</Button></div>
                  <div className="callout">L’algorithme recherche le décalage X maximisant la corrélation avec le patron de référence sur la plage affichée.</div>
                </Section>

                <Section title="Courbes">
                  <SliderField label="Épaisseur" value={S.lineWidth} min={0.3} max={4} step={0.05} onChange={(value) => patchSettings("lineWidth", value)} />
                  <Toggle label="Remplissage sous les courbes" checked={S.showFill} onChange={(value) => patchSettings("showFill", value)} />
                  {S.showFill && <SliderField label="Opacité" value={S.fillAlpha} min={0} max={0.5} step={0.01} onChange={(value) => patchSettings("fillAlpha", value)} />}
                </Section>
                <Section title="Couleurs">
                  <SelectField label="Palette" value={S.cmap} onChange={(value) => patchSettings("cmap", value)} options={Object.keys(CMAPS)} />
                  <div className="colormap-preview" style={{ background: cmapGradient(S.cmap, S.cmapMin, S.cmapMax, S.cmapReverse) }} />
                  <SliderField label="Borne inférieure" value={S.cmapMin} min={0} max={1} step={0.05} onChange={(value) => patchSettings("cmapMin", Math.min(value, S.cmapMax))} />
                  <SliderField label="Borne supérieure" value={S.cmapMax} min={0} max={1} step={0.05} onChange={(value) => patchSettings("cmapMax", Math.max(value, S.cmapMin))} />
                  <Toggle label="Inverser la palette" checked={S.cmapReverse} onChange={(value) => patchSettings("cmapReverse", value)} />
                  <Toggle label="Couleurs manuelles" checked={S.useCustomColors} onChange={(value) => patchSettings("useCustomColors", value)} />
                </Section>
              </>
            )}

            {rightTab === "references" && (
              <>
                <Section title="Annotations de phases">
                  <Toggle label="Afficher les annotations" checked={S.showAnnotations} onChange={(value) => patchSettings("showAnnotations", value)} />
                  {S.showAnnotations && <><SliderField label="Seuil des bâtonnets" value={S.tickMinI} min={0} max={50} step={0.5} suffix="%" onChange={(value) => patchSettings("tickMinI", value)} /><SliderField label="Seuil des labels" value={S.labelMinI} min={0} max={100} step={1} suffix="%" onChange={(value) => patchSettings("labelMinI", value)} /><SliderField label="Séparation des labels" value={S.labelMinSep} min={0.1} max={10} step={0.1} onChange={(value) => patchSettings("labelMinSep", value)} /><SliderField label="Hauteur" value={S.tickScale} min={0.1} max={1.5} step={0.02} onChange={(value) => patchSettings("tickScale", value)} /><SliderField label="Écart au patron" value={S.annotGap} min={0.3} max={3} step={0.02} onChange={(value) => patchSettings("annotGap", value)} /><SliderField label="Taille des labels" value={S.annotFontSize} min={5} max={18} step={0.5} onChange={(value) => patchSettings("annotFontSize", value)} /><Toggle label="Clé des abréviations" checked={S.showAbbrevKey} onChange={(value) => patchSettings("showAbbrevKey", value)} /></>}
                </Section>
                <Section title="Panneau de références">
                  <Toggle label="Afficher le panneau" checked={S.showPdfPanel} onChange={(value) => patchSettings("showPdfPanel", value)} />
                  {S.showPdfPanel && <>
                    <SliderField label="Hauteur" value={S.pdfPanelH} min={60} max={500} step={10} suffix="px" onChange={(value) => patchSettings("pdfPanelH", value)} />
                    <SliderField label="Épaisseur des bâtonnets" value={S.pdfStickW} min={0.3} max={4} step={0.05} onChange={(value) => patchSettings("pdfStickW", value)} />
                    <Toggle label="Noms des lignes" checked={S.showRowLabels} onChange={(value) => patchSettings("showRowLabels", value)} />
                    <Toggle label="Sous-titres des lignes" checked={S.showRowSubtitles} onChange={(value) => patchSettings("showRowSubtitles", value)} />
                    {S.showRowSubtitles && <NumberField label="Longueur maximale" value={S.phaseSubtitleMaxLength} min={0} max={120} step={1} suffix="car." onChange={(value) => patchSettings("phaseSubtitleMaxLength", Math.round(value))} />}
                    <Toggle label="Encart de légende" checked={S.showPdfLegend} onChange={(value) => patchSettings("showPdfLegend", value)} />
                  </>}
                </Section>
              </>
            )}

            {rightTab === "inspector" && renderPatternProperties()}

            {rightTab === "export" && (
              <>
                <Section title="Format de publication">
                  <SelectField label="Preset" value="" onChange={applyPreset} options={[["", "Choisir…"], ...Object.entries(PRESETS).map(([key, preset]) => [key, preset.label])]} />
                  <SliderField label="Largeur de figure" value={S.figWidth} min={500} max={3000} step={25} suffix="px" onChange={(value) => patchSettings("figWidth", value)} />
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
      <input ref={phaseInputRef} type="file" accept=".dif,.txt,.csv,.dat" multiple hidden onChange={(event) => { importPhases([...event.target.files]); event.target.value = ""; }} />
      <input ref={sessionInputRef} type="file" accept=".json" hidden onChange={(event) => { loadSessionFile([...event.target.files]); event.target.value = ""; }} />
      <input ref={appendPhaseInputRef} type="file" accept=".dif,.txt,.csv,.dat" hidden onChange={(event) => { appendPhaseFile([...event.target.files]); event.target.value = ""; }} />

      {message && <div className="toast"><span className="toast__icon"><Icon name="check" size={13} /></span><span>{message}</span><button type="button" onClick={() => setMessage("")}><Icon name="close" size={14} /></button></div>}
      {isExporting && <div className="export-overlay"><div className="export-orbit"><Icon name="download" size={20} /></div><strong>Génération de la figure</strong><span>Préparation du fichier haute résolution…</span></div>}
      {addNoteMode && <div className="mode-banner"><Icon name="note" /><span>Cliquer dans la zone principale de la figure pour placer la note.</span><button type="button" onClick={() => setAddNoteMode(false)}>Annuler</button></div>}
    </div>
  );
}
