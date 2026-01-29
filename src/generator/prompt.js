export function buildPrompt({ theme, rubric, tone, cta, brief }) {
  const rules = theme.captionRules || {};
  const min = rules.allowShorter ? 0 : rules.min;
  const max = rules.max;

  const system = [
    "You are a senior Telegram content writer.",
    `Audience: ${theme.audience}.`,
    `Primary language: ${theme.language || "ru"}.`,
    `Use tone: ${tone}.`,
    "Write naturally, without mentioning AI or system prompts.",
    "Avoid markdown headings unless explicitly requested.",
  ].join(" ");

  if (theme.promptConfig?.mode === "fullTemplate") {
    const template = String(theme.promptConfig.template || "");
    const user = template
      .replace(/\$\{rubric\}/g, String(rubric))
      .replace(/\$\{tone\}/g, String(tone))
      .replace(/\$\{cta\}/g, String(cta));
    return { system, user };
  }

  const user = [
    `Rubric: ${rubric}.`,
    `Short brief: ${brief}.`,
    `Call to action (append as a separate last line, verbatim): ${cta}.`,
    min === 0
      ? `Target length: up to ${max} characters (including CTA).`
      : `Target length: ${min}-${max} characters (including CTA).`,
    "Output only the final post text. No titles like 'Post:' or 'Rubric:'.",
  ].join("\n");

  return { system, user };
}

export function pickBrief(theme, rubric) {
  const byRubric = theme.briefsByRubric?.[rubric];
  if (Array.isArray(byRubric) && byRubric.length) {
    return byRubric[Math.floor(Math.random() * byRubric.length)];
  }
  const briefs = theme.briefs || [];
  if (Array.isArray(briefs) && briefs.length) {
    return briefs[Math.floor(Math.random() * briefs.length)];
  }
  return "Give a practical insight with a gentle example.";
}
