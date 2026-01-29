export function validateCaption({ text, theme, cta, skipFullTemplate = false }) {
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

  if (theme.promptConfig?.mode === "fullTemplate" && !skipFullTemplate) {
    const minChars = Number(rules.minChars ?? 500);
    const maxChars = Number(rules.maxChars ?? 900);
    if (length < minChars || length > maxChars) {
      reasons.push("fulltemplate_length");
    }

    const tags = clean.match(/<\/?[^>]+>/g) || [];
    const invalidTag = tags.some((tag) => tag !== "<b>" && tag !== "</b>");
    if (invalidTag) {
      reasons.push("fulltemplate_html");
    }

    if (cta) {
      const lines = clean.split(/\r?\n/);
      const nonEmpty = lines.map((line) => line.trim()).filter((line) => line.length);
      if (nonEmpty.length < 2) {
        reasons.push("fulltemplate_cta_line");
      } else {
        const lastLine = nonEmpty[nonEmpty.length - 1];
        const ctaLine = nonEmpty[nonEmpty.length - 2];
        if (!/#\S+/.test(lastLine)) {
          reasons.push("fulltemplate_hashtags");
        }
        if (ctaLine !== cta) {
          reasons.push("fulltemplate_cta_line");
        }
      }
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    length,
  };
}
