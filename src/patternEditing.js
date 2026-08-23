const LOCKED_PATTERN_EDITABLE_FIELDS = new Set([
  "locked",
  "labelDx",
  "labelDy",
  "labelFontSize",
  "labelBold",
]);

export function canUpdatePatternField(pattern, field) {
  return !pattern?.locked || LOCKED_PATTERN_EDITABLE_FIELDS.has(field);
}
