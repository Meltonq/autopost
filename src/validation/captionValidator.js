export function validateCaption({ text, theme }) {
  const rules = theme.captionRules || {};
  const min = Number(rules.min ?? 0);
  const max = Number(rules.max ?? Infinity);
  const telegramMax = Number(rules.telegramMax ?? 1024);
  const allowShorter = Boolean(rules.allowShorter);
  const minSoft = Number(rules.minSoft ?? min);
  const maxSoft = Number(rules.maxSoft ?? max);

  const clean = String(text || "").trim();
  const length = clean.length;
  const reasons = [];

  if (!clean) reasons.push("empty");

  const hardMin = allowShorter ? 0 : min;
  const hardMax = Number.isFinite(telegramMax) ? Math.min(max, telegramMax) : max;
  if (length < hardMin || length > hardMax) {
    reasons.push("length_hard");
  }

  const softMin = allowShorter ? 0 : minSoft;
  const softMax = Number.isFinite(telegramMax) ? Math.min(maxSoft, telegramMax) : maxSoft;
  if (length < softMin || length > softMax) {
    reasons.push("length_soft");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    length,
  };
}
