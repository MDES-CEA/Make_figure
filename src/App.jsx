import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useHistoryState from "./useHistoryState";
import {
  CMAPS,
  DEFAULTS,
  INITIAL_SETTINGS,
  PHASE_COLORS,
  buildPdfFromJpeg,
  cardNumber,
  clearAutosave,
  cmapGradient,
  computeTicks,
  detectedPeaksToCsv,
  downloadBlob,
  encodeTiffRgba,
  estimateCorrelationShift,
  loadAutosave,
  mergeDedupPeaks,
  nearestValue,
  newId,
  parseDIFBinary,
  parsePeaksText,
  parseXYText,
  patternColor,
  processPatterns,
  processedPatternsToCsv,
  saveAutosave,
  validateProject,
} from "./lib";

const EMPTY_PROJECT = {
  settings: INITIAL_SETTINGS,
  patterns: [],
  phases: [],
  notes: [],
};

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

function Icon({ name, size = 16 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  const paths = {
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/></>,
    download: <><path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></>,
    save: <><path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3"/><path d="M8 21v-7h8v7"/></>,
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
    zoomIn: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6"/></>,
    zoomOut: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M7.5 10.5h6"/></>,
    fit: <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></>,
    hand: <><path d="M7 11V7a1.5 1.5 0 0 1 3 0v3-5a1.5 1.5 0 0 1 3 0v5-4a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v5c0 4-2.5 7-7 7h-1c-2 0-3.5-.8-4.8-2.3L3.5 15a1.7 1.7 0 0 1 2.5-2.3z"/></>,
    cursor: <><path d="m5 3 12 10-6 1 3 6-2 1-3-6-4 4z"/></>,
    close: <><path d="M6 6l12 12M18 6 6 18"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
    note: <><path d="M5 4h14v12l-5 5H5z"/><path d="M14 21v-5h5"/></>,
    csv: <><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 12h8M8 16h8"/></>,
    reset: <><path d="M4 4v6h6"/><path d="M5.5 15a7 7 0 1 0 .6-7.7L4 10"/></>,
  };
  return <svg {...common}>{paths[name] || paths.more}</svg>;
}

function Logo() {
  return (
    <div className="app-logo" aria-hidden="true">
      <svg width="32" height="28" viewBox="0 0 32 28">
        {[0, 1, 2].map((index) => (
          <path
            key={index}
            d={`M2 ${23 - index * 6} L10 ${23 - index * 6} L13 ${11 - index * 6 + 4} L16 ${23 - index * 6} L22 ${23 - index * 6} L24 ${17 - index * 6 + 2} L27 ${23 - index * 6} L30 ${23 - index * 6}`}
            fill="none"
            stroke={["#6f5cff", "#d25499", "#e19a62"][index]}
            strokeWidth="1.7"
          />
        ))}
      </svg>
    </div>
  );
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
    <section className="property-section">
      <button type="button" className="property-section__header" onClick={() => setOpen((value) => !value)}>
        <span className="property-section__chevron"><Icon name={open ? "chevronDown" : "chevronRight"} size={14} /></span>
        <span>{title}</span>
        {badge !== undefined && <span className="property-section__badge">{badge}</span>}
      </button>
      {open && <div className="property-section__body">{children}</div>}
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

function EmptyPanel({ title, body }) {
  return (
    <div className="empty-panel">
      <div className="empty-panel__icon"><Icon name="folder" size={22} /></div>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function PatternItem({ pattern, index, color, selected, onSelect, onUpdate, onDelete, onDragStart, onDrop }) {
  return (
    <article
      className={`data-item ${selected ? "is-selected" : ""} ${!pattern.visible ? "is-hidden" : ""}`}
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
        <span className="data-item__meta">{pattern.x.length.toLocaleString("fr-FR")} points · #{index + 1}</span>
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
        <span className="data-item__meta">{phase.peaks.length} pics · {phase.files.map(cardNumber).join(", ")}</span>
        <div className="data-item__chips">
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
    <article className={`data-item data-item--note ${selected ? "is-selected" : ""}`} onClick={onSelect}>
      <span className="data-item__swatch" style={{ background: note.color }} />
      <div className="data-item__content">
        <input className="data-item__name" value={note.text} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdate("text", event.target.value)} />
        <span className="data-item__meta">x = {note.x.toLocaleString("fr-FR")} · y = {Math.round(note.yFrac * 100)} %</span>
      </div>
      <div className="data-item__actions"><IconButton icon="trash" title="Supprimer" danger onClick={onDelete} /></div>
    </article>
  );
}

function Resizer({ side, onResize }) {
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
  return <div className={`panel-resizer panel-resizer--${side}`} onPointerDown={start} />;
}

export default function App() {
  const history = useHistoryState(EMPTY_PROJECT);
  const project = history.value;
  const { settings: S, patterns, phases, notes } = project;

  const [leftTab, setLeftTab] = useState("patterns");
  const [rightTab, setRightTab] = useState("figure");
  const [leftWidth, setLeftWidth] = useState(310);
  const [rightWidth, setRightWidth] = useState(330);
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState(null);
  const [addNoteMode, setAddNoteMode] = useState(false);
  const [tool, setTool] = useState("cursor");
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [autosaveState, setAutosaveState] = useState("loading");
  const [isExporting, setIsExporting] = useState(false);

  const svgRef = useRef(null);
  const workspaceRef = useRef(null);
  const patternInputRef = useRef(null);
  const phaseInputRef = useRef(null);
  const sessionInputRef = useRef(null);
  const appendPhaseInputRef = useRef(null);
  const appendTargetRef = useRef(null);
  const draggedRef = useRef(null);
  const autosaveLoadedRef = useRef(false);
  const panRef = useRef(null);

  const patchProject = useCallback((patch, options) => {
    history.set((current) => ({ ...current, ...patch }), options);
  }, [history]);

  const patchSettings = useCallback((key, value, options) => {
    history.set((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value },
    }), options);
  }, [history]);

  const updatePattern = useCallback((id, key, value) => {
    history.set((current) => ({
      ...current,
      patterns: current.patterns.map((pattern) => pattern.id === id ? { ...pattern, [key]: value } : pattern),
    }));
  }, [history]);

  const updatePhase = useCallback((id, key, value) => {
    history.set((current) => ({
      ...current,
      phases: current.phases.map((phase) => phase.id === id ? { ...phase, [key]: value } : phase),
    }));
  }, [history]);

  const updateNote = useCallback((id, key, value) => {
    history.set((current) => ({
      ...current,
      notes: current.notes.map((note) => note.id === id ? { ...note, [key]: value } : note),
    }));
  }, [history]);

  useEffect(() => {
    if (autosaveLoadedRef.current) return;
    autosaveLoadedRef.current = true;
    loadAutosave()
      .then((saved) => {
        if (saved) {
          history.replace(validateProject(saved));
          setMessage("Session locale restaurée.");
        }
        setAutosaveState("saved");
      })
      .catch(() => setAutosaveState("error"));
  }, [history]);

  useEffect(() => {
    if (autosaveState === "loading") return undefined;
    setAutosaveState("saving");
    const timer = window.setTimeout(() => {
      saveAutosave(project)
        .then(() => setAutosaveState("saved"))
        .catch(() => setAutosaveState("error"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project, autosaveState === "loading"]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const processed = useMemo(() => processPatterns(patterns, S), [patterns, S]);
  const visibleCount = processed.length;

  const colorMap = useMemo(() => {
    const result = new Map();
    processed.forEach((pattern, index) => result.set(pattern.id, patternColor(pattern, index, visibleCount, S)));
    return result;
  }, [processed, visibleCount, S]);

  const activePattern = selection?.type === "pattern" ? patterns.find((pattern) => pattern.id === selection.id) : null;
  const activePhase = selection?.type === "phase" ? phases.find((phase) => phase.id === selection.id) : null;
  const activeNote = selection?.type === "note" ? notes.find((note) => note.id === selection.id) : null;

  const readPhaseFile = async (file) => {
    if (/\.dif$/i.test(file.name)) {
      const buffer = await file.arrayBuffer();
      let peaks = parseDIFBinary(buffer);
      if (!peaks.length) {
        try { peaks = parsePeaksText(new TextDecoder("latin1").decode(buffer)); } catch { peaks = []; }
      }
      return peaks;
    }
    return parsePeaksText(await file.text());
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
      history.set((current) => ({ ...current, patterns: [...current.patterns, ...additions] }));
      setLeftTab("patterns");
      setSelection({ type: "pattern", id: additions[0].id });
      setMessage(`${additions.length} patron(s) importé(s)${warnings.length ? ` · ${warnings.join(" · ")}` : ""}`);
    } else if (warnings.length) setMessage(warnings.join(" · "));
  }, [history]);

  const importPhases = useCallback(async (files) => {
    const additions = [];
    const warnings = [];
    for (const file of files) {
      try {
        const peaks = await readPhaseFile(file);
        if (!peaks.length) {
          warnings.push(`${file.name}: aucun pic valide`);
          continue;
        }
        const name = file.name.replace(/\.(dif|txt|csv|dat)$/i, "").replace(/^PDF\s*/i, "");
        additions.push({
          id: newId("phase"),
          name,
          abbrev: name.slice(0, 3),
          color: PHASE_COLORS[(phases.length + additions.length) % PHASE_COLORS.length],
          peaks,
          files: [file.name],
          visible: true,
          inAnnot: true,
          inPanel: true,
        });
      } catch {
        warnings.push(`${file.name}: lecture impossible`);
      }
    }
    if (additions.length) {
      history.set((current) => ({ ...current, phases: [...current.phases, ...additions] }));
      setLeftTab("phases");
      setSelection({ type: "phase", id: additions[0].id });
      setMessage(`${additions.length} phase(s) importée(s)${warnings.length ? ` · ${warnings.join(" · ")}` : ""}`);
    } else if (warnings.length) setMessage(warnings.join(" · "));
  }, [history, phases.length]);

  const appendPhaseFile = async (files) => {
    const targetId = appendTargetRef.current;
    if (!targetId || !files.length) return;
    const file = files[0];
    const peaks = await readPhaseFile(file);
    if (!peaks.length) {
      setMessage(`Aucun pic valide dans ${file.name}.`);
      return;
    }
    history.set((current) => ({
      ...current,
      phases: current.phases.map((phase) => phase.id === targetId
        ? { ...phase, peaks: mergeDedupPeaks(phase.peaks, peaks), files: [...phase.files, file.name] }
        : phase),
    }));
    setMessage(`Fiche ${file.name} fusionnée.`);
  };

  const setMode = (mode) => {
    const defaults = DEFAULTS[mode];
    history.set((current) => ({
      ...current,
      settings: { ...current.settings, mode, xmin: defaults.xmin, xmax: defaults.xmax, xlabel: defaults.xlabel },
    }));
  };

  const removeSelection = useCallback(() => {
    if (!selection) return;
    history.set((current) => ({
      ...current,
      patterns: selection.type === "pattern" ? current.patterns.filter((item) => item.id !== selection.id) : current.patterns,
      phases: selection.type === "phase" ? current.phases.filter((item) => item.id !== selection.id) : current.phases,
      notes: selection.type === "note" ? current.notes.filter((item) => item.id !== selection.id) : current.notes,
    }));
    setSelection(null);
  }, [history, selection]);

  const saveSessionFile = useCallback(() => {
    const payload = JSON.stringify({ version: 4, ...project }, null, 2);
    downloadBlob(payload, "application/json", `${S.fileName || "figure"}_session.json`);
    setMessage("Session JSON exportée.");
  }, [project, S.fileName]);

  const loadSessionFile = async (files) => {
    if (!files.length) return;
    try {
      const parsed = JSON.parse(await files[0].text());
      history.replace(validateProject(parsed));
      setSelection(null);
      setMessage("Session restaurée.");
    } catch (error) {
      setMessage(`Session invalide : ${error.message}`);
    }
  };

  const createNewProject = async () => {
    if ((patterns.length || phases.length || notes.length) && !window.confirm("Effacer la session courante ?")) return;
    history.replace(EMPTY_PROJECT);
    setSelection(null);
    setZoom(1);
    await clearAutosave().catch(() => {});
    setMessage("Nouveau projet créé.");
  };

  const reorder = (type, draggedId, targetId) => {
    if (!draggedId || draggedId === targetId) return;
    const key = type === "pattern" ? "patterns" : "phases";
    history.set((current) => {
      const list = current[key].slice();
      const from = list.findIndex((item) => item.id === draggedId);
      const to = list.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return current;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      return { ...current, [key]: list };
    });
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
    const difFiles = files.filter((file) => /\.dif$/i.test(file.name));
    const patternFiles = files.filter((file) => !/\.dif$/i.test(file.name));
    if (patternFiles.length) await importPatterns(patternFiles);
    if (difFiles.length) await importPhases(difFiles);
  };

  const selectedVisibleIndex = processed.findIndex((pattern) => pattern.id === activePattern?.id);

  const applyPreset = (presetKey) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    history.set((current) => ({
      ...current,
      settings: { ...current.settings, ...preset },
    }));
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
    history.set((current) => ({
      ...current,
      patterns: current.patterns.map((pattern) => {
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
      settings: { ...current.settings, alignmentReferenceId: reference.id },
    }));
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
    };
    history.set((current) => ({ ...current, notes: [...current.notes, note] }));
    setSelection({ type: "note", id: note.id });
    setLeftTab("notes");
    setRightTab("selection");
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
      } else if (!typing && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        removeSelection();
      } else if (event.key === "Escape") {
        setAddNoteMode(false);
        setTool("cursor");
        setDropActive(false);
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
  }, [history, removeSelection, saveSessionFile, tool]);

  const renderPatternProperties = () => activePattern ? (
    <>
      <Section title="Patron sélectionné">
        <TextField label="Nom" value={activePattern.label} onChange={(value) => updatePattern(activePattern.id, "label", value)} />
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
          {selectedVisibleIndex >= 0 && <span>Position visible : {selectedVisibleIndex + 1}/{visibleCount}</span>}
          {Number.isFinite(activePattern.alignmentScore) && <span>Corrélation d’alignement : {activePattern.alignmentScore.toFixed(4)}</span>}
          {Number.isFinite(activePattern.alignmentShift) && activePattern.alignmentShift !== 0 && <span>Décalage automatique cumulé : {activePattern.alignmentShift.toFixed(4)}</span>}
        </div>
      </Section>
    </>
  ) : activePhase ? (
    <Section title="Phase sélectionnée">
      <TextField label="Nom" value={activePhase.name} onChange={(value) => updatePhase(activePhase.id, "name", value)} />
      <TextField label="Abréviation" value={activePhase.abbrev} onChange={(value) => updatePhase(activePhase.id, "abbrev", value)} />
      <Field label="Couleur">
        <div className="color-field">
          <input type="color" value={activePhase.color} onChange={(event) => updatePhase(activePhase.id, "color", event.target.value)} />
          <code>{activePhase.color}</code>
        </div>
      </Field>
      <Toggle label="Visible" checked={activePhase.visible} onChange={(value) => updatePhase(activePhase.id, "visible", value)} />
      <Toggle label="Annotations supérieures" checked={activePhase.inAnnot} onChange={(value) => updatePhase(activePhase.id, "inAnnot", value)} />
      <Toggle label="Panneau PDF" checked={activePhase.inPanel} onChange={(value) => updatePhase(activePhase.id, "inPanel", value)} />
      <div className="info-box"><span>{activePhase.peaks.length} pics</span><span>{activePhase.files.join(", ")}</span></div>
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
      <Toggle label="Ligne verticale" checked={activeNote.vline} onChange={(value) => updateNote(activeNote.id, "vline", value)} />
    </Section>
  ) : <EmptyPanel title="Aucune sélection" body="Sélectionner un patron, une phase ou une note dans le panneau Projet." />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div><strong>Make Figure</strong><span>DRX · Raman · v4</span></div>
        </div>
        <div className="topbar__divider" />
        <div className="mode-switch" aria-label="Mode d’analyse">
          {[["drx", "DRX"], ["raman", "Raman"]].map(([value, label]) => (
            <button type="button" key={value} className={S.mode === value ? "is-active" : ""} onClick={() => setMode(value)}>{label}</button>
          ))}
        </div>
        <div className="topbar__divider" />
        <div className="topbar__group">
          <IconButton icon="undo" title="Annuler · Ctrl+Z" disabled={!history.canUndo} onClick={history.undo} />
          <IconButton icon="redo" title="Rétablir · Ctrl+Shift+Z" disabled={!history.canRedo} onClick={history.redo} />
        </div>
        <div className="topbar__group">
          <Button icon="plus" onClick={createNewProject}>Nouveau</Button>
          <Button icon="folder" onClick={() => sessionInputRef.current?.click()}>Ouvrir</Button>
          <Button icon="save" onClick={saveSessionFile}>Sauver</Button>
        </div>
        <div className="topbar__spacer" />
        <div className={`autosave-state autosave-state--${autosaveState}`}>
          <span />
          {autosaveState === "saving" ? "Enregistrement" : autosaveState === "error" ? "Autosauvegarde indisponible" : "Sauvegardé localement"}
        </div>
        <div className="topbar__group">
          <Button variant="secondary" disabled={isExporting} onClick={downloadSvg}>SVG</Button>
          <Button variant="primary" icon="download" disabled={isExporting} onClick={downloadPng}>{isExporting ? "Export…" : "Exporter PNG"}</Button>
        </div>
      </header>

      <main className="workbench" style={{ gridTemplateColumns: `${leftWidth}px minmax(300px, 1fr) ${rightWidth}px` }}>
        <aside className="side-panel side-panel--left">
          <div className="panel-titlebar"><strong>Projet</strong><span>{patterns.length + phases.length + notes.length} éléments</span></div>
          <nav className="panel-tabs">
            {[["patterns", "Patrons", patterns.length], ["phases", "Phases", phases.length], ["notes", "Notes", notes.length]].map(([value, label, count]) => (
              <button type="button" key={value} className={leftTab === value ? "is-active" : ""} onClick={() => setLeftTab(value)}>{label}<span>{count}</span></button>
            ))}
          </nav>
          <div className="side-panel__content">
            {leftTab === "patterns" && (
              <>
                <button type="button" className="drop-button" onClick={() => patternInputRef.current?.click()}><Icon name="upload" /><span><strong>Importer des patrons</strong><small>.xy · .txt · .csv · .dat</small></span></button>
                <div className="data-list">
                  {patterns.length ? patterns.map((pattern, index) => (
                    <PatternItem
                      key={pattern.id}
                      pattern={pattern}
                      index={index}
                      color={colorMap.get(pattern.id) || pattern.color}
                      selected={selection?.type === "pattern" && selection.id === pattern.id}
                      onSelect={() => { setSelection({ type: "pattern", id: pattern.id }); setRightTab("selection"); }}
                      onUpdate={(key, value) => updatePattern(pattern.id, key, value)}
                      onDelete={() => { history.set((current) => ({ ...current, patterns: current.patterns.filter((item) => item.id !== pattern.id) })); if (selection?.id === pattern.id) setSelection(null); }}
                      onDragStart={(event, id) => handleDataDragStart(event, "pattern", id)}
                      onDrop={(event, id) => handleDataDrop(event, "pattern", id)}
                    />
                  )) : <EmptyPanel title="Aucun patron" body="Importer des données expérimentales ou déposer les fichiers dans l’espace central." />}
                </div>
              </>
            )}
            {leftTab === "phases" && (
              <>
                <button type="button" className="drop-button" onClick={() => phaseInputRef.current?.click()}><Icon name="upload" /><span><strong>Importer des phases</strong><small>.dif EVA ou liste 2θ / I</small></span></button>
                <div className="data-list">
                  {phases.length ? phases.map((phase) => (
                    <PhaseItem
                      key={phase.id}
                      phase={phase}
                      selected={selection?.type === "phase" && selection.id === phase.id}
                      onSelect={() => { setSelection({ type: "phase", id: phase.id }); setRightTab("selection"); }}
                      onUpdate={(key, value) => updatePhase(phase.id, key, value)}
                      onDelete={() => { history.set((current) => ({ ...current, phases: current.phases.filter((item) => item.id !== phase.id) })); if (selection?.id === phase.id) setSelection(null); }}
                      onAppend={() => { appendTargetRef.current = phase.id; appendPhaseInputRef.current?.click(); }}
                      onDragStart={(event, id) => handleDataDragStart(event, "phase", id)}
                      onDrop={(event, id) => handleDataDrop(event, "phase", id)}
                    />
                  )) : <EmptyPanel title="Aucune phase" body="Importer des fiches .dif ou des listes de pics texte." />}
                </div>
              </>
            )}
            {leftTab === "notes" && (
              <>
                <button type="button" className={`drop-button ${addNoteMode ? "is-active" : ""}`} onClick={() => { setAddNoteMode((value) => !value); setTool("cursor"); }}><Icon name="note" /><span><strong>{addNoteMode ? "Cliquer sur la figure…" : "Ajouter une note"}</strong><small>Placement interactif</small></span></button>
                <div className="data-list">
                  {notes.length ? notes.map((note) => (
                    <NoteItem
                      key={note.id}
                      note={note}
                      selected={selection?.type === "note" && selection.id === note.id}
                      onSelect={() => { setSelection({ type: "note", id: note.id }); setRightTab("selection"); }}
                      onUpdate={(key, value) => updateNote(note.id, key, value)}
                      onDelete={() => { history.set((current) => ({ ...current, notes: current.notes.filter((item) => item.id !== note.id) })); if (selection?.id === note.id) setSelection(null); }}
                    />
                  )) : <EmptyPanel title="Aucune note" body="Activer le placement puis cliquer dans la zone principale de la figure." />}
                </div>
              </>
            )}
          </div>
          <Resizer side="left" onResize={{ currentWidth: () => leftWidth, apply: (value) => setLeftWidth(clamp(value, 240, 520)) }} />
        </aside>

        <section className="canvas-column">
          <div className="canvas-toolbar">
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
            {dropActive && <div className="drop-overlay"><Icon name="upload" size={30} /><strong>Déposer les fichiers</strong><span>Les .dif seront importés comme phases ; les autres comme patrons.</span></div>}
            {!visibleCount ? (
              <div className="welcome-card">
                <Logo />
                <span className="welcome-card__eyebrow">Nouveau projet</span>
                <h1>Construire une figure DRX ou Raman</h1>
                <p>Importer des patrons expérimentaux, ajouter les phases de référence, régler le traitement puis exporter une figure vectorielle ou bitmap.</p>
                <div className="welcome-card__actions">
                  <Button variant="primary" icon="upload" onClick={() => patternInputRef.current?.click()}>Importer des patrons</Button>
                  <Button variant="secondary" onClick={() => phaseInputRef.current?.click()}>Ajouter des phases</Button>
                </div>
                <div className="welcome-card__privacy">Traitement exclusivement local dans le navigateur.</div>
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
                        <g key={pattern.id} opacity={selection?.type === "pattern" && selection.id !== pattern.id ? 0.82 : 1}>
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

                    {notes.map((note) => {
                      const x = xToPx(note.x);
                      const y = M.top + mainHeight * (1 - note.yFrac);
                      return (
                        <g key={note.id} opacity={selection?.type === "note" && selection.id === note.id ? 1 : 0.92}>
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
                          return (
                            <g key={phase.id}>
                              {phase.peaks.map(([x, intensity], index) => x >= S.xmin && x <= S.xmax ? (
                                <line key={index} x1={xToPx(x)} x2={xToPx(x)} y1={rowTop + rowHeight - 4} y2={rowTop + rowHeight - 4 - (intensity / 100) * rowHeight * 0.78} stroke={phase.color} strokeWidth={S.pdfStickW} opacity="0.9" />
                              ) : null)}
                              {S.showRowLabels && <><text x={M.left + 8} y={rowTop + rowHeight * 0.3} fontSize="10.5" fontWeight="700" fill={phase.color} fontFamily="Arial, Helvetica, sans-serif">{phase.name}</text><text x={M.left + 8} y={rowTop + rowHeight * 0.3 + 12} fontSize="7.5" fontStyle="italic" fill={phase.color} fontFamily="Arial, Helvetica, sans-serif">{phase.files.map(cardNumber).join(", ")}</text></>}
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
                          return <g><rect x={boxX} y={boxY} width={boxWidth} height={boxHeight} fill="#ffffff" opacity="0.92" stroke="#aeb4bb" strokeWidth="0.7" rx="3"/><text x={boxX + boxWidth / 2} y={boxY + 14} textAnchor="middle" fontSize="9" fontWeight="700" fill="#343a40">Références PDF</text>{panelPhases.map((phase, index) => <g key={phase.id}><line x1={boxX + 9} x2={boxX + 27} y1={boxY + 24 + index * lineHeight} y2={boxY + 24 + index * lineHeight} stroke={phase.color} strokeWidth="2"/><text x={boxX + 34} y={boxY + 27 + index * lineHeight} fontSize="8" fill="#20252b">{phase.name} — {phase.files.map(cardNumber).join(", ")}</text></g>)}</g>;
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
            <span><strong>{patterns.length}</strong> patrons</span>
            <span><strong>{phases.length}</strong> phases</span>
            <span><strong>{visibleCount}</strong> visibles</span>
            <span><strong>{processed.reduce((sum, pattern) => sum + (pattern.detectedPeaks?.length || 0), 0)}</strong> pics détectés</span>
            <span>{LAYOUT_OPTIONS.find(([value]) => value === S.layoutMode)?.[1]}</span>
            <span className="statusbar__spacer" />
            {cursor ? <><span>x = <strong>{cursor.dataX.toFixed(S.mode === "drx" ? 3 : 1)}</strong></span>{cursor.nearest && <span>{activePattern?.label}: <strong>{cursor.nearest.y.toFixed(4)}</strong></span>}</> : <span>Déplacer le curseur sur la figure pour lire les coordonnées.</span>}
          </footer>
        </section>

        <aside className="side-panel side-panel--right">
          <Resizer side="right" onResize={{ currentWidth: () => rightWidth, apply: (value) => setRightWidth(clamp(value, 270, 520)) }} />
          <div className="panel-titlebar"><strong>Propriétés</strong><span>{selection ? "Sélection active" : "Figure"}</span></div>
          <nav className="panel-tabs panel-tabs--right">
            {[ ["figure", "Figure"], ["signal", "Signal"], ["references", "Références"], ["selection", "Sélection"], ["export", "Export"] ].map(([value, label]) => <button type="button" key={value} className={rightTab === value ? "is-active" : ""} onClick={() => setRightTab(value)}>{label}</button>)}
          </nav>
          <div className="side-panel__content properties-scroll">
            {rightTab === "figure" && (
              <>
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
                  {S.layoutMode === "waterfall" && <NumberField label="Décalage X par patron" value={S.waterfallXShift} min={-1000} max={1000} step={S.mode === "drx" ? 0.02 : 2} onChange={(value) => patchSettings("waterfallXShift", value)} />}
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

            {rightTab === "signal" && (
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
                  <div className="inline-actions"><Button variant="primary" onClick={alignVisiblePatterns}>Aligner les patrons visibles</Button><Button variant="secondary" icon="reset" onClick={() => history.set((current) => ({ ...current, patterns: current.patterns.map((pattern) => ({ ...pattern, xoffset: (Number(pattern.xoffset) || 0) - (Number(pattern.alignmentShift) || 0), alignmentShift: 0, alignmentScore: undefined, alignmentReference: undefined })) }))}>Retirer l’alignement auto</Button></div>
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
                <Section title="Panneau PDF">
                  <Toggle label="Afficher le panneau" checked={S.showPdfPanel} onChange={(value) => patchSettings("showPdfPanel", value)} />
                  {S.showPdfPanel && <><SliderField label="Hauteur" value={S.pdfPanelH} min={60} max={500} step={10} suffix="px" onChange={(value) => patchSettings("pdfPanelH", value)} /><SliderField label="Épaisseur des bâtonnets" value={S.pdfStickW} min={0.3} max={4} step={0.05} onChange={(value) => patchSettings("pdfStickW", value)} /><Toggle label="Noms des lignes" checked={S.showRowLabels} onChange={(value) => patchSettings("showRowLabels", value)} /><Toggle label="Encart de légende" checked={S.showPdfLegend} onChange={(value) => patchSettings("showPdfLegend", value)} /></>}
                </Section>
              </>
            )}

            {rightTab === "selection" && renderPatternProperties()}

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
                  <div className="export-grid"><Button variant="primary" icon="download" disabled={isExporting} onClick={downloadPng}>PNG</Button><Button variant="secondary" disabled={isExporting} onClick={downloadSvg}>SVG</Button><Button variant="secondary" disabled={isExporting} onClick={downloadPdf}>PDF</Button><Button variant="secondary" disabled={isExporting} onClick={downloadTiff}>TIFF</Button><Button variant="secondary" icon="csv" onClick={exportProcessedCsv}>CSV traité</Button><Button variant="secondary" icon="csv" onClick={exportDetectedPeaksCsv}>CSV pics</Button><Button variant="secondary" icon="save" onClick={saveSessionFile}>Session JSON</Button></div>
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

      {message && <div className="toast"><span>{message}</span><button type="button" onClick={() => setMessage("")}><Icon name="close" size={14} /></button></div>}
      {addNoteMode && <div className="mode-banner"><Icon name="note" /><span>Cliquer dans la zone principale de la figure pour placer la note.</span><button type="button" onClick={() => setAddNoteMode(false)}>Annuler</button></div>}
    </div>
  );
}
