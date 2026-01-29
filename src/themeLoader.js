import fs from "fs";
import path from "path";

export function loadTheme(themeName, { themesDir } = {}) {
  const dir = themesDir ? path.resolve(themesDir) : path.resolve("./src/themes");
  const safe = String(themeName || "default").trim();

  const candidates = [
    path.join(dir, `${safe}.json`),
    path.join(dir, "default.json"),
  ];

  let raw = null;
  let usedPath = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      raw = fs.readFileSync(p, "utf8");
      usedPath = p;
      break;
    }
  }

  if (!raw) {
    throw new Error(`Theme not found. Looked in: ${candidates.join(", ")}`);
  }

  const theme = JSON.parse(raw);
  validateTheme(theme, usedPath);
  return { theme, usedPath };
}

function validateTheme(theme, where = "<theme>") {
  const need = (cond, msg) => {
    if (!cond) throw new Error(`Theme invalid (${where}): ${msg}`);
  };

  need(theme && typeof theme === "object", "not an object");
  need(Array.isArray(theme.rubrics) && theme.rubrics.length, "rubrics is required");
  need(Array.isArray(theme.tones) && theme.tones.length, "tones is required");
  need(Array.isArray(theme.cta) && theme.cta.length, "cta is required");
  need(theme.prompt && typeof theme.prompt === "object", "prompt is required");
  need(typeof theme.prompt.template === "string" && theme.prompt.template.trim().length, "prompt.template is required");

  const rules = theme.captionRules || {};
  need(Number.isFinite(rules.min), "captionRules.min must be a number");
  need(Number.isFinite(rules.max), "captionRules.max must be a number");
  need(rules.min < rules.max, "captionRules.min must be < max");
}
