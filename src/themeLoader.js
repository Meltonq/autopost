import fs from "fs";
import path from "path";

const ALLOWED_SCHEDULE_MODES = new Set(["hourly", "daily", "hours", "off"]);

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

  let theme;
  try {
    theme = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Theme invalid (${usedPath}): JSON parse error (${error.message})`);
  }

  validateTheme(theme, usedPath);
  return { theme, usedPath };
}

function validateTheme(theme, where = "<theme>") {
  const need = (cond, msg) => {
    if (!cond) throw new Error(`Theme invalid (${where}): ${msg}`);
  };

  need(theme && typeof theme === "object", "not an object");
  need(typeof theme.name === "string" && theme.name.trim(), "name is required");
  need(typeof theme.audience === "string" && theme.audience.trim(), "audience is required");
  need(Array.isArray(theme.rubrics) && theme.rubrics.length, "rubrics is required");
  need(Array.isArray(theme.tones) && theme.tones.length, "tones is required");
  need(Array.isArray(theme.cta) && theme.cta.length, "cta is required");

  const rules = theme.captionRules || {};
  need(Number.isFinite(rules.min), "captionRules.min must be a number");
  need(Number.isFinite(rules.max), "captionRules.max must be a number");
  need(rules.min < rules.max, "captionRules.min must be < max");
  if (rules.minSoft != null) {
    need(Number.isFinite(rules.minSoft), "captionRules.minSoft must be a number");
  }
  if (rules.maxSoft != null) {
    need(Number.isFinite(rules.maxSoft), "captionRules.maxSoft must be a number");
  }
  if (rules.maxTries != null) {
    need(Number.isFinite(rules.maxTries) && rules.maxTries > 0, "captionRules.maxTries must be > 0");
  }
  if (rules.similarityThreshold != null) {
    need(
      Number.isFinite(rules.similarityThreshold) && rules.similarityThreshold >= 0 && rules.similarityThreshold <= 1,
      "captionRules.similarityThreshold must be between 0 and 1"
    );
  }

  if (theme.schedule) {
    need(typeof theme.schedule === "object", "schedule must be an object");
    const mode = String(theme.schedule.mode || "").toLowerCase();
    need(ALLOWED_SCHEDULE_MODES.has(mode), `schedule.mode must be one of: ${[...ALLOWED_SCHEDULE_MODES].join(", ")}`);
    if (mode === "daily") {
      need(typeof theme.schedule.time === "string", "schedule.time must be HH:MM string for daily mode");
    }
    if (mode === "hours") {
      need(
        Array.isArray(theme.schedule.hours) || typeof theme.schedule.hours === "string",
        "schedule.hours must be array or comma string for hours mode"
      );
    }
  }

  if (theme.briefs && !Array.isArray(theme.briefs)) {
    need(false, "briefs must be an array when provided");
  }

  if (theme.briefsByRubric && typeof theme.briefsByRubric !== "object") {
    need(false, "briefsByRubric must be an object when provided");
  }

  if (theme.unsplash && typeof theme.unsplash !== "object") {
    need(false, "unsplash must be an object when provided");
  }
}
