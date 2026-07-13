import React, { useState, useRef, useMemo, useEffect } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   Générateur de figures DRX / Raman — interface v2
   Thème « instrument » : ardoise froide, accent cuivre (Cu Kα), monospace
   pour les valeurs. Logique de traitement et de tracé inchangée.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Thème ───────────────────────────────────────────────────────────────── */

const T = {
  bg: "#0c1015",
  panel: "#12171f",
  card: "#181f2a",
  card2: "#1e2734",
  line: "#242e3b",
  line2: "#33404f",
  text: "#e7ecf3",
  mut: "#94a0b3",
  dim: "#5b6878",
  acc: "#cf8a52",
  accHi: "#e5a670",
  accBg: "rgba(207,138,82,0.13)",
  danger: "#e0605e",
  ok: "#63b27f",
};
const FD = "'Space Grotesk', 'Archivo', system-ui, sans-serif";
const FM = "'IBM Plex Mono', ui-monospace, 'Cascadia Code', Consolas, monospace";

/* ─── Parsers ─────────────────────────────────────────────────────────────── */

function parseXYText(text) {
  const xs = [], ys = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/[\s,;\t]+/);
    if (parts.length < 2) continue;
    const a = parseFloat(parts[0].replace(",", "."));
    const b = parseFloat(parts[1].replace(",", "."));
    if (Number.isFinite(a) && Number.isFinite(b)) { xs.push(a); ys.push(b); }
  }
  return { x: xs, y: ys };
}

function parseDIFBinary(buf) {
  try {
    if (buf.byteLength < 0x2d4) return [];
    const dv = new DataView(buf);
    const n = dv.getUint32(0x02d0, true);
    const rs = dv.getUint32(0x02cc, true);
    if (!n || !rs || n * rs > buf.byteLength) return [];
    const ds = buf.byteLength - n * rs;
    const peaks = [];
    for (let i = 0; i < n; i++) {
      const off = ds + i * rs;
      const t2 = dv.getFloat64(off, true);
      const ii = dv.getFloat32(off + 8, true);
      if (t2 >= 2 && t2 <= 130 && ii > 0 && Number.isFinite(t2) && Number.isFinite(ii)) peaks.push([t2, ii]);
    }
    return normalizePeaks(peaks);
  } catch { return []; }
}

function parsePeaksText(text) {
  const { x, y } = parseXYText(text);
  return normalizePeaks(x.map((t, i) => [t, y[i]]));
}

function normalizePeaks(peaks) {
  if (!peaks.length) return [];
  let mx = 0;
  for (const p of peaks) if (p[1] > mx) mx = p[1];
  if (mx <= 0) return [];
  return peaks.map(([t, i]) => [t, (i / mx) * 100]).sort((a, b) => a[0] - b[0]);
}

function mergeDedupPeaks(listA, listB, sep = 0.12) {
  const all = [...listA, ...listB].sort((a, b) => a[0] - b[0]);
  if (!all.length) return [];
  let mx = 0;
  for (const p of all) if (p[1] > mx) mx = p[1];
  const norm = all.map(([t, i]) => [t, (i / mx) * 100]);
  const out = [norm[0]];
  for (let i = 1; i < norm.length; i++) {
    if (norm[i][0] - out[out.length - 1][0] > sep) out.push(norm[i]);
    else if (norm[i][1] > out[out.length - 1][1]) out[out.length - 1] = norm[i];
  }
  return out;
}

/* ─── Traitement du signal ────────────────────────────────────────────────── */

function movingAverage(y, w) {
  if (w <= 1) return y.slice();
  const half = Math.floor(w / 2);
  const out = new Array(y.length);
  for (let i = 0; i < y.length; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(y.length - 1, i + half); j++) { sum += y[j]; cnt++; }
    out[i] = sum / cnt;
  }
  return out;
}

function percentile(arr, p) {
  const s = arr.slice().sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function downsampleMinMax(x, y, nBuckets) {
  const n = x.length;
  if (n <= nBuckets * 2) return { x, y };
  const bs = Math.ceil(n / nBuckets);
  const ox = [], oy = [];
  for (let s = 0; s < n; s += bs) {
    const e = Math.min(s + bs, n);
    let iMin = s, iMax = s;
    for (let i = s + 1; i < e; i++) {
      if (y[i] < y[iMin]) iMin = i;
      if (y[i] > y[iMax]) iMax = i;
    }
    const a = Math.min(iMin, iMax), b = Math.max(iMin, iMax);
    ox.push(x[a]); oy.push(y[a]);
    if (b !== a) { ox.push(x[b]); oy.push(y[b]); }
  }
  return { x: ox, y: oy };
}

/* ─── Colormaps ───────────────────────────────────────────────────────────── */

const CMAPS = {
  plasma: ["#0d0887", "#5b02a3", "#9a179b", "#cb4679", "#ed7953", "#fdb32f", "#f0f921"],
  viridis: ["#440154", "#46327e", "#365c8d", "#277f8e", "#1fa187", "#4ac16d", "#a0da39", "#fde725"],
  inferno: ["#000004", "#320a5e", "#781c6d", "#bc3754", "#ed6925", "#fbb61a", "#fcffa4"],
  magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  cividis: ["#00224e", "#35456c", "#666970", "#948e77", "#c8b866", "#fee838"],
  turbo: ["#30123b", "#4662d7", "#36bbce", "#5fe962", "#d9e735", "#fb8022", "#7a0403"],
  bleus: ["#08306b", "#2171b5", "#6baed6", "#c6dbef"],
  gris: ["#111111", "#555555", "#999999", "#cccccc"],
};

function hexToRgb(h) {
  const m = h.replace("#", "");
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function cmapColor(name, t) {
  const stops = CMAPS[name] || CMAPS.plasma;
  const tt = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(tt), stops.length - 2);
  const f = tt - i;
  const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
  return rgbToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}
function cmapGradient(name, lo, hi, rev) {
  const cols = Array.from({ length: 12 }, (_, i) => {
    let t = lo + (hi - lo) * (i / 11);
    if (rev) t = lo + hi - t;
    return cmapColor(name, t);
  });
  return `linear-gradient(to right, ${cols.join(",")})`;
}

/* ─── Réglages par défaut ─────────────────────────────────────────────────── */

const DEFAULTS = {
  drx: { xmin: 10, xmax: 58, xlabel: "2θ (°, Cu Kα, λ = 1.5406 Å)" },
  raman: { xmin: 100, xmax: 1800, xlabel: "Décalage Raman (cm⁻¹)" },
};

const initialSettings = {
  mode: "drx",
  title: "",
  xmin: 10, xmax: 58,
  xlabel: DEFAULTS.drx.xlabel,
  ylabel: "Intensité (normalisée, décalée)",
  xTickStep: 0,
  showGrid: false,
  smoothW: 3,
  clipPct: 99.5,
  normalize: true,
  vstep: 1.25,
  pxPerUnit: 80,
  lineWidth: 0.9,
  showFill: true,
  fillAlpha: 0.08,
  reverseStack: false,
  cmap: "plasma",
  cmapMin: 0.05, cmapMax: 0.85,
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
  pdfStickW: 1.0,
  showPdfLegend: true,
  showRowLabels: true,
  axisFontSize: 13,
  tickFontSize: 11,
  titleFontSize: 15,
  rightMargin: 135,
  figWidth: 1100,
  pngScale: 2,
  fileName: "figure_stacked",
};

let _id = 1;
const nid = () => `id${_id++}_${Date.now() % 100000}`;
const PHASE_COLORS = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#8c564b", "#e377c2", "#17becf"];

/* ─── Contrôles UI ────────────────────────────────────────────────────────── */

function SNum({ label, value, set, min = 0, max = 100, step = 1 }) {
  return (
    <div className="flex flex-col gap-1 py-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: T.mut }}>{label}</span>
        <input
          type="number" value={value} step={step}
          onChange={(e) => set(parseFloat(e.target.value))}
          className="w-16 rounded px-1.5 py-0.5 text-right text-[11px] focus:outline-none"
          style={{ background: T.card2, border: `1px solid ${T.line}`, color: T.text, fontFamily: FM }}
        />
      </div>
      <input
        type="range" value={value} min={min} max={max} step={step}
        onChange={(e) => set(parseFloat(e.target.value))}
        className="w-full h-1"
        style={{ accentColor: T.acc }}
      />
    </div>
  );
}

function Num({ label, value, set, step = 1, min, max }) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-[11px]" style={{ color: T.mut }}>{label}</span>
      <input
        type="number" value={value} step={step} min={min} max={max}
        onChange={(e) => set(parseFloat(e.target.value))}
        className="w-20 rounded px-1.5 py-1 text-right text-[11px] focus:outline-none"
        style={{ background: T.card2, border: `1px solid ${T.line}`, color: T.text, fontFamily: FM }}
      />
    </label>
  );
}

