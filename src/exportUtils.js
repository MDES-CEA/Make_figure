function finiteDimension(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * Build an export-only clone of the editor SVG.
 *
 * The editor changes the SVG width and height to implement canvas zoom. Those
 * display dimensions must never leak into exported files: otherwise
 * non-scaling strokes and raster output depend on the current editor zoom.
 */
export function prepareSvgForExport(svgElement, options = {}) {
  if (!svgElement) throw new Error("Figure SVG indisponible.");

  const width = finiteDimension(options.width);
  const height = finiteDimension(options.height);
  const clone = svgElement.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.removeAttribute("class");
  clone.removeAttribute("style");

  clone.querySelectorAll("[data-ui-only]").forEach((element) => element.remove());

  // Figure strokes are expressed in canonical SVG units. Let them scale with
  // the requested raster resolution instead of keeping a screen-pixel width.
  clone.querySelectorAll('[vector-effect="non-scaling-stroke"]').forEach((element) => {
    element.removeAttribute("vector-effect");
  });

  const background = clone.querySelector("[data-figure-background]");
  if (background) {
    background.setAttribute("fill", options.transparent ? "none" : (options.background || "#ffffff"));
  }

  return clone;
}

export function serializeSvgForExport(svgElement, options = {}) {
  const clone = prepareSvgForExport(svgElement, options);
  return new XMLSerializer().serializeToString(clone);
}

export function exportScaleLimits(width, height, requestedScale, options = {}) {
  const canonicalWidth = finiteDimension(width);
  const canonicalHeight = finiteDimension(height);
  const maximumDimension = finiteDimension(options.maximumDimension, 10000);
  const maximumPixels = finiteDimension(options.maximumPixels, 28000000);
  const requested = Math.max(0.25, finiteDimension(requestedScale));
  const pixelLimitedScale = Math.sqrt(maximumPixels / Math.max(1, canonicalWidth * canonicalHeight));
  return Math.max(0.25, Math.min(
    requested,
    maximumDimension / canonicalWidth,
    maximumDimension / canonicalHeight,
    pixelLimitedScale,
  ));
}

export function svgDataUrl(serializedSvg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializedSvg)}`;
}
