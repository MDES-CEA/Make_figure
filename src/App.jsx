import React, { useState, useRef, useMemo, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   Générateur de figures DRX / Raman
   - Import .xy / .txt / .csv (patrons), .dif Bruker EVA binaire ou texte (fiches PDF)
   - Empilement paramétrable, annotations de phases, panneau de bâtonnets PDF
   - Export SVG / PNG, sauvegarde/restauration de session JSON
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Parsers ─────────────────────────────────────────────────────────────── */

function parseXYText(text) {
  const xs = [], ys = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
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
      if (t2 >= 2 && t2 <= 130 && ii > 0 && Number.isFinite(t2) && Number.isFinite(ii)) {
        peaks.push([t2, ii]);
      }
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
  let sum = 0, cnt = 0;
  for (let i = 0; i < y.length; i++) {
    sum = 0; cnt = 0;
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

/* ─── Réglages par défaut ─────────────────────────────────────────────────── */

const DEFAULTS = {
  drx: {
    xmin: 10, xmax: 58,
    xlabel: "2θ (°, Cu Kα, λ = 1.5406 Å)",
  },
  raman: {
    xmin: 100, xmax: 1800,
    xlabel: "Décalage Raman (cm⁻¹)",
  },
};

const initialSettings = {
  mode: "drx",
  title: "",
  xmin: 10, xmax: 58,
  xlabel: DEFAULTS.drx.xlabel,
  ylabel: "Intensité (normalisée, décalée)",
  xTickStep: 0,           // 0 = auto
  showGrid: false,
  // traitement
  smoothW: 3,
  clipPct: 99.5,
  normalize: true,
  // empilement
  vstep: 1.25,
  pxPerUnit: 80,
  lineWidth: 0.9,
  showFill: true,
  fillAlpha: 0.08,
  reverseStack: false,
  // couleurs
  cmap: "plasma",
  cmapMin: 0.05, cmapMax: 0.85,
  cmapReverse: false,
  useCustomColors: false,
  // labels patrons
  patternLabelSize: 12,
  patternLabelBold: true,
  // annotations de phases
  showAnnotations: true,
  tickMinI: 1,
  labelMinI: 10,
  labelMinSep: 1.6,
  tickScale: 0.46,
  annotFontSize: 8.5,
  annotGap: 1.06,
  showAbbrevKey: true,
  // panneau PDF
  showPdfPanel: true,
  pdfPanelH: 150,
  pdfStickW: 1.0,
  showPdfLegend: true,
  showRowLabels: true,
  // typographie / cadre
  axisFontSize: 13,
  tickFontSize: 11,
  titleFontSize: 15,
  rightMargin: 135,
  figWidth: 1100,
  bgWhite: true,
  // export
  pngScale: 2,
  fileName: "figure_stacked",
};

let _id = 1;
const nid = () => `id${_id++}_${Date.now() % 100000}`;

const PHASE_COLORS = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#8c564b", "#e377c2", "#17becf"];

/* ─── Petits composants de contrôle ───────────────────────────────────────── */

function Num({ label, value, set, step = 1, min, max, w = "w-20" }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-zinc-300">
      <span className="truncate">{label}</span>
      <input
        type="number" value={value} step={step} min={min} max={max}
        onChange={(e) => set(parseFloat(e.target.value))}
        className={`${w} rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-right text-zinc-100 focus:outline-none focus:border-sky-600`}
      />
    </label>
  );
}

function Txt({ label, value, set, full }) {
  return (
    <label className={`flex ${full ? "flex-col gap-1" : "items-center justify-between gap-2"} text-xs text-zinc-300`}>
      <span>{label}</span>
      <input
        type="text" value={value} onChange={(e) => set(e.target.value)}
        className={`${full ? "w-full" : "w-40"} rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-zinc-100 focus:outline-none focus:border-sky-600`}
      />
    </label>
  );
}

function Chk({ label, value, set }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-zinc-300 cursor-pointer">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)}
        className="accent-sky-600 h-3.5 w-3.5" />
    </label>
  );
}

function Sel({ label, value, set, options }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-zinc-300">
      <span>{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)}
        className="rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-zinc-100 focus:outline-none focus:border-sky-600">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200">
        {title}
        <span className="text-zinc-600">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-1.5">{children}</div>}
    </div>
  );
}

