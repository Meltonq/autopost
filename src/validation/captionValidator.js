export function validateCaption({ text, theme }) {
  const rules = theme.captionRules || {};
  const min = Number(rules.min ?? 0);
  const max = Number(rules.max ?? Infinity);
  const minSoft = Number(rules.minSoft ?? min);
  const maxSoft = Number(rules.maxSoft ?? max);

  const clean = String(text || "").trim();
  const length = clean.length;
  const reasons = [];

  if (!clean) reasons.push("empty");

  if (length < min || length > max) {
    reasons.push("length_hard");
  }

  if (length < minSoft || length > maxSoft) {
    reasons.push("length_soft");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    length,
  };
}
