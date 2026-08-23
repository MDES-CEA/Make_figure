export const PHASE_DASH_SCOPES = Object.freeze({
  annotation: "annotationDashed",
  overlay: "overlayDashed",
  panel: "panelDashed",
});

export function isPhaseDashed(phase, scope) {
  const property = PHASE_DASH_SCOPES[scope];
  if (!property) return false;
  if (typeof phase?.[property] === "boolean") return phase[property];
  return Boolean(phase?.dashed);
}