/* ─── Composant principal ─────────────────────────────────────────────────── */

export default function XRDRamanTool() {
  const [settings, setSettings] = useState(initialSettings);
  const [patterns, setPatterns] = useState([]);   // {id,label,fileName,x,y,visible,color,yscale}
  const [phases, setPhases] = useState([]);       // {id,name,abbrev,color,peaks,files,visible,inAnnot,inPanel}
  const [notes, setNotes] = useState([]);         // {id,x,yFrac,text,color,fontSize,rotation,vline}
  const [addNoteMode, setAddNoteMode] = useState(false);
  const [msg, setMsg] = useState("");

  const svgRef = useRef(null);
  const patternFileRef = useRef(null);
  const phaseFileRef = useRef(null);
  const sessionFileRef = useRef(null);
  const appendPhaseRef = useRef(null);
  const appendTargetRef = useRef(null);

  const S = settings;
  const upd = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

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
        // tentative en texte (certains .dif sont des exports texte)
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

  /* ── Session JSON ── */

  const saveSession = () => {
    const blob = new Blob([JSON.stringify({ settings, patterns, phases, notes }, null, 0)], { type: "application/json" });
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
      if (xs.length < 5) return { ...p, px: [], py: [] };
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

  /* Géométrie */
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

  /* Ticks X */
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

  /* Annotations de phases (bâtonnets + labels au-dessus du patron du haut) */
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

  /* Panneau PDF */
  const panelPhases = phases.filter((p) => p.visible && p.inPanel);
  const rowH = panelPhases.length ? panelH / panelPhases.length : 0;
  const panelTop = M.t + mainH + M.gap;

  /* ── Clic pour ajouter une note ── */
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
  };

  /* ── Exports ── */

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

  /* ── Mutateurs listes ── */
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

  /* ═══════════════════════════ RENDU ═══════════════════════════ */

  return (
    <div className="h-screen w-full flex bg-zinc-950 text-zinc-100" style={{ fontFamily: "system-ui, sans-serif" }}>

      {/* ── Panneau latéral ── */}
      <div className="w-80 flex-shrink-0 h-full overflow-y-auto bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="px-3 py-3 border-b border-zinc-800">
          <div className="text-sm font-bold tracking-wide text-zinc-100">Générateur DRX / Raman</div>
          <div className="flex gap-1 mt-2">
            {["drx", "raman"].map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex-1 rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide border ${S.mode === m ? "bg-sky-700 border-sky-600 text-white" : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"}`}>
                {m === "drx" ? "DRX" : "Raman"}
              </button>
            ))}
          </div>
          <div className="flex gap-1 mt-2">
            <button onClick={saveSession} className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-[11px] hover:border-zinc-500">Sauver session</button>
            <button onClick={() => sessionFileRef.current?.click()} className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-[11px] hover:border-zinc-500">Charger session</button>
            <input ref={sessionFileRef} type="file" accept=".json" className="hidden"
              onChange={(e) => { loadSession([...e.target.files]); e.target.value = ""; }} />
          </div>
        </div>

        {/* ── Données ── */}
        <Section title={`Patrons (${patterns.length})`} defaultOpen>
          <button onClick={() => patternFileRef.current?.click()}
            className="w-full rounded border border-dashed border-zinc-600 py-2 text-xs text-zinc-400 hover:border-sky-600 hover:text-sky-400">
            + Importer .xy / .txt / .csv (multiple)
          </button>
          <input ref={patternFileRef} type="file" accept=".xy,.txt,.csv,.dat" multiple className="hidden"
            onChange={(e) => { onPatternFiles([...e.target.files]); e.target.value = ""; }} />
          {patterns.map((p, i) => (
            <div key={p.id} className="rounded bg-zinc-800/60 border border-zinc-800 p-2 flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <input type="checkbox" checked={p.visible} onChange={(e) => updPattern(p.id, "visible", e.target.checked)} className="accent-sky-600" />
                <input type="text" value={p.label} onChange={(e) => updPattern(p.id, "label", e.target.value)}
                  className="flex-1 min-w-0 rounded bg-zinc-800 border border-zinc-700 px-1 py-0.5 text-xs" />
                {S.useCustomColors && (
                  <input type="color" value={p.color} onChange={(e) => updPattern(p.id, "color", e.target.value)}
                    className="h-6 w-6 rounded bg-transparent border border-zinc-700 p-0" />
                )}
                <button onClick={() => movePattern(p.id, -1)} className="text-zinc-500 hover:text-zinc-200 px-1">↑</button>
                <button onClick={() => movePattern(p.id, +1)} className="text-zinc-500 hover:text-zinc-200 px-1">↓</button>
                <button onClick={() => setPatterns((ps) => ps.filter((q) => q.id !== p.id))} className="text-red-500 hover:text-red-400 px-1">×</button>
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                <span className="truncate">{p.fileName} ({p.x.length} pts)</span>
                <label className="flex items-center gap-1 flex-shrink-0" title="Facteur d'échelle vertical">×
                  <input type="number" step={0.1} value={p.yscale} onChange={(e) => updPattern(p.id, "yscale", parseFloat(e.target.value) || 1)}
                    className="w-12 rounded bg-zinc-800 border border-zinc-700 px-1 text-right text-zinc-300" />
                </label>
                <label className="flex items-center gap-1 flex-shrink-0" title="Décalage horizontal (mêmes unités que l'axe X)">Δx
                  <input type="number" step={0.05} value={p.xoffset ?? 0} onChange={(e) => updPattern(p.id, "xoffset", parseFloat(e.target.value) || 0)}
                    className="w-14 rounded bg-zinc-800 border border-zinc-700 px-1 text-right text-zinc-300" />
                </label>
              </div>
            </div>
          ))}
        </Section>

        {/* ── Phases ── */}
        <Section title={`Phases PDF (${phases.length})`} defaultOpen>
          <button onClick={() => phaseFileRef.current?.click()}
            className="w-full rounded border border-dashed border-zinc-600 py-2 text-xs text-zinc-400 hover:border-sky-600 hover:text-sky-400">
            + Importer .dif (binaire EVA) ou liste 2θ/I texte
          </button>
          <input ref={phaseFileRef} type="file" accept=".dif,.txt,.csv,.dat" multiple className="hidden"
            onChange={(e) => { onPhaseFiles([...e.target.files]); e.target.value = ""; }} />
          <input ref={appendPhaseRef} type="file" accept=".dif,.txt,.csv,.dat" className="hidden"
            onChange={(e) => { onAppendPhaseFile([...e.target.files]); e.target.value = ""; }} />
          {phases.map((ph) => (
            <div key={ph.id} className="rounded bg-zinc-800/60 border border-zinc-800 p-2 flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <input type="checkbox" checked={ph.visible} onChange={(e) => updPhase(ph.id, "visible", e.target.checked)} className="accent-sky-600" />
                <input type="text" value={ph.name} onChange={(e) => updPhase(ph.id, "name", e.target.value)}
                  className="flex-1 min-w-0 rounded bg-zinc-800 border border-zinc-700 px-1 py-0.5 text-xs" />
                <input type="color" value={ph.color} onChange={(e) => updPhase(ph.id, "color", e.target.value)}
                  className="h-6 w-6 rounded bg-transparent border border-zinc-700 p-0" />
                <button onClick={() => setPhases((ps) => ps.filter((q) => q.id !== ph.id))} className="text-red-500 hover:text-red-400 px-1">×</button>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                <label className="flex items-center gap-1">Abr.
                  <input type="text" value={ph.abbrev} onChange={(e) => updPhase(ph.id, "abbrev", e.target.value)}
                    className="w-12 rounded bg-zinc-800 border border-zinc-700 px-1 text-zinc-200" />
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={ph.inAnnot} onChange={(e) => updPhase(ph.id, "inAnnot", e.target.checked)} className="accent-sky-600" />annot.
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={ph.inPanel} onChange={(e) => updPhase(ph.id, "inPanel", e.target.checked)} className="accent-sky-600" />panneau
                </label>
                <button onClick={() => { appendTargetRef.current = ph.id; appendPhaseRef.current?.click(); }}
                  className="ml-auto text-sky-500 hover:text-sky-300">+ fiche</button>
              </div>
              <div className="text-[10px] text-zinc-500 truncate">{ph.files.map(cardNumber).join(", ")} — {ph.peaks.length} pics</div>
            </div>
          ))}
        </Section>

        {/* ── Axes ── */}
        <Section title="Axes et cadre">
          <Txt label="Titre" value={S.title} set={(v) => upd("title", v)} full />
          <Txt label="Label X" value={S.xlabel} set={(v) => upd("xlabel", v)} full />
          <Txt label="Label Y" value={S.ylabel} set={(v) => upd("ylabel", v)} full />
          <div className="grid grid-cols-2 gap-2">
            <Num label="X min" value={S.xmin} set={(v) => upd("xmin", v)} step={0.5} w="w-16" />
            <Num label="X max" value={S.xmax} set={(v) => upd("xmax", v)} step={0.5} w="w-16" />
          </div>
          <Num label="Pas des graduations X (0 = auto)" value={S.xTickStep} set={(v) => upd("xTickStep", v)} step={1} min={0} />
          <Chk label="Grille verticale" value={S.showGrid} set={(v) => upd("showGrid", v)} />
          <Num label="Taille police axes" value={S.axisFontSize} set={(v) => upd("axisFontSize", v)} step={0.5} />
          <Num label="Taille police graduations" value={S.tickFontSize} set={(v) => upd("tickFontSize", v)} step={0.5} />
          <Num label="Taille police titre" value={S.titleFontSize} set={(v) => upd("titleFontSize", v)} step={0.5} />
        </Section>

        {/* ── Traitement ── */}
        <Section title="Traitement du signal">
          <Num label="Lissage (fenêtre, 1 = aucun)" value={S.smoothW} set={(v) => upd("smoothW", v)} min={1} />
          <Num label="Écrêtage (percentile, 100 = aucun)" value={S.clipPct} set={(v) => upd("clipPct", v)} step={0.1} min={50} max={100} />
          <Chk label="Normalisation min–max" value={S.normalize} set={(v) => upd("normalize", v)} />
        </Section>

        {/* ── Empilement ── */}
        <Section title="Empilement">
          <Num label="Décalage vertical (vstep)" value={S.vstep} set={(v) => upd("vstep", v)} step={0.05} />
          <Num label="Échelle verticale (px/unité)" value={S.pxPerUnit} set={(v) => upd("pxPerUnit", v)} step={5} />
          <Num label="Épaisseur de trait" value={S.lineWidth} set={(v) => upd("lineWidth", v)} step={0.05} />
          <Chk label="Remplissage sous courbe" value={S.showFill} set={(v) => upd("showFill", v)} />
          <Num label="Opacité remplissage" value={S.fillAlpha} set={(v) => upd("fillAlpha", v)} step={0.02} min={0} max={1} />
          <Chk label="Inverser l'ordre d'empilement" value={S.reverseStack} set={(v) => upd("reverseStack", v)} />
          <Num label="Taille labels patrons" value={S.patternLabelSize} set={(v) => upd("patternLabelSize", v)} step={0.5} />
          <Chk label="Labels patrons en gras" value={S.patternLabelBold} set={(v) => upd("patternLabelBold", v)} />
          <Num label="Marge droite (labels, px)" value={S.rightMargin} set={(v) => upd("rightMargin", v)} step={5} />
        </Section>

        {/* ── Couleurs ── */}
        <Section title="Couleurs">
          <Sel label="Colormap" value={S.cmap} set={(v) => upd("cmap", v)} options={Object.keys(CMAPS)} />
          <div className="grid grid-cols-2 gap-2">
            <Num label="Min" value={S.cmapMin} set={(v) => upd("cmapMin", v)} step={0.05} min={0} max={1} w="w-14" />
            <Num label="Max" value={S.cmapMax} set={(v) => upd("cmapMax", v)} step={0.05} min={0} max={1} w="w-14" />
          </div>
          <Chk label="Inverser la colormap" value={S.cmapReverse} set={(v) => upd("cmapReverse", v)} />
          <Chk label="Couleurs manuelles par patron" value={S.useCustomColors} set={(v) => upd("useCustomColors", v)} />
          <div className="h-3 rounded mt-1" style={{
            background: `linear-gradient(to right, ${Array.from({ length: 12 }, (_, i) => cmapColor(S.cmap, S.cmapMin + (S.cmapMax - S.cmapMin) * i / 11)).join(",")})`
          }} />
        </Section>

        {/* ── Annotations de phases ── */}
        <Section title="Annotations de phases">
          <Chk label="Afficher (au-dessus du patron sup.)" value={S.showAnnotations} set={(v) => upd("showAnnotations", v)} />
          <Num label="Seuil bâtonnet (% I rel.)" value={S.tickMinI} set={(v) => upd("tickMinI", v)} step={0.5} min={0} max={100} />
          <Num label="Seuil label (% I rel.)" value={S.labelMinI} set={(v) => upd("labelMinI", v)} step={1} min={0} max={100} />
          <Num label="Séparation min labels (°)" value={S.labelMinSep} set={(v) => upd("labelMinSep", v)} step={0.1} />
          <Num label="Hauteur bâtonnets" value={S.tickScale} set={(v) => upd("tickScale", v)} step={0.02} />
          <Num label="Écart au patron sup." value={S.annotGap} set={(v) => upd("annotGap", v)} step={0.02} />
          <Num label="Taille police" value={S.annotFontSize} set={(v) => upd("annotFontSize", v)} step={0.5} />
          <Chk label="Légende des abréviations" value={S.showAbbrevKey} set={(v) => upd("showAbbrevKey", v)} />
        </Section>

        {/* ── Panneau PDF ── */}
        <Section title="Panneau de références PDF">
          <Chk label="Afficher le panneau" value={S.showPdfPanel} set={(v) => upd("showPdfPanel", v)} />
          <Num label="Hauteur (px)" value={S.pdfPanelH} set={(v) => upd("pdfPanelH", v)} step={10} min={40} />
          <Num label="Épaisseur bâtonnets" value={S.pdfStickW} set={(v) => upd("pdfStickW", v)} step={0.05} />
          <Chk label="Labels de ligne (phase + fiches)" value={S.showRowLabels} set={(v) => upd("showRowLabels", v)} />
          <Chk label="Encart légende" value={S.showPdfLegend} set={(v) => upd("showPdfLegend", v)} />
        </Section>

        {/* ── Notes ── */}
        <Section title={`Notes (${notes.length})`}>
          <button onClick={() => setAddNoteMode(!addNoteMode)}
            className={`w-full rounded border py-1.5 text-xs ${addNoteMode ? "border-sky-500 text-sky-400 bg-sky-950" : "border-dashed border-zinc-600 text-zinc-400 hover:border-sky-600"}`}>
            {addNoteMode ? "Cliquer sur le graphe pour placer…" : "+ Ajouter une note (clic sur graphe)"}
          </button>
          {notes.map((n) => (
            <div key={n.id} className="rounded bg-zinc-800/60 border border-zinc-800 p-2 flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <input type="text" value={n.text} onChange={(e) => updNote(n.id, "text", e.target.value)}
                  className="flex-1 min-w-0 rounded bg-zinc-800 border border-zinc-700 px-1 py-0.5 text-xs" />
                <input type="color" value={n.color} onChange={(e) => updNote(n.id, "color", e.target.value)}
                  className="h-6 w-6 rounded bg-transparent border border-zinc-700 p-0" />
                <button onClick={() => setNotes((ns) => ns.filter((q) => q.id !== n.id))} className="text-red-500 hover:text-red-400 px-1">×</button>
              </div>
              <div className="grid grid-cols-4 gap-1 text-[10px] text-zinc-400">
                <label>x<input type="number" step={0.1} value={n.x} onChange={(e) => updNote(n.id, "x", parseFloat(e.target.value))} className="w-full rounded bg-zinc-800 border border-zinc-700 px-1 text-zinc-200" /></label>
                <label>y (0–1)<input type="number" step={0.02} value={n.yFrac} onChange={(e) => updNote(n.id, "yFrac", parseFloat(e.target.value))} className="w-full rounded bg-zinc-800 border border-zinc-700 px-1 text-zinc-200" /></label>
                <label>taille<input type="number" step={0.5} value={n.fontSize} onChange={(e) => updNote(n.id, "fontSize", parseFloat(e.target.value))} className="w-full rounded bg-zinc-800 border border-zinc-700 px-1 text-zinc-200" /></label>
                <label>rot.<input type="number" step={15} value={n.rotation} onChange={(e) => updNote(n.id, "rotation", parseFloat(e.target.value))} className="w-full rounded bg-zinc-800 border border-zinc-700 px-1 text-zinc-200" /></label>
              </div>
              <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
                <input type="checkbox" checked={n.vline} onChange={(e) => updNote(n.id, "vline", e.target.checked)} className="accent-sky-600" />
                ligne verticale pointillée
              </label>
            </div>
          ))}
        </Section>

        {/* ── Export ── */}
        <Section title="Export" defaultOpen>
          <Txt label="Nom de fichier" value={S.fileName} set={(v) => upd("fileName", v)} />
          <Num label="Largeur figure (px)" value={S.figWidth} set={(v) => upd("figWidth", v)} step={50} min={400} />
          <Num label="Facteur PNG" value={S.pngScale} set={(v) => upd("pngScale", v)} step={1} min={1} max={6} />
          <div className="flex gap-1 mt-1">
            <button onClick={downloadPNG} className="flex-1 rounded bg-sky-700 hover:bg-sky-600 px-2 py-1.5 text-xs font-semibold">PNG</button>
            <button onClick={downloadSVG} className="flex-1 rounded bg-zinc-700 hover:bg-zinc-600 px-2 py-1.5 text-xs font-semibold">SVG</button>
          </div>
        </Section>

        {msg && (
          <div className="m-3 rounded bg-amber-950 border border-amber-800 px-2 py-1.5 text-[11px] text-amber-300 flex justify-between gap-2">
            <span>{msg}</span>
            <button onClick={() => setMsg("")} className="text-amber-500">×</button>
          </div>
        )}
      </div>

      {/* ── Zone de tracé ── */}
      <div className="flex-1 h-full overflow-auto p-6 flex items-start justify-center bg-zinc-950">
        {N === 0 ? (
          <div className="mt-24 max-w-md text-center text-zinc-500 text-sm leading-relaxed">
            <div className="text-zinc-300 font-semibold mb-2">Aucune donnée chargée</div>
            Importer un ou plusieurs fichiers .xy (2θ / intensité ou cm⁻¹ / intensité)
            dans la section <span className="text-zinc-300">Patrons</span>, puis les fiches .dif
            dans <span className="text-zinc-300">Phases PDF</span>. Le format .dif binaire Bruker EVA
            (compteur à 0x02D0, enregistrements float64/float32) et les listes texte 2θ/I sont acceptés.
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            style={{ maxWidth: W, background: "#ffffff", borderRadius: 6, cursor: addNoteMode ? "crosshair" : "default" }}
            xmlns="http://www.w3.org/2000/svg"
            onClick={onSvgClick}
          >
            <rect x="0" y="0" width={W} height={H} fill="#ffffff" />

            {/* Titre */}
            {S.title && (
              <text x={M.l + plotW / 2} y={M.t - 14} textAnchor="middle"
                fontSize={S.titleFontSize} fontWeight="bold" fill="#111" fontFamily={font}>{S.title}</text>
            )}

            {/* Grille */}
            {S.showGrid && xTicks.map((t) => (
              <line key={`g${t}`} x1={xToPx(t)} x2={xToPx(t)} y1={M.t} y2={M.t + mainH + (panelH ? M.gap + panelH : 0)}
                stroke="#e5e5e5" strokeWidth={0.6} />
            ))}

            {/* ── Patrons empilés ── */}
            {stackOrder.map((p, k) => {
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

            {/* ── Annotations de phases ── */}
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

            {/* ── Notes ── */}
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

            {/* Label Y */}
            <text x={18} y={M.t + mainH / 2} fontSize={S.axisFontSize} fill="#111" fontFamily={font}
              textAnchor="middle" transform={`rotate(-90 18 ${M.t + mainH / 2})`}>{S.ylabel}</text>
            {/* Axe gauche (spine) */}
            <line x1={M.l} x2={M.l} y1={M.t} y2={M.t + mainH} stroke="#111" strokeWidth={1} />

            {/* ── Panneau PDF ── */}
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

                {/* Légende encart */}
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

            {/* ── Axe X ── */}
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
        )}
      </div>
    </div>
  );
}
