import React, { useCallback, useEffect, useRef, useState } from "react";

/*
 * Champ minéral de l'écran d'accueil.
 *
 * Les mêmes atomes occupent deux jeux de positions : un réseau hexagonal
 * aplati et un nuage désordonné. Le curseur interpole entre les deux, ce qui
 * fait apparaître ou disparaître les anneaux de Debye et le grain.
 *
 * Les relevés sont calculés, pas illustratifs : l'élargissement des raies et
 * la taille de cristallite suivent Scherrer (K = 0,9 ; Cu Kα λ = 1,5406 Å).
 * Le composant n'est monté que sur l'écran d'accueil : dès qu'un patron est
 * visible, il est démonté et la boucle d'animation s'arrête.
 */

const LAMBDA = 1.5406;
const SCHERRER_K = 0.9;
const GROWTH_MS = 900;

// Quatre premières raies de l'hydroxyapatite, valeurs mesurées sous Cu Kα.
const LINES = [
  { hkl: "002", twoTheta: 25.88, d: 3.44 },
  { hkl: "211", twoTheta: 31.77, d: 2.81 },
  { hkl: "310", twoTheta: 39.82, d: 2.26 },
  { hkl: "213", twoTheta: 49.47, d: 1.84 },
];

function gaussian() {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Géométrie construite une fois pour toutes : identique d'un montage à l'autre.
function buildGeometry() {
  const lattice = [];
  const amorphous = [];
  const grain = [];
  const a = 1;
  const c = 0.78;
  for (let i = -4; i <= 4; i += 1) {
    for (let j = -4; j <= 4; j += 1) {
      for (let k = -3; k <= 3; k += 1) {
        const x = (i + j * 0.5) * a;
        const z = j * 0.866 * a;
        const y = k * c;
        if (Math.hypot(x, y * 1.25, z) > 4.1) continue;
        lattice.push({ x, y, z, big: (i + j * 2 + k * 3) % 3 === 0 });
        const r = Math.pow(Math.random(), 0.62) * 4;
        const t = Math.random() * 2 * Math.PI;
        const p = Math.acos(2 * Math.random() - 1);
        amorphous.push({
          x: r * Math.sin(p) * Math.cos(t),
          y: r * Math.cos(p) * 0.82,
          z: r * Math.sin(p) * Math.sin(t),
        });
      }
    }
  }
  for (let i = 0; i < 1200; i += 1) {
    grain.push({
      x: gaussian() * 1.9,
      y: gaussian() * 1.55,
      alpha: 0.05 + Math.random() * 0.5,
      size: Math.random() < 0.16 ? 1.6 : 0.9,
    });
  }
  return { lattice, amorphous, grain };
}

const GEOMETRY = buildGeometry();

export function scherrer(order) {
  const fwhmDeg = 0.11 + (1 - order) * 2.35;
  const beta = (fwhmDeg * Math.PI) / 180;
  const theta = (LINES[1].twoTheta / 2 / 180) * Math.PI;
  return { fwhmDeg, sizeNm: (SCHERRER_K * LAMBDA) / (beta * Math.cos(theta)) / 10 };
}

function formatFr(value, digits) {
  return value.toFixed(digits).replace(".", ",");
}

export default function MineralField({ tr = (s) => s, reduceMotion = false }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const shownRef = useRef(0.62);
  const rotationRef = useRef({ y: 0.6, x: -0.32 });
  const dragRef = useRef(null);
  const orderRef = useRef(0.62);
  const [order, setOrder] = useState(0.62);

  const still =
    reduceMotion ||
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const paint = useCallback(
    (now) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      shownRef.current += (orderRef.current - shownRef.current) * (still ? 1 : 0.09);
      const o = shownRef.current;
      const cx = width / 2;
      const cy = height * 0.52;
      const scale = Math.min(width * 0.3, height * 0.46);
      if (!dragRef.current && !still) rotationRef.current.y += 0.0026;

      const cosY = Math.cos(rotationRef.current.y);
      const sinY = Math.sin(rotationRef.current.y);
      const cosX = Math.cos(rotationRef.current.x);
      const sinX = Math.sin(rotationRef.current.x);

      ctx.fillStyle = "#12100d";

      // Grain : la phase amorphe est une texture, pas un contour.
      const grainAlpha = Math.pow(1 - o, 1.35);
      if (grainAlpha > 0.004) {
        for (const p of GEOMETRY.grain) {
          ctx.globalAlpha = p.alpha * grainAlpha * 0.55;
          ctx.fillRect(cx + p.x * scale * 0.52, cy + p.y * scale * 0.52, p.size, p.size);
        }
      }

      // Anneaux de Debye : n'apparaissent qu'avec l'ordre.
      const ringAlpha = Math.max(0, (o - 0.24) / 0.76);
      if (ringAlpha > 0.004) {
        LINES.forEach((line, index) => {
          const radius = scale * (0.72 + index * 0.3);
          const count = Math.round(radius * 1.05);
          const spin = (index % 2 ? -1 : 1) * (now || 0) * 0.000045;
          for (let k = 0; k < count; k += 1) {
            const angle = (k / count) * 2 * Math.PI + spin;
            ctx.globalAlpha = ringAlpha * (0.1 + 0.16 * (0.5 + 0.5 * Math.sin(angle * 7 + index)));
            ctx.fillRect(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.985, 1, 1);
          }
          if (index % 2 === 0) {
            const angle = -0.62 + index * 1.9;
            const mx = cx + Math.cos(angle) * radius;
            const my = cy + Math.sin(angle) * radius * 0.985;
            ctx.globalAlpha = ringAlpha * 0.85;
            ctx.strokeStyle = "#12100d";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(mx - 4.5, my);
            ctx.lineTo(mx + 4.5, my);
            ctx.moveTo(mx, my - 4.5);
            ctx.lineTo(mx, my + 4.5);
            ctx.stroke();
            ctx.globalAlpha = ringAlpha * 0.6;
            ctx.fillStyle = "#12100d";
            ctx.font = '500 9.5px "Martian Mono", monospace';
            ctx.textAlign = "left";
            ctx.fillText(`${formatFr(line.twoTheta, 2)} °`, mx + 10, my - 2);
            ctx.fillText(`d ${formatFr(line.d, 2)} Å   ${line.hkl}`, mx + 10, my + 10);
          }
        });
      }

      // Atomes : interpolation réseau ↔ nuage.
      for (let i = 0; i < GEOMETRY.lattice.length; i += 1) {
        const site = GEOMETRY.lattice[i];
        const loose = GEOMETRY.amorphous[i];
        const x = loose.x + (site.x - loose.x) * o;
        const y = loose.y + (site.y - loose.y) * o;
        const z = loose.z + (site.z - loose.z) * o;
        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;
        const y1 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        const depth = 3.9 / (3.9 + z2 * 0.42);
        ctx.globalAlpha = (0.2 + 0.62 * depth * depth) * (0.35 + o * 0.65);
        ctx.fillStyle = "#12100d";
        ctx.beginPath();
        ctx.arc(
          cx + x1 * scale * 0.3 * depth,
          cy + y1 * scale * 0.3 * depth,
          Math.max(0.35, (site.big ? 2.35 : 1.35) * depth * (0.55 + o * 0.45)),
          0,
          2 * Math.PI,
        );
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      if (!still) frameRef.current = window.requestAnimationFrame(paint);
    },
    [still],
  );

  useEffect(() => {
    shownRef.current = orderRef.current;
    if (still) {
      paint(0);
    } else {
      frameRef.current = window.requestAnimationFrame(paint);
    }
    const onResize = () => {
      if (still) paint(0);
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      window.removeEventListener("resize", onResize);
    };
  }, [paint, still]);

  const onPointerDown = (event) => {
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!dragRef.current) return;
    rotationRef.current.y += (event.clientX - dragRef.current.x) * 0.0075;
    rotationRef.current.x = Math.max(
      -1.2,
      Math.min(1.2, rotationRef.current.x + (event.clientY - dragRef.current.y) * 0.005),
    );
    dragRef.current = { x: event.clientX, y: event.clientY };
    if (still) paint(0);
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const applyOrder = (value) => {
    const next = Math.max(0, Math.min(1, value));
    orderRef.current = next;
    setOrder(next);
    if (still) {
      shownRef.current = next;
      paint(0);
    }
  };

  const readout = scherrer(order);

  return (
    <div className="mineral-field">
      <canvas
        ref={canvasRef}
        className="mineral-field__canvas"
        role="img"
        aria-label={tr("Réseau cristallin interactif : faire glisser pour orienter.")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      />
      <div className="mineral-field__control">
        <div className="mineral-field__scale">
          <span>{tr("Amorphe")}</span>
          <span>{tr("Cristallin")}</span>
        </div>
        <label className="mineral-field__label" htmlFor="mineral-order">
          {tr("Degré de cristallinité")}
        </label>
        <input
          id="mineral-order"
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(order * 100)}
          onChange={(event) => applyOrder(Number(event.target.value) / 100)}
        />
        <dl className="mineral-field__readout">
          <div>
            <dt>{tr("Ordre")}</dt>
            <dd>{Math.round(order * 100)} %</dd>
          </div>
          <div>
            <dt>{tr("Largeur à mi-hauteur")} 211</dt>
            <dd>{formatFr(readout.fwhmDeg, 2)} °</dd>
          </div>
          <div>
            <dt>{tr("Taille de cristallite")}</dt>
            <dd>{formatFr(readout.sizeNm, 1)} nm</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