function Txt({ label, value, set }) {
  return (
    <label className="flex flex-col gap-1 py-0.5">
      <span className="text-[11px]" style={{ color: T.mut }}>{label}</span>
      <input
        type="text" value={value} onChange={(e) => set(e.target.value)}
        className="w-full rounded px-2 py-1.5 text-xs focus:outline-none"
        style={{ background: T.card2, border: `1px solid ${T.line}`, color: T.text }}
      />
    </label>
  );
}

function Tgl({ label, value, set }) {
  return (
    <button onClick={() => set(!value)} className="flex items-center justify-between w-full py-1 group">
      <span className="text-[11px] text-left" style={{ color: T.mut }}>{label}</span>
      <span className="relative inline-block flex-shrink-0 rounded-full transition-colors"
        style={{ width: 30, height: 16, background: value ? T.acc : T.line2 }}>
        <span className="absolute rounded-full transition-transform"
          style={{
            width: 12, height: 12, top: 2, left: 2, background: value ? "#fff" : T.mut,
            transform: value ? "translateX(14px)" : "translateX(0)",
          }} />
      </span>
    </button>
  );
}

function Sel({ label, value, set, options }) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-[11px]" style={{ color: T.mut }}>{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)}
        className="rounded px-1.5 py-1 text-[11px] focus:outline-none"
        style={{ background: T.card2, border: `1px solid ${T.line}`, color: T.text, fontFamily: FM }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Group({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg overflow-hidden mb-2" style={{ background: T.card, border: `1px solid ${T.line}` }}>
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-left">
        <span className="text-[10px] font-bold uppercase" style={{ color: open ? T.accHi : T.mut, letterSpacing: "0.12em", fontFamily: FD }}>
          {title}
        </span>
        <span className="text-xs" style={{ color: T.dim }}>{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-0.5" style={{ borderTop: `1px solid ${T.line}` }}>
        <div className="pt-2 flex flex-col gap-0.5">{children}</div>
      </div>}
    </div>
  );
}

function IconBtn({ onClick, children, danger, title }) {
  return (
    <button onClick={onClick} title={title}
      className="w-6 h-6 flex items-center justify-center rounded text-xs flex-shrink-0 transition-colors"
      style={{ color: danger ? T.danger : T.dim }}
      onMouseEnter={(e) => e.currentTarget.style.color = danger ? "#ff8a88" : T.text}
      onMouseLeave={(e) => e.currentTarget.style.color = danger ? T.danger : T.dim}>
      {children}
    </button>
  );
}

function EyeBtn({ on, toggle }) {
  return (
    <button onClick={toggle} title={on ? "Masquer" : "Afficher"}
      className="w-6 h-6 flex items-center justify-center rounded flex-shrink-0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke={on ? T.acc : T.dim} strokeWidth="2">
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
        {on && <circle cx="12" cy="12" r="3" fill={T.acc} stroke="none" />}
        {!on && <line x1="4" y1="20" x2="20" y2="4" />}
      </svg>
    </button>
  );
}

function Chip({ on, toggle, children }) {
  return (
    <button onClick={toggle}
      className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide flex-shrink-0"
      style={{
        background: on ? T.accBg : "transparent",
        border: `1px solid ${on ? T.acc : T.line2}`,
        color: on ? T.accHi : T.dim,
      }}>
      {children}
    </button>
  );
}

function UploadZone({ onClick, children }) {
  return (
    <button onClick={onClick}
      className="w-full rounded-lg py-3 text-[11px] mb-2 transition-colors"
      style={{ border: `1.5px dashed ${T.line2}`, color: T.mut }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.acc; e.currentTarget.style.color = T.accHi; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.line2; e.currentTarget.style.color = T.mut; }}>
      {children}
    </button>
  );
}

/* Logo : trois pics empilés */
function Logo() {
  return (
    <svg width="30" height="26" viewBox="0 0 30 26">
      {[0, 1, 2].map((i) => (
        <path key={i}
          d={`M2 ${21 - i * 6} L10 ${21 - i * 6} L13 ${10 - i * 6 + 4} L16 ${21 - i * 6} L21 ${21 - i * 6} L23 ${16 - i * 6 + 2} L25 ${21 - i * 6} L28 ${21 - i * 6}`}
          fill="none"
          stroke={cmapColor("plasma", 0.15 + i * 0.32)}
          strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}

/* ─── Composant principal ─────────────────────────────────────────────────── */

export default function App() {
  const [settings, setSettings] = useState(initialSettings);
  const [patterns, setPatterns] = useState([]);
  const [phases, setPhases] = useState([]);
  const [notes, setNotes] = useState([]);
  const [addNoteMode, setAddNoteMode] = useState(false);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState("data");

  const svgRef = useRef(null);
  const patternFileRef = useRef(null);
  const phaseFileRef = useRef(null);
  const sessionFileRef = useRef(null);
  const appendPhaseRef = useRef(null);
  const appendTargetRef = useRef(null);

  const S = settings;
  const upd = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 6000);
    return () => clearTimeout(t);
  }, [msg]);

  const setMode = (mode) => {
    const d = DEFAULTS[mode];
    setSettings((s) => ({ ...s, mode, xmin: d.xmin, xmax: d.xmax, xlabel: d.xlabel }));
  };

  /* ── Imports ── */

  const onPatternFiles = async (files) => {
    const added = [];
    for (const f of files) {
      const text = await f.text();
      const { x, y } = parseXYText(text);
      if (x.length < 5) { setMsg(`Fichier ignoré (données insuffisantes) : ${f.name}`); continue; }
      added.push({
        id: nid(),
        label: f.name.replace(/\.(xy|txt|csv|dat)$/i, ""),
        fileName: f.name, x, y,
        visible: true, color: "#000000", yscale: 1, xoffset: 0,
      });
    }
    if (added.length) setPatterns((p) => [...p, ...added]);
  };

  const readPhaseFile = async (f) => {
    if (/\.dif$/i.test(f.name)) {
      const buf = await f.arrayBuffer();
      let peaks = parseDIFBinary(buf);
      if (!peaks.length) {
        try { peaks = parsePeaksText(new TextDecoder("latin1").decode(buf)); } catch { /* noop */ }
      }
      return peaks;
    }
    return parsePeaksText(await f.text());
  };

  const cardNumber = (name) => {
    const m = name.match(/\d{2}-\d{3}-\d{4,}/);
    return m ? m[0] : name;
  };

  const onPhaseFiles = async (files) => {
    const added = [];
    for (const f of files) {
      const peaks = await readPhaseFile(f);
      if (!peaks.length) { setMsg(`Aucun pic lu dans : ${f.name}`); continue; }
      const guess = f.name.replace(/\.(dif|txt|csv|dat)$/i, "").replace(/^PDF\s*/i, "");
      added.push({
        id: nid(),
        name: guess, abbrev: guess.slice(0, 3),
        color: PHASE_COLORS[(phases.length + added.length) % PHASE_COLORS.length],
        peaks, files: [f.name],
        visible: true, inAnnot: true, inPanel: true,
      });
    }
    if (added.length) setPhases((p) => [...p, ...added]);
  };

  const onAppendPhaseFile = async (files) => {
    const target = appendTargetRef.current;
    if (!target || !files.length) return;
    const f = files[0];
    const peaks = await readPhaseFile(f);
    if (!peaks.length) { setMsg(`Aucun pic lu dans : ${f.name}`); return; }
    setPhases((ps) => ps.map((ph) =>
      ph.id === target
        ? { ...ph, peaks: mergeDedupPeaks(ph.peaks, peaks), files: [...ph.files, f.name] }
        : ph
    ));
  };

  /* ── Session ── */

  const saveSession = () => {
    const blob = new Blob([JSON.stringify({ settings, patterns, phases, notes })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${S.fileName}_session.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const loadSession = async (files) => {
    try {
      const obj = JSON.parse(await files[0].text());
      if (obj.settings) setSettings({ ...initialSettings, ...obj.settings });
      if (obj.patterns) setPatterns(obj.patterns);
      if (obj.phases) setPhases(obj.phases);
      if (obj.notes) setNotes(obj.notes);
      setMsg("Session restaurée.");
    } catch { setMsg("Fichier de session invalide."); }
  };

  /* ── Calculs de tracé ── */

  const visPatterns = patterns.filter((p) => p.visible);
  const N = visPatterns.length;

  const processed = useMemo(() => {
    return visPatterns.map((p, idx) => {
      const xs = [], ys = [];
      const dx = p.xoffset || 0;
      for (let i = 0; i < p.x.length; i++) {
        const xv = p.x[i] + dx;
        if (xv >= S.xmin && xv <= S.xmax) { xs.push(xv); ys.push(p.y[i]); }
      }
      if (xs.length < 5) return { ...p, px: [], py: [], stackIdx: idx };
      let y = movingAverage(ys, Math.max(1, Math.round(S.smoothW)));
      if (S.clipPct < 100) {
        const top = percentile(y, S.clipPct);
        y = y.map((v) => Math.min(v, top));
      }
      if (S.normalize) {
        let mn = Infinity, mx = -Infinity;
        for (const v of y) { if (v < mn) mn = v; if (v > mx) mx = v; }
        const rg = mx - mn || 1e-9;
        y = y.map((v) => (v - mn) / rg);
      }
      y = y.map((v) => v * (p.yscale || 1));
      const ds = downsampleMinMax(xs, y, 1800);
      return { ...p, px: ds.x, py: ds.y, stackIdx: idx };
    });
  }, [visPatterns, S.xmin, S.xmax, S.smoothW, S.clipPct, S.normalize]);

  const colorOf = (idx) => {
    const p = processed[idx];
    if (S.useCustomColors && p && p.color) return p.color;
    if (N <= 1) return cmapColor(S.cmap, S.cmapReverse ? S.cmapMax : S.cmapMin);
    let t = S.cmapMin + (S.cmapMax - S.cmapMin) * (idx / (N - 1));
    if (S.cmapReverse) t = S.cmapMin + S.cmapMax - t;
    return cmapColor(S.cmap, t);
  };

  const annotY0 = (N - 1) * S.vstep + S.annotGap;
  const yMax = S.showAnnotations && phases.some((p) => p.visible && p.inAnnot)
    ? annotY0 + S.tickScale + 0.55
    : (N - 1) * S.vstep + 1.25;
  const yMin = -0.15;

  const M = { l: 55, r: S.rightMargin, t: S.title ? 40 : 18, gap: 8, axisH: 44 };
  const mainH = Math.max(240, (yMax - yMin) * S.pxPerUnit);
  const panelH = S.showPdfPanel && phases.some((p) => p.visible && p.inPanel) ? S.pdfPanelH : 0;
  const W = S.figWidth;
  const H = M.t + mainH + (panelH ? M.gap + panelH : 0) + M.axisH;
  const plotW = W - M.l - M.r;

  const xToPx = (x) => M.l + ((x - S.xmin) / (S.xmax - S.xmin)) * plotW;
  const yToPx = (y) => M.t + mainH - ((y - yMin) / (yMax - yMin)) * mainH;

  const xTicks = useMemo(() => {
    const range = S.xmax - S.xmin;
    let step = S.xTickStep > 0 ? S.xTickStep : null;
    if (!step) {
      const raw = range / 9;
      const pow = Math.pow(10, Math.floor(Math.log10(raw)));
      const cands = [1, 2, 2.5, 5, 10].map((c) => c * pow);
      step = cands.find((c) => range / c <= 11) || cands[cands.length - 1];
    }
    const out = [];
    for (let t = Math.ceil(S.xmin / step) * step; t <= S.xmax + 1e-9; t += step) {
      out.push(Math.round(t * 1000) / 1000);
    }
    return out;
  }, [S.xmin, S.xmax, S.xTickStep]);

  const annotData = useMemo(() => {
    if (!S.showAnnotations) return { ticks: [], labels: [] };
    const ticks = [];
    for (const ph of phases) {
      if (!ph.visible || !ph.inAnnot) continue;
      for (const [t2, ri] of ph.peaks) {
        if (t2 >= S.xmin && t2 <= S.xmax && ri >= S.tickMinI) {
          ticks.push({ t2, ri, abb: ph.abbrev, color: ph.color });
        }
      }
    }
    const pool = ticks.filter((t) => t.ri >= S.labelMinI).sort((a, b) => b.ri - a.ri);
    const placed = [];
    for (const t of pool) {
      if (placed.every((p) => Math.abs(t.t2 - p.t2) >= S.labelMinSep)) placed.push(t);
    }
    placed.sort((a, b) => a.t2 - b.t2);
    return { ticks, labels: placed };
  }, [phases, S.showAnnotations, S.xmin, S.xmax, S.tickMinI, S.labelMinI, S.labelMinSep]);

  const panelPhases = phases.filter((p) => p.visible && p.inPanel);
  const rowH = panelPhases.length ? panelH / panelPhases.length : 0;
  const panelTop = M.t + mainH + M.gap;

  const onSvgClick = (e) => {
    if (!addNoteMode || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const sy = ((e.clientY - rect.top) / rect.height) * H;
    if (sx < M.l || sx > W - M.r || sy < M.t || sy > M.t + mainH) return;
    const x = S.xmin + ((sx - M.l) / plotW) * (S.xmax - S.xmin);
    const yFrac = 1 - (sy - M.t) / mainH;
    setNotes((n) => [...n, {
      id: nid(), x: Math.round(x * 100) / 100, yFrac: Math.round(yFrac * 1000) / 1000,
      text: "note", color: "#333333", fontSize: 10, rotation: 0, vline: false,
    }]);
    setAddNoteMode(false);
    setTab("annot");
  };

  const downloadSVG = () => {
    if (!svgRef.current) return;
    const s = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([s], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${S.fileName}.svg`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const downloadPNG = () => {
    if (!svgRef.current) return;
    const s = new XMLSerializer().serializeToString(svgRef.current);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = W * S.pngScale; c.height = H * S.pngScale;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `${S.fileName}.png`;
      a.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(s)));
  };

  const updPattern = (id, k, v) => setPatterns((ps) => ps.map((p) => p.id === id ? { ...p, [k]: v } : p));
  const movePattern = (id, dir) => setPatterns((ps) => {
    const i = ps.findIndex((p) => p.id === id);
    const j = i + dir;
    if (j < 0 || j >= ps.length) return ps;
    const c = ps.slice(); [c[i], c[j]] = [c[j], c[i]]; return c;
  });
  const updPhase = (id, k, v) => setPhases((ps) => ps.map((p) => p.id === id ? { ...p, [k]: v } : p));
  const updNote = (id, k, v) => setNotes((ns) => ns.map((n) => n.id === id ? { ...n, [k]: v } : n));

  const stackOrder = S.reverseStack ? processed.slice().reverse() : processed;
  const font = "Helvetica, Arial, sans-serif";

  const TABS = [
    { id: "data", label: "Données" },
    { id: "style", label: "Style" },
    { id: "annot", label: "Annot." },
    { id: "export", label: "Export" },
  ];

  /* ═══════════════════════════ RENDU ═══════════════════════════ */

  return (
    <div className="h-screen w-full flex flex-col" style={{ background: T.bg, color: T.text, fontFamily: FD }}>

      {/* ═══ En-tête ═══ */}
      <div className="flex items-center gap-4 px-4 flex-shrink-0"
        style={{ height: 56, background: T.panel, borderBottom: `1px solid ${T.line}` }}>
        <div className="flex items-center gap-2.5">
          <Logo />
          <div className="leading-tight">
            <div className="text-[13px] font-bold" style={{ letterSpacing: "0.02em" }}>Figures DRX · Raman</div>
            <div className="text-[9px] uppercase" style={{ color: T.dim, letterSpacing: "0.18em", fontFamily: FM }}>
              empilement — fiches PDF — export
            </div>
          </div>
        </div>

        {/* Mode */}
        <div className="flex rounded-lg overflow-hidden ml-4" style={{ border: `1px solid ${T.line2}` }}>
          {["drx", "raman"].map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest"
              style={{
                background: S.mode === m ? T.accBg : "transparent",
                color: S.mode === m ? T.accHi : T.dim,
                borderRight: m === "drx" ? `1px solid ${T.line2}` : "none",
              }}>
              {m === "drx" ? "DRX" : "Raman"}
            </button>
          ))}
        </div>

        {/* Ruban colormap (signature) */}
        <div className="hidden md:flex items-center gap-2 ml-2">
          <div className="rounded-full" style={{
            width: 110, height: 8,
            background: cmapGradient(S.cmap, S.cmapMin, S.cmapMax, S.cmapReverse),
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08)",
          }} />
          <span className="text-[9px] uppercase" style={{ color: T.dim, fontFamily: FM, letterSpacing: "0.1em" }}>{S.cmap}</span>
        </div>

        <div className="flex-1" />

        {/* Compteurs */}
        <div className="hidden lg:flex items-center gap-3 text-[10px]" style={{ color: T.dim, fontFamily: FM }}>
          <span><span style={{ color: T.mut }}>{patterns.length}</span> patrons</span>
          <span style={{ color: T.line2 }}>|</span>
          <span><span style={{ color: T.mut }}>{phases.length}</span> phases</span>
          <span style={{ color: T.line2 }}>|</span>
          <span>{W}×{Math.round(H)} px</span>
        </div>

        {/* Session */}
        <div className="flex items-center gap-1.5">
          <button onClick={saveSession}
            className="rounded-md px-2.5 py-1.5 text-[11px]"
            style={{ border: `1px solid ${T.line2}`, color: T.mut }}>
            Sauver
          </button>
          <button onClick={() => sessionFileRef.current?.click()}
            className="rounded-md px-2.5 py-1.5 text-[11px]"
            style={{ border: `1px solid ${T.line2}`, color: T.mut }}>
            Charger
          </button>
          <input ref={sessionFileRef} type="file" accept=".json" className="hidden"
            onChange={(e) => { loadSession([...e.target.files]); e.target.value = ""; }} />
        </div>

        <div style={{ width: 1, height: 26, background: T.line2 }} />

        {/* Export rapide */}
        <div className="flex items-center gap-1.5">
          <button onClick={downloadPNG}
            className="rounded-md px-3.5 py-1.5 text-[11px] font-bold"
            style={{ background: T.acc, color: "#14181f" }}>
            PNG
          </button>
          <button onClick={downloadSVG}
            className="rounded-md px-3.5 py-1.5 text-[11px] font-bold"
            style={{ border: `1px solid ${T.acc}`, color: T.accHi }}>
            SVG
          </button>
        </div>
      </div>

      {/* ═══ Corps ═══ */}
      <div className="flex flex-1 min-h-0">

        {/* ── Barre latérale ── */}
        <div className="w-80 flex-shrink-0 flex flex-col min-h-0"
          style={{ background: T.panel, borderRight: `1px solid ${T.line}` }}>

          {/* Onglets */}
          <div className="flex flex-shrink-0 px-2 pt-2 gap-1" style={{ borderBottom: `1px solid ${T.line}` }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="flex-1 pb-2 pt-1.5 text-[11px] font-bold rounded-t-md"
                style={{
                  color: tab === t.id ? T.text : T.dim,
                  background: tab === t.id ? T.card : "transparent",
                  borderBottom: tab === t.id ? `2px solid ${T.acc}` : "2px solid transparent",
                }}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2">

            {/* ═══ Onglet Données ═══ */}
            {tab === "data" && (
              <>
                <Group title={`Patrons — ${patterns.length}`}>
                  <UploadZone onClick={() => patternFileRef.current?.click()}>
                    + Importer .xy · .txt · .csv (multiple)
                  </UploadZone>
                  <input ref={patternFileRef} type="file" accept=".xy,.txt,.csv,.dat" multiple className="hidden"
                    onChange={(e) => { onPatternFiles([...e.target.files]); e.target.value = ""; }} />
                  {patterns.map((p) => {
                    const vi = visPatterns.findIndex((q) => q.id === p.id);
                    const swatch = p.visible
                      ? (S.useCustomColors ? p.color : (vi >= 0 ? colorOf(vi) : T.dim))
                      : T.line2;
                    return (
                      <div key={p.id} className="rounded-md p-2 mb-1.5"
                        style={{ background: T.card2, border: `1px solid ${T.line}`, opacity: p.visible ? 1 : 0.55 }}>
                        <div className="flex items-center gap-1.5">
                          {S.useCustomColors ? (
                            <input type="color" value={p.color} onChange={(e) => updPattern(p.id, "color", e.target.value)}
                              className="w-4 h-4 rounded-full flex-shrink-0 cursor-pointer border-0 p-0"
                              style={{ background: "transparent" }} />
                          ) : (
                            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: swatch }} />
                          )}
                          <input type="text" value={p.label} onChange={(e) => updPattern(p.id, "label", e.target.value)}
                            className="flex-1 min-w-0 rounded px-1.5 py-0.5 text-xs focus:outline-none"
                            style={{ background: "transparent", border: `1px solid transparent`, color: T.text }}
                            onFocus={(e) => e.target.style.borderColor = T.line2}
                            onBlur={(e) => e.target.style.borderColor = "transparent"} />
                          <EyeBtn on={p.visible} toggle={() => updPattern(p.id, "visible", !p.visible)} />
                          <IconBtn onClick={() => movePattern(p.id, -1)} title="Monter">↑</IconBtn>
                          <IconBtn onClick={() => movePattern(p.id, +1)} title="Descendre">↓</IconBtn>
                          <IconBtn onClick={() => setPatterns((ps) => ps.filter((q) => q.id !== p.id))} danger title="Supprimer">×</IconBtn>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1.5 pl-4">
                          <span className="truncate text-[9px]" style={{ color: T.dim, fontFamily: FM }}>
                            {p.fileName} · {p.x.length} pts
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0 text-[9px]" style={{ color: T.dim, fontFamily: FM }}>
                            <label className="flex items-center gap-1" title="Facteur d'échelle vertical">×
                              <input type="number" step={0.1} value={p.yscale}
                                onChange={(e) => updPattern(p.id, "yscale", parseFloat(e.target.value) || 1)}
                                className="w-11 rounded px-1 text-right focus:outline-none"
                                style={{ background: T.card, border: `1px solid ${T.line}`, color: T.mut, fontFamily: FM }} />
                            </label>
                            <label className="flex items-center gap-1" title="Décalage horizontal">Δx
                              <input type="number" step={0.05} value={p.xoffset ?? 0}
                                onChange={(e) => updPattern(p.id, "xoffset", parseFloat(e.target.value) || 0)}
                                className="w-12 rounded px-1 text-right focus:outline-none"
                                style={{ background: T.card, border: `1px solid ${T.line}`, color: T.mut, fontFamily: FM }} />
                            </label>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </Group>

                <Group title={`Phases PDF — ${phases.length}`}>
                  <UploadZone onClick={() => phaseFileRef.current?.click()}>
                    + Importer .dif (EVA binaire) ou liste 2θ / I texte
                  </UploadZone>
                  <input ref={phaseFileRef} type="file" accept=".dif,.txt,.csv,.dat" multiple className="hidden"
                    onChange={(e) => { onPhaseFiles([...e.target.files]); e.target.value = ""; }} />
                  <input ref={appendPhaseRef} type="file" accept=".dif,.txt,.csv,.dat" className="hidden"
                    onChange={(e) => { onAppendPhaseFile([...e.target.files]); e.target.value = ""; }} />
                  {phases.map((ph) => (
                    <div key={ph.id} className="rounded-md p-2 mb-1.5"
                      style={{ background: T.card2, border: `1px solid ${T.line}`, opacity: ph.visible ? 1 : 0.55 }}>
                      <div className="flex items-center gap-1.5">
                        <input type="color" value={ph.color} onChange={(e) => updPhase(ph.id, "color", e.target.value)}
                          className="w-4 h-4 rounded-full flex-shrink-0 cursor-pointer border-0 p-0"
                          style={{ background: "transparent" }} />
                        <input type="text" value={ph.name} onChange={(e) => updPhase(ph.id, "name", e.target.value)}
                          className="flex-1 min-w-0 rounded px-1.5 py-0.5 text-xs focus:outline-none"
                          style={{ background: "transparent", border: "1px solid transparent", color: T.text }}
                          onFocus={(e) => e.target.style.borderColor = T.line2}
                          onBlur={(e) => e.target.style.borderColor = "transparent"} />
                        <EyeBtn on={ph.visible} toggle={() => updPhase(ph.id, "visible", !ph.visible)} />
                        <IconBtn onClick={() => setPhases((ps) => ps.filter((q) => q.id !== ph.id))} danger title="Supprimer">×</IconBtn>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 pl-4 flex-wrap">
                        <label className="flex items-center gap-1 text-[9px]" style={{ color: T.dim, fontFamily: FM }}>abr.
                          <input type="text" value={ph.abbrev} onChange={(e) => updPhase(ph.id, "abbrev", e.target.value)}
                            className="w-10 rounded px-1 focus:outline-none"
                            style={{ background: T.card, border: `1px solid ${T.line}`, color: T.mut, fontFamily: FM }} />
                        </label>
                        <Chip on={ph.inAnnot} toggle={() => updPhase(ph.id, "inAnnot", !ph.inAnnot)}>annot</Chip>
                        <Chip on={ph.inPanel} toggle={() => updPhase(ph.id, "inPanel", !ph.inPanel)}>panneau</Chip>
                        <button onClick={() => { appendTargetRef.current = ph.id; appendPhaseRef.current?.click(); }}
                          className="ml-auto text-[9px] font-semibold" style={{ color: T.accHi }}>
                          + fiche
                        </button>
                      </div>
                      <div className="mt-1 pl-4 text-[9px] truncate" style={{ color: T.dim, fontFamily: FM }}>
                        {ph.files.map(cardNumber).join(", ")} · {ph.peaks.length} pics
                      </div>
                    </div>
                  ))}
                </Group>
              </>
            )}

            {/* ═══ Onglet Style ═══ */}
            {tab === "style" && (
              <>
                <Group title="Axes et cadre">
                  <Txt label="Titre" value={S.title} set={(v) => upd("title", v)} />
                  <Txt label="Label X" value={S.xlabel} set={(v) => upd("xlabel", v)} />
                  <Txt label="Label Y" value={S.ylabel} set={(v) => upd("ylabel", v)} />
                  <div className="grid grid-cols-2 gap-2">
                    <Num label="X min" value={S.xmin} set={(v) => upd("xmin", v)} step={0.5} />
                    <Num label="X max" value={S.xmax} set={(v) => upd("xmax", v)} step={0.5} />
                  </div>
                  <Num label="Pas grad. X (0 = auto)" value={S.xTickStep} set={(v) => upd("xTickStep", v)} min={0} />
                  <Tgl label="Grille verticale" value={S.showGrid} set={(v) => upd("showGrid", v)} />
                </Group>

                <Group title="Traitement du signal">
                  <SNum label="Lissage (fenêtre)" value={S.smoothW} set={(v) => upd("smoothW", v)} min={1} max={25} step={1} />
                  <SNum label="Écrêtage (percentile)" value={S.clipPct} set={(v) => upd("clipPct", v)} min={90} max={100} step={0.1} />
                  <Tgl label="Normalisation min–max" value={S.normalize} set={(v) => upd("normalize", v)} />
                </Group>

                <Group title="Empilement">
                  <SNum label="Décalage vertical (vstep)" value={S.vstep} set={(v) => upd("vstep", v)} min={0.5} max={3} step={0.05} />
                  <SNum label="Échelle verticale (px/unité)" value={S.pxPerUnit} set={(v) => upd("pxPerUnit", v)} min={30} max={200} step={5} />
                  <SNum label="Épaisseur de trait" value={S.lineWidth} set={(v) => upd("lineWidth", v)} min={0.3} max={3} step={0.05} />
                  <Tgl label="Remplissage sous courbe" value={S.showFill} set={(v) => upd("showFill", v)} />
                  {S.showFill && <SNum label="Opacité remplissage" value={S.fillAlpha} set={(v) => upd("fillAlpha", v)} min={0} max={0.5} step={0.01} />}
                  <Tgl label="Inverser l'ordre d'empilement" value={S.reverseStack} set={(v) => upd("reverseStack", v)} />
                </Group>

                <Group title="Couleurs">
                  <Sel label="Colormap" value={S.cmap} set={(v) => upd("cmap", v)} options={Object.keys(CMAPS)} />
                  <div className="h-2.5 rounded-full my-1.5" style={{
                    background: cmapGradient(S.cmap, S.cmapMin, S.cmapMax, S.cmapReverse),
                  }} />
                  <SNum label="Borne inférieure" value={S.cmapMin} set={(v) => upd("cmapMin", v)} min={0} max={1} step={0.05} />
                  <SNum label="Borne supérieure" value={S.cmapMax} set={(v) => upd("cmapMax", v)} min={0} max={1} step={0.05} />
                  <Tgl label="Inverser la colormap" value={S.cmapReverse} set={(v) => upd("cmapReverse", v)} />
                  <Tgl label="Couleurs manuelles par patron" value={S.useCustomColors} set={(v) => upd("useCustomColors", v)} />
                </Group>

                <Group title="Typographie" defaultOpen={false}>
                  <SNum label="Police axes" value={S.axisFontSize} set={(v) => upd("axisFontSize", v)} min={8} max={22} step={0.5} />
                  <SNum label="Police graduations" value={S.tickFontSize} set={(v) => upd("tickFontSize", v)} min={6} max={18} step={0.5} />
                  <SNum label="Police titre" value={S.titleFontSize} set={(v) => upd("titleFontSize", v)} min={10} max={28} step={0.5} />
                  <SNum label="Labels patrons" value={S.patternLabelSize} set={(v) => upd("patternLabelSize", v)} min={7} max={20} step={0.5} />
                  <Tgl label="Labels patrons en gras" value={S.patternLabelBold} set={(v) => upd("patternLabelBold", v)} />
                  <SNum label="Marge droite (px)" value={S.rightMargin} set={(v) => upd("rightMargin", v)} min={40} max={300} step={5} />
                </Group>
              </>
            )}

            {/* ═══ Onglet Annotations ═══ */}
            {tab === "annot" && (
              <>
                <Group title="Annotations de phases">
                  <Tgl label="Afficher (au-dessus du patron sup.)" value={S.showAnnotations} set={(v) => upd("showAnnotations", v)} />
                  {S.showAnnotations && (
                    <>
                      <SNum label="Seuil bâtonnet (% I rel.)" value={S.tickMinI} set={(v) => upd("tickMinI", v)} min={0} max={50} step={0.5} />
                      <SNum label="Seuil label (% I rel.)" value={S.labelMinI} set={(v) => upd("labelMinI", v)} min={0} max={100} step={1} />
                      <SNum label="Séparation min labels" value={S.labelMinSep} set={(v) => upd("labelMinSep", v)} min={0.2} max={6} step={0.1} />
                      <SNum label="Hauteur bâtonnets" value={S.tickScale} set={(v) => upd("tickScale", v)} min={0.1} max={1.2} step={0.02} />
                      <SNum label="Écart au patron sup." value={S.annotGap} set={(v) => upd("annotGap", v)} min={0.6} max={2} step={0.02} />
                      <SNum label="Taille police" value={S.annotFontSize} set={(v) => upd("annotFontSize", v)} min={5} max={14} step={0.5} />
                      <Tgl label="Légende des abréviations" value={S.showAbbrevKey} set={(v) => upd("showAbbrevKey", v)} />
                    </>
                  )}
                </Group>

                <Group title="Panneau de références PDF">
                  <Tgl label="Afficher le panneau" value={S.showPdfPanel} set={(v) => upd("showPdfPanel", v)} />
                  {S.showPdfPanel && (
                    <>
                      <SNum label="Hauteur (px)" value={S.pdfPanelH} set={(v) => upd("pdfPanelH", v)} min={60} max={400} step={10} />
                      <SNum label="Épaisseur bâtonnets" value={S.pdfStickW} set={(v) => upd("pdfStickW", v)} min={0.3} max={3} step={0.05} />
                      <Tgl label="Labels de ligne" value={S.showRowLabels} set={(v) => upd("showRowLabels", v)} />
                      <Tgl label="Encart légende" value={S.showPdfLegend} set={(v) => upd("showPdfLegend", v)} />
                    </>
                  )}
                </Group>

                <Group title={`Notes — ${notes.length}`}>
                  <UploadZone onClick={() => setAddNoteMode(!addNoteMode)}>
                    {addNoteMode ? "Cliquer sur le graphe pour placer…" : "+ Ajouter une note (clic sur graphe)"}
                  </UploadZone>
                  {notes.map((n) => (
                    <div key={n.id} className="rounded-md p-2 mb-1.5"
                      style={{ background: T.card2, border: `1px solid ${T.line}` }}>
                      <div className="flex items-center gap-1.5">
                        <input type="color" value={n.color} onChange={(e) => updNote(n.id, "color", e.target.value)}
                          className="w-4 h-4 rounded-full flex-shrink-0 cursor-pointer border-0 p-0"
                          style={{ background: "transparent" }} />
                        <input type="text" value={n.text} onChange={(e) => updNote(n.id, "text", e.target.value)}
                          className="flex-1 min-w-0 rounded px-1.5 py-0.5 text-xs focus:outline-none"
                          style={{ background: "transparent", border: "1px solid transparent", color: T.text }}
                          onFocus={(e) => e.target.style.borderColor = T.line2}
                          onBlur={(e) => e.target.style.borderColor = "transparent"} />
                        <IconBtn onClick={() => setNotes((ns) => ns.filter((q) => q.id !== n.id))} danger title="Supprimer">×</IconBtn>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 mt-1.5 pl-4">
                        {[["x", "x", 0.1], ["yFrac", "y 0–1", 0.02], ["fontSize", "taille", 0.5], ["rotation", "rot °", 15]].map(([k, lbl, st]) => (
                          <label key={k} className="flex flex-col text-[9px]" style={{ color: T.dim, fontFamily: FM }}>
                            {lbl}
                            <input type="number" step={st} value={n[k]}
                              onChange={(e) => updNote(n.id, k, parseFloat(e.target.value))}
                              className="w-full rounded px-1 py-0.5 focus:outline-none"
                              style={{ background: T.card, border: `1px solid ${T.line}`, color: T.mut, fontFamily: FM }} />
                          </label>
                        ))}
                      </div>
                      <div className="mt-1.5 pl-4">
                        <Tgl label="Ligne verticale pointillée" value={n.vline} set={(v) => updNote(n.id, "vline", v)} />
                      </div>
                    </div>
                  ))}
                </Group>
              </>
            )}

            {/* ═══ Onglet Export ═══ */}
            {tab === "export" && (
              <>
                <Group title="Fichier">
                  <Txt label="Nom de fichier" value={S.fileName} set={(v) => upd("fileName", v)} />
                  <SNum label="Largeur figure (px)" value={S.figWidth} set={(v) => upd("figWidth", v)} min={500} max={2400} step={50} />
                  <SNum label="Facteur d'échelle PNG" value={S.pngScale} set={(v) => upd("pngScale", v)} min={1} max={6} step={1} />
                  <div className="flex gap-1.5 mt-2">
                    <button onClick={downloadPNG}
                      className="flex-1 rounded-md py-2 text-xs font-bold"
                      style={{ background: T.acc, color: "#14181f" }}>
                      Exporter PNG
                    </button>
                    <button onClick={downloadSVG}
                      className="flex-1 rounded-md py-2 text-xs font-bold"
                      style={{ border: `1px solid ${T.acc}`, color: T.accHi }}>
                      Exporter SVG
                    </button>
                  </div>
                  <div className="text-[9px] mt-1.5" style={{ color: T.dim, fontFamily: FM }}>
                    PNG : {W * S.pngScale} × {Math.round(H * S.pngScale)} px · SVG : vectoriel éditable
                  </div>
                </Group>

                <Group title="Session">
                  <div className="text-[10px] leading-relaxed mb-2" style={{ color: T.mut }}>
                    La session (données, phases, notes, réglages) n'est pas conservée à la fermeture.
                    L'export JSON permet de la restaurer intégralement.
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={saveSession}
                      className="flex-1 rounded-md py-2 text-xs font-semibold"
                      style={{ border: `1px solid ${T.line2}`, color: T.mut }}>
                      Sauver JSON
                    </button>
                    <button onClick={() => sessionFileRef.current?.click()}
                      className="flex-1 rounded-md py-2 text-xs font-semibold"
                      style={{ border: `1px solid ${T.line2}`, color: T.mut }}>
                      Charger JSON
                    </button>
                  </div>
                </Group>
              </>
            )}
          </div>
        </div>

        {/* ── Zone de tracé ── */}
        <div className="flex-1 min-w-0 overflow-auto p-8 flex items-start justify-center"
          style={{
            background: T.bg,
            backgroundImage: `radial-gradient(${T.line} 1px, transparent 1px)`,
            backgroundSize: "22px 22px",
          }}>
          {N === 0 ? (
            <div className="mt-20 max-w-md rounded-xl p-8 text-center"
              style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              <div className="flex justify-center mb-4 opacity-70"><Logo /></div>
              <div className="text-sm font-bold mb-2">Aucune donnée chargée</div>
              <div className="text-xs leading-relaxed" style={{ color: T.mut }}>
                Importer un ou plusieurs fichiers <span style={{ fontFamily: FM, color: T.accHi }}>.xy</span> (2θ / intensité
                ou cm⁻¹ / intensité) dans l'onglet Données, puis les fiches{" "}
                <span style={{ fontFamily: FM, color: T.accHi }}>.dif</span> pour les phases de référence.
                Les fichiers restent locaux au navigateur.
              </div>
              <button onClick={() => { setTab("data"); patternFileRef.current?.click(); }}
                className="mt-5 rounded-md px-5 py-2 text-xs font-bold"
                style={{ background: T.acc, color: "#14181f" }}>
                Importer des patrons
              </button>
            </div>
          ) : (
            <div className="rounded-lg overflow-hidden"
              style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)" }}>
              <svg
                ref={svgRef}
                viewBox={`0 0 ${W} ${H}`}
                width="100%"
                style={{ maxWidth: W, background: "#ffffff", display: "block", cursor: addNoteMode ? "crosshair" : "default" }}
                xmlns="http://www.w3.org/2000/svg"
                onClick={onSvgClick}
              >
                <rect x="0" y="0" width={W} height={H} fill="#ffffff" />

                {S.title && (
                  <text x={M.l + plotW / 2} y={M.t - 14} textAnchor="middle"
                    fontSize={S.titleFontSize} fontWeight="bold" fill="#111" fontFamily={font}>{S.title}</text>
                )}

                {S.showGrid && xTicks.map((t) => (
                  <line key={`g${t}`} x1={xToPx(t)} x2={xToPx(t)} y1={M.t} y2={M.t + mainH + (panelH ? M.gap + panelH : 0)}
                    stroke="#e5e5e5" strokeWidth={0.6} />
                ))}

                {stackOrder.map((p) => {
                  const idx = p.stackIdx;
                  const offset = idx * S.vstep;
                  const col = colorOf(idx);
                  if (!p.px.length) return null;
                  let path = "";
                  for (let i = 0; i < p.px.length; i++) {
                    path += `${i === 0 ? "M" : "L"}${xToPx(p.px[i]).toFixed(2)},${yToPx(p.py[i] + offset).toFixed(2)}`;
                  }
                  let fillPath = "";
                  if (S.showFill) {
                    fillPath = path + `L${xToPx(p.px[p.px.length - 1]).toFixed(2)},${yToPx(offset).toFixed(2)}L${xToPx(p.px[0]).toFixed(2)},${yToPx(offset).toFixed(2)}Z`;
                  }
                  return (
                    <g key={p.id}>
                      {S.showFill && <path d={fillPath} fill={col} opacity={S.fillAlpha} stroke="none" />}
                      <path d={path} fill="none" stroke={col} strokeWidth={S.lineWidth} />
                      <text x={xToPx(S.xmax) + 8} y={yToPx(offset + 0.5)} dominantBaseline="middle"
                        fontSize={S.patternLabelSize} fontWeight={S.patternLabelBold ? "bold" : "normal"}
                        fill={col} fontFamily={font}>{p.label}</text>
                    </g>
                  );
                })}

                {S.showAnnotations && annotData.ticks.map((t, i) => {
                  const h = (t.ri / 100) * S.tickScale;
                  return (
                    <line key={`at${i}`} x1={xToPx(t.t2)} x2={xToPx(t.t2)}
                      y1={yToPx(annotY0)} y2={yToPx(annotY0 + h)}
                      stroke={t.color} strokeWidth={0.8} opacity={0.85} />
                  );
                })}
                {S.showAnnotations && annotData.labels.map((t, i) => {
                  const h = (t.ri / 100) * S.tickScale;
                  const extra = i % 2 ? 0.08 : 0;
                  const x = xToPx(t.t2), y = yToPx(annotY0 + h + extra + 0.04);
                  return (
                    <text key={`al${i}`} x={x} y={y}
                      fontSize={S.annotFontSize} fontWeight="bold" fill={t.color} fontFamily={font}
                      textAnchor="start" transform={`rotate(-90 ${x} ${y})`}>{t.abb}</text>
                  );
                })}
                {S.showAnnotations && S.showAbbrevKey && phases.filter((p) => p.visible && p.inAnnot).map((ph, k) => (
                  <text key={`ak${ph.id}`} x={xToPx(S.xmax) + 8}
                    y={yToPx(annotY0 + S.tickScale * 0.85) + k * 13}
                    fontSize={8.5} fontStyle="italic" fill={ph.color} fontFamily={font}>
                    {ph.abbrev} = {ph.name}
                  </text>
                ))}

                {notes.map((n) => {
                  const x = xToPx(n.x);
                  const y = M.t + mainH * (1 - n.yFrac);
                  return (
                    <g key={n.id}>
                      {n.vline && <line x1={x} x2={x} y1={M.t} y2={M.t + mainH} stroke={n.color} strokeWidth={0.7} strokeDasharray="4 3" opacity={0.7} />}
                      <text x={x} y={y} fontSize={n.fontSize} fill={n.color} fontFamily={font}
                        textAnchor="middle" transform={n.rotation ? `rotate(${n.rotation} ${x} ${y})` : undefined}>
                        {n.text}
                      </text>
                    </g>
                  );
                })}

                <text x={18} y={M.t + mainH / 2} fontSize={S.axisFontSize} fill="#111" fontFamily={font}
                  textAnchor="middle" transform={`rotate(-90 18 ${M.t + mainH / 2})`}>{S.ylabel}</text>
                <line x1={M.l} x2={M.l} y1={M.t} y2={M.t + mainH} stroke="#111" strokeWidth={1} />

                {panelH > 0 && (
                  <g>
                    {panelPhases.map((ph, k) => {
                      const rowTop = panelTop + k * rowH;
                      return (
                        <g key={ph.id}>
                          {ph.peaks.map(([t2, ri], j) =>
                            t2 >= S.xmin && t2 <= S.xmax ? (
                              <line key={j} x1={xToPx(t2)} x2={xToPx(t2)}
                                y1={rowTop + rowH - 3} y2={rowTop + rowH - 3 - (ri / 100) * rowH * 0.8}
                                stroke={ph.color} strokeWidth={S.pdfStickW} opacity={0.88} />
                            ) : null
                          )}
                          {S.showRowLabels && (
                            <g>
                              <text x={M.l + 8} y={rowTop + rowH * 0.32} fontSize={10.5} fontWeight="bold"
                                fill={ph.color} fontFamily={font}>{ph.name}</text>
                              <text x={M.l + 8} y={rowTop + rowH * 0.32 + 11} fontSize={7.5} fontStyle="italic"
                                fill={ph.color} fontFamily={font}>{ph.files.map(cardNumber).join(", ")}</text>
                            </g>
                          )}
                          {k > 0 && <line x1={M.l} x2={M.l + plotW} y1={rowTop} y2={rowTop} stroke="#cccccc" strokeWidth={0.5} />}
                        </g>
                      );
                    })}
                    <line x1={M.l} x2={M.l} y1={panelTop} y2={panelTop + panelH} stroke="#111" strokeWidth={1} />

                    {S.showPdfLegend && (() => {
                      const items = panelPhases;
                      const lh = 15;
                      const boxH = items.length * lh + 22;
                      const boxW = 175;
                      const bx = M.l + plotW - boxW - 6, by = panelTop + 6;
                      return (
                        <g>
                          <rect x={bx} y={by} width={boxW} height={boxH} fill="#ffffff" opacity={0.9}
                            stroke="#aaaaaa" strokeWidth={0.7} rx={2} />
                          <text x={bx + boxW / 2} y={by + 13} textAnchor="middle" fontSize={9} fontWeight="bold"
                            fill="#333" fontFamily={font}>Références PDF</text>
                          {items.map((ph, k) => (
                            <g key={ph.id}>
                              <line x1={bx + 8} x2={bx + 24} y1={by + 22 + k * lh} y2={by + 22 + k * lh}
                                stroke={ph.color} strokeWidth={2} />
                              <text x={bx + 30} y={by + 25 + k * lh} fontSize={8} fill="#222" fontFamily={font}>
                                {ph.name} — {ph.files.map(cardNumber).join(", ")}
                              </text>
                            </g>
                          ))}
                        </g>
                      );
                    })()}
                  </g>
                )}

                {(() => {
                  const axisY = panelH > 0 ? panelTop + panelH : M.t + mainH;
                  return (
                    <g>
                      <line x1={M.l} x2={M.l + plotW} y1={axisY} y2={axisY} stroke="#111" strokeWidth={1} />
                      {xTicks.map((t) => (
                        <g key={`xt${t}`}>
                          <line x1={xToPx(t)} x2={xToPx(t)} y1={axisY} y2={axisY + 5} stroke="#111" strokeWidth={1} />
                          <text x={xToPx(t)} y={axisY + 18} textAnchor="middle"
                            fontSize={S.tickFontSize} fill="#111" fontFamily={font}>{t}</text>
                        </g>
                      ))}
                      <text x={M.l + plotW / 2} y={axisY + 38} textAnchor="middle"
                        fontSize={S.axisFontSize} fill="#111" fontFamily={font}>{S.xlabel}</text>
                    </g>
                  );
                })()}
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Toast ═══ */}
      {msg && (
        <div className="fixed bottom-4 right-4 rounded-lg px-3.5 py-2.5 text-xs flex items-center gap-3"
          style={{ background: T.card2, border: `1px solid ${T.acc}`, color: T.text, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
          <span>{msg}</span>
          <button onClick={() => setMsg("")} style={{ color: T.accHi }} className="font-bold">×</button>
        </div>
      )}

      {/* Bandeau mode ajout de note */}
      {addNoteMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-semibold"
          style={{ background: T.acc, color: "#14181f", boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
          Cliquer sur le graphe pour placer la note — Échap. via le bouton de l'onglet Annot.
        </div>
      )}
    </div>
  );
}
