import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

import { startDailyEnergy } from "./dailyEnergy.js";
import { loadTheme } from "./themeLoader.js";

dotenv.config();

// ===== node-telegram-bot-api deprecation fix =====
process.env.NTBA_FIX_350 = process.env.NTBA_FIX_350 || "1";

// ===== ENV CHECK =====
if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("Нет TELEGRAM_BOT_TOKEN");
if (!process.env.TELEGRAM_CHANNEL_ID) throw new Error("Нет TELEGRAM_CHANNEL_ID");
if (!process.env.GENAPI_API_KEY) throw new Error("Нет GENAPI_API_KEY");

// ===== Theme =====
const BOT_THEME = process.env.BOT_THEME || "default";
const THEMES_DIR = process.env.THEMES_DIR || "./src/themes";
const { theme, usedPath } = loadTheme(BOT_THEME, { themesDir: THEMES_DIR });
console.log(`🎛 Theme: ${theme.name || BOT_THEME} (${usedPath})`);

// ===== Telegram =====
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const channelId = process.env.TELEGRAM_CHANNEL_ID;

// ===== ENV SETTINGS =====
const TIMEZONE = process.env.BOT_TIMEZONE || "Europe/Helsinki";

const ACTIVE_HOURS_START = Number(process.env.ACTIVE_HOURS_START ?? 7);
const ACTIVE_HOURS_END = Number(process.env.ACTIVE_HOURS_END ?? 23);
const SEND_TEST_ON_START = String(process.env.SEND_TEST_ON_START ?? "false") === "true";

const MAIN_SCHEDULE_MODE = (process.env.MAIN_SCHEDULE_MODE || "hourly").toLowerCase();
const MAIN_POST_TIME = process.env.MAIN_POST_TIME || "12:00";
const MAIN_POST_HOURS = process.env.MAIN_POST_HOURS || "8,12,18";
const MAIN_POST_MINUTE = Number(process.env.MAIN_POST_MINUTE ?? 0);

const ENERGY_ENABLED = String(process.env.ENERGY_ENABLED ?? "true") === "true";
const ENERGY_POST_TIME = process.env.ENERGY_POST_TIME || "08:30";
const ENERGY_IMAGES_DIR = process.env.ENERGY_IMAGES_DIR || "./images/energy";

// --- Unsplash (optional) ---
const USE_UNSPLASH = String(process.env.USE_UNSPLASH || "false").toLowerCase() === "true";
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || "";
const UNSPLASH_APP_NAME = process.env.UNSPLASH_APP_NAME || "neyro-bot";

// Telegram multipart limit (form-data default ~2MB)
const TG_MAX_PHOTO_BYTES = Number(process.env.TG_MAX_PHOTO_BYTES || 1900000);

const UNSPLASH_IMG_W = Number(process.env.UNSPLASH_IMG_W || 1280);
const UNSPLASH_IMG_Q = Number(process.env.UNSPLASH_IMG_Q || 80);
const UNSPLASH_ORIENTATION = process.env.UNSPLASH_ORIENTATION || "portrait";
const UNSPLASH_CONTENT_FILTER = process.env.UNSPLASH_CONTENT_FILTER || "high";

// ===== Directories =====
const IMAGES_DIR = path.resolve(process.env.IMAGES_DIR || "./images");
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// ===== Data files =====
const USED_IMAGES_FILE = path.join(DATA_DIR, "images_used.json");
const POSTS_MEMORY_FILE = path.join(DATA_DIR, "posts_memory.json");
const VALIDATION_STATS_FILE = path.join(DATA_DIR, "validation_stats.json");
const UNSPLASH_USED_FILE = path.join(DATA_DIR, "unsplash_used.json");

// ===== Theme-derived constants =====
const RUBRICS = theme.rubrics;
const TONES = theme.tones;
const CTA = theme.cta;

const CAPTION_MIN = theme.captionRules.min;
const CAPTION_MAX = theme.captionRules.max;
const CAPTION_MIN_SOFT = theme.captionRules.minSoft ?? CAPTION_MIN;
const CAPTION_MAX_SOFT = theme.captionRules.maxSoft ?? CAPTION_MAX;
const MAX_TRIES = theme.captionRules.maxTries ?? 4;
const SIM_THRESHOLD = theme.captionRules.similarityThreshold ?? 0.45;

const VALIDATION_REPORT_INTERVAL = Number(process.env.VALIDATION_REPORT_INTERVAL_MS || 24 * 60 * 60 * 1000);

// ===== Utils =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function contentTypeFromPath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function parseHHMM(value, fallback = "08:30") {
  const v = String(value || fallback).trim();
  const m = v.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return { hour: 8, minute: 30 };
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function getHourInTZ(tz) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "00";
  return Number(hourStr);
}

function getTimePartsInTZ(tz) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type, fallback = "00") => parts.find((p) => p.type === type)?.value ?? fallback;

  const year = Number(get("year", "1970"));
  const month = Number(get("month", "01"));
  const day = Number(get("day", "01"));
  const hour = Number(get("hour", "00"));
  const minute = Number(get("minute", "00"));

  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, hour, minute, dateKey };
}

function isActiveHours() {
  const hour = getHourInTZ(TIMEZONE);

  if (ACTIVE_HOURS_START < ACTIVE_HOURS_END) {
    return hour >= ACTIVE_HOURS_START && hour < ACTIVE_HOURS_END;
  }
  return hour >= ACTIVE_HOURS_START || hour < ACTIVE_HOURS_END;
}

function scheduleDailyAt({ hour, minute }, fn, label = "daily") {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);

  const delay = target - now;
  console.log(`🗓 ${label}: через ${Math.round(delay / 60000)} мин`);

  setTimeout(() => {
    fn();
    setInterval(fn, 24 * 60 * 60 * 1000);
  }, delay);
}

// ===== Similarity =====
const STOP_WORDS = new Set([
  "это",
  "как",
  "что",
  "чтобы",
  "когда",
  "тогда",
  "есть",
  "еще",
  "ещё",
  "вот",
  "тут",
  "там",
  "про",
  "при",
  "для",
  "без",
  "или",
  "она",
  "оно",
  "они",
  "ты",
  "вы",
  "мы",
  "он",
  "тот",
  "эта",
  "эти",
  "твой",
  "тебя",
  "твое",
  "вас",
  "ваши",
  "себя",
  "здесь",
  "будто",
  "тоже",
  "уже",
  "теперь",
]);

function normalize(t) {
  return (t || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toWordSet(text) {
  return new Set(
    normalize(text)
      .split(" ")
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  );
}

function toBigramSet(text) {
  const words = normalize(text)
    .split(" ")
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]}_${words[i + 1]}`);
  }
  return new Set(bigrams);
}

function jaccard(setA, setB) {
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  return inter / (setA.size + setB.size - inter || 1);
}

function similarity(a, b) {
  const wordScore = jaccard(toWordSet(a), toWordSet(b));
  const bigramScore = jaccard(toBigramSet(a), toBigramSet(b));
  return wordScore * 0.6 + bigramScore * 0.4;
}

// ===== Unsplash helpers =====
async function unsplashGetRandomPhoto({ query, orientation, content_filter }) {
  const res = await axios.get("https://api.unsplash.com/photos/random", {
    headers: {
      Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
      "Accept-Version": "v1",
      "User-Agent": `tg-bot/${UNSPLASH_APP_NAME}`,
    },
    params: { query, orientation, content_filter },
    timeout: 30000,
  });
  return res.data;
}

async function unsplashTrackDownload(download_location) {
  const res = await axios.get(download_location, {
    headers: {
      Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
      "Accept-Version": "v1",
      "User-Agent": `tg-bot/${UNSPLASH_APP_NAME}`,
    },
    timeout: 30000,
  });
  return res.data?.url;
}

function withUnsplashParams(url, { w, q }) {
  const u = new URL(url);
  u.searchParams.set("w", String(w));
  u.searchParams.set("q", String(q));
  u.searchParams.set("fm", "jpg");
  u.searchParams.set("fit", "max");
  return u.toString();
}

async function fetchImageBufferSmart(url) {
  const candidates = [
    { w: UNSPLASH_IMG_W, q: UNSPLASH_IMG_Q },
    { w: Math.round(UNSPLASH_IMG_W * 0.8), q: Math.max(60, UNSPLASH_IMG_Q - 10) },
    { w: Math.round(UNSPLASH_IMG_W * 0.65), q: Math.max(55, UNSPLASH_IMG_Q - 15) },
  ];

  for (const c of candidates) {
    const finalUrl = withUnsplashParams(url, c);
    try {
      const head = await axios.head(finalUrl, { timeout: 15000, maxRedirects: 5 });
      const len = Number(head.headers["content-length"] || 0);
      const ct = String(head.headers["content-type"] || "image/jpeg");
      if (len && len > TG_MAX_PHOTO_BYTES) continue;

      const res = await axios.get(finalUrl, { responseType: "arraybuffer", timeout: 30000, maxRedirects: 5 });
      const buf = Buffer.from(res.data);
      if (buf.length > TG_MAX_PHOTO_BYTES) continue;

      return { buffer: buf, contentType: ct, finalUrl };
    } catch {
      // try next
    }
  }

  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000, maxRedirects: 5 });
  const buf = Buffer.from(res.data);
  if (buf.length > TG_MAX_PHOTO_BYTES) {
    throw new Error(`Unsplash image too large: ${buf.length} bytes (limit ${TG_MAX_PHOTO_BYTES})`);
  }
  return { buffer: buf, contentType: String(res.headers["content-type"] || "image/jpeg"), finalUrl: url };
}

function themeUnsplashQuery(rubric) {
  const map = theme?.unsplash?.queryByRubric || {};
  return map[rubric] || map.default || "minimal calm";
}

async function pickUnsplashImage(rubric) {
  if (!UNSPLASH_ACCESS_KEY) throw new Error("UNSPLASH_ACCESS_KEY is empty");
  const used = readJson(UNSPLASH_USED_FILE, { ids: [] });

  for (let i = 0; i < 5; i++) {
    const query = themeUnsplashQuery(rubric);

    const photo = await unsplashGetRandomPhoto({
      query,
      orientation: UNSPLASH_ORIENTATION,
      content_filter: UNSPLASH_CONTENT_FILTER,
    });

    if (!photo?.id || !photo?.links?.download_location) continue;
    if (used.ids.includes(photo.id)) continue;

    const fileUrl = await unsplashTrackDownload(photo.links.download_location);
    if (!fileUrl) continue;

    const { buffer, contentType } = await fetchImageBufferSmart(fileUrl);

    used.ids.push(photo.id);
    if (used.ids.length > 300) used.ids = used.ids.slice(-250);
    writeJson(UNSPLASH_USED_FILE, used);

    return {
      type: "buffer",
      buffer,
      filename: `unsplash_${photo.id}.jpg`,
      contentType: contentType || "image/jpeg",
    };
  }

  throw new Error("Не удалось выбрать фото из Unsplash (повторы или ошибка API)");
}

// ===== Images (local) =====
function pickImage(rubric) {
  const used = readJson(USED_IMAGES_FILE, {});
  if (!used[rubric]) used[rubric] = [];

  const dir = path.join(IMAGES_DIR, rubric);
  const files = fs.readdirSync(dir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
  if (!files.length) throw new Error(`Нет картинок в папке: ${dir}`);

  const available = files.filter((f) => !used[rubric].includes(f));
  const pool = available.length ? available : files;

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  used[rubric].push(chosen);

  if (used[rubric].length >= files.length) used[rubric] = [];
  writeJson(USED_IMAGES_FILE, used);

  return path.join(dir, chosen);
}

// ===== Generation helpers =====
function pickNextRubric(prevRubric) {
  const options = prevRubric ? RUBRICS.filter((r) => r !== prevRubric) : RUBRICS;
  return options[Math.floor(Math.random() * options.length)];
}

function pickCTA(lastCta) {
  const options = lastCta ? CTA.filter((item) => item !== lastCta) : CTA;
  const pool = options.length ? options : CTA;
  return pool[Math.floor(Math.random() * pool.length)];
}

function applyTemplate(str, vars) {
  let out = String(str || "");
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.replaceAll(`{{${k}}}`, String(v));
  }
  return out;
}

async function generateCaption({ rubric, tone, cta }) {
  const parseJson = (s) => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  };

  const requiredMap = parseJson(process.env.POST_REQUIRED_BLOCK_BY_RUBRIC);
  const requiredBlock =
    (requiredMap && rubric && requiredMap[rubric]) ||
    process.env.POST_REQUIRED_BLOCK ||
    "✨ Мини-практика:";

  const stepPrefix = process.env.POST_STEP_PREFIX || "—";
  const stepsMin = Number(process.env.POST_STEPS_MIN ?? 2);

  const prompt = applyTemplate(theme.prompt.template, {
    rubric,
    tone,
    cta,
    requiredBlock,
    stepPrefix,
    stepsMin,
  });

  const res = await axios.post(
    theme.prompt.endpoint,
    {
      is_sync: true,
      model: theme.prompt.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "text" },
      temperature: theme.prompt.temperature ?? 0.9,
      top_p: theme.prompt.top_p ?? 0.95,
      max_new_tokens: theme.prompt.max_new_tokens ?? 520,
    },
    {
      headers: { Authorization: `Bearer ${process.env.GENAPI_API_KEY}` },
      timeout: Number(process.env.GENAPI_TIMEOUT_MS || 60000),
    }
  );

  return (res.data?.response?.[0]?.message?.content || "").trim();
}

function parseModelOutput(raw) {
  const lines = (raw || "").split(/\r?\n/);
  const rubricLine = (lines[0] || "").trim();
  const titleLine = (lines[1] || "").trim();

  const rm = rubricLine.match(/^RUBRIC:\s*([a-z0-9_-]+)\s*$/i);
  const tm = titleLine.match(/^TITLE:\s*(.+)\s*$/i);

  const rubric = rm ? rm[1].toLowerCase() : null;
  const title = tm ? tm[1].trim() : null;
  const body = lines.slice(2).join("\n").trim();

  return { rubric, title, body };
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<\/?b>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .trim();
}

function getThemeValidation(theme) {
  // Theme-driven validation with safe defaults (no hardcoded "Мини-практика")
  const v = theme && theme.validation ? theme.validation : {};
  return {
    min_length: Number.isFinite(v.min_length) ? v.min_length : Number(process.env.CAPTION_MIN_HARD ?? 500),
    max_length: Number.isFinite(v.max_length) ? v.max_length : Number(process.env.CAPTION_MAX_HARD ?? 900),
    steps_min: Number.isFinite(v.steps_min) ? v.steps_min : Number(process.env.POST_STEPS_MIN ?? 0),
    step_prefixes: Array.isArray(v.step_prefixes) && v.step_prefixes.length ? v.step_prefixes : [process.env.POST_STEP_PREFIX || "—"],
    required_sections: Array.isArray(v.required_sections) ? v.required_sections : [],
    forbidden_sections: Array.isArray(v.forbidden_sections) ? v.forbidden_sections : []
  };
}

function normalizeLooseText(s) {
  return String(s || "")
    .replace(/\u00A0/g, " ")     // NBSP
    .replace(/\u2011/g, "-")     // non-breaking hyphen
    .replace(/[–—]/g, "-")       // dashes -> hyphen
    .replace(/[：]/g, ":")       // fullwidth colon
    .replace(/[ \t]+/g, " ")
    .trim();
}

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeSectionRegex(label) {
  const safe = escapeRegex(normalizeLooseText(label)).replace(/-/g, "[-]");
  // allow leading emojis/symbols/spaces; match "Label:" at line start
  return new RegExp(`(^|\\n)\\s*[^\\p{L}\\p{N}]*${safe}\\s*[:.]\\s*(?=\\n|$)`, "iu");
}

function dedupeAdjacentLines(text) {
  const lines = String(text || "").split(/\\r?\\n/);
  const out = [];
  for (const line of lines) {
    const cur = line.trimEnd();
    const prev = out.length ? out[out.length - 1].trimEnd() : null;
    if (prev !== null && prev === cur) continue;
    out.push(line);
  }
  return out.join("\\n");
}

function dedupeStepLines(text, stepPrefixes) {
  const prefixes = Array.isArray(stepPrefixes) ? stepPrefixes : ["—"];
  const seen = new Set();
  const lines = String(text || "").split(/\\r?\\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    const isStep = prefixes.some((p) => t.startsWith(p));
    if (!isStep) {
      out.push(line);
      continue;
    }
    const key = normalizeLooseText(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.join("\\n");
}

function stripForbiddenSections(body, theme) {
  const v = getThemeValidation(theme);
  const forbidden = v.forbidden_sections || [];
  if (!forbidden.length) return body;

  const prefixes = v.step_prefixes || ["—"];
  const lines = String(body || "").split(/\\r?\\n/);

  const isHeader = (line) => {
    const n = normalizeLooseText(stripHtml(line));
    return forbidden.some((label) => makeSectionRegex(label).test("\\n" + n));
  };

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeader(line)) {
      // skip header and following step lines
      i += 1;
      while (i < lines.length) {
        const t = normalizeLooseText(stripHtml(lines[i]));
        if (!t) break;
        if (prefixes.some((p) => t.startsWith(p))) { i += 1; continue; }
        break;
      }
      i -= 1;
      continue;
    }
    out.push(line);
  }
  return out.join("\\n");
}


function buildCaptionHTML(title, body) {
  const cleanTitle = stripHtml(title)
    .replace(/\s+/g, " ")
    .trim();

  const cleanBody = stripHtml(body)
    .replace(/\s+\n/g, "\n")
    .trim();

  return `<b>${cleanTitle}</b>\n\n${cleanBody}`.trim();
}

// ===== Emoji utils (graphemes) =====
const EMOJI_RE = /[\p{Extended_Pictographic}]/u;

function emojiGraphemes(text) {
  const s = String(text || "").trim();
  if (!s) return [];
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  const out = [];
  for (const { segment } of seg.segment(s)) {
    if (EMOJI_RE.test(segment)) out.push(segment);
  }
  return out;
}

function startsWithEmoji(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  const it = seg.segment(s)[Symbol.iterator]();
  const first = it.next().value?.segment;
  return first ? EMOJI_RE.test(first) : false;
}

function countEmojis(text) {
  return emojiGraphemes(text).length;
}

function fixTitle(rawTitle) {
  const clean = stripHtml(rawTitle || "").replace(/\s+/g, " ").trim();

  const baseText =
    clean.replace(/[\p{Extended_Pictographic}]/gu, "").replace(/\s+/g, " ").trim() || "Небольшая пауза";

  const emojis = emojiGraphemes(clean);
  const emoji = emojis[0] || "✨";

  return `${emoji} ${baseText}`.trim();
}

function hasValidHashtags(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) return false;
  const tags = trimmed.split(/\s+/).filter(Boolean);
  return tags.length >= 2 && tags.length <= 4 && tags.every((tag) => /^#[\p{L}\p{N}_-]+$/u.test(tag));
}

function buildHashtagsFallback(rubric) {
  const pool = theme?.hashtags?.byRubric?.[rubric] || theme?.hashtags?.byRubric?.[RUBRICS[0]] || [];
  const common = theme?.hashtags?.common || [];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const shuffledCommon = [...common].sort(() => Math.random() - 0.5);

  const count = Math.min(4, Math.max(2, Math.floor(Math.random() * 3) + 2));
  const base = shuffled.slice(0, Math.max(1, count - 1));
  const extra = shuffledCommon.slice(0, Math.max(1, count - base.length));
  return [...base, ...extra].slice(0, count).join(" ");
}

async function generateHashtagLine({ rubric, title }) {
  const prompt = `
Сгенерируй строку из 2–4 хэштегов на русском.
Тема: ${rubric || RUBRICS[0]}.
Заголовок: ${title || "Без заголовка"}.
Требования:
- Только хэштеги, в одной строке
- Между хэштегами пробел
- Без эмодзи и без текста кроме хэштегов
- Каждый хэштег начинается с #
`.trim();

  try {
    const res = await axios.post(
      theme.prompt.endpoint,
      {
        is_sync: true,
        model: theme.prompt.model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "text" },
        temperature: 0.6,
        top_p: 0.9,
        max_new_tokens: 80,
      },
      {
        headers: { Authorization: `Bearer ${process.env.GENAPI_API_KEY}` },
        timeout: 30000,
      }
    );

    const line = String(res.data?.response?.[0]?.message?.content || "").trim().split(/\r?\n/)[0] || "";
    return hasValidHashtags(line) ? line : null;
  } catch (e) {
    console.error("Ошибка генерации хэштегов:", e.response?.data || e.message);
    return null;
  }
}

function rebuildBodyWithTail(body, cta, hashtagLine) {
  const lines = stripHtml(body)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== cta && !line.startsWith("#"));

  return [...lines, cta, hashtagLine].join("\n");
}



function ensureRequiredBlockAndSteps({ body, rubric, cta, theme }) {
  // Backward compatible name, but driven by theme.validation
  let out = String(body || "");
  const v = getThemeValidation(theme);

  // If theme explicitly forbids some sections (e.g., "Мини-практика") — remove them.
  out = stripForbiddenSections(out, theme);

  const required = (v.required_sections || []).filter((s) => s && s.required && s.label);
  const stepsMin = Number.isFinite(v.steps_min) ? v.steps_min : 0;
  const stepPrefixes = v.step_prefixes || ["—"];

  // Nothing to enforce
  if (!required.length && stepsMin <= 0) {
    // still dedupe noisy model output
    out = dedupeAdjacentLines(out);
    out = dedupeStepLines(out, stepPrefixes);
    return out;
  }

  const clean = stripHtml(out || "");
  const rawLines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1) Ensure required sections exist
  for (const sec of required) {
    const label = sec.label;
    const re = makeSectionRegex(label);
    const has = re.test("\n" + normalizeLooseText(clean));
    if (has) continue;

    // Insert section right before CTA if we can find it, else at end.
    const ctaIdx = cta ? rawLines.indexOf(cta) : -1;
    const insertAt = ctaIdx >= 0 ? ctaIdx : rawLines.length;

    const p = stepPrefixes[0] || "—";
    rawLines.splice(insertAt, 0, `${label}:`, `${p} `, `${p} `);
  }

  // 2) Ensure minimum number of step lines
  const countSteps = () =>
    rawLines.filter((l) => stepPrefixes.some((p) => l.startsWith(p))).length;

  let have = countSteps();
  const p = stepPrefixes[0] || "—";
  while (have < stepsMin) {
    rawLines.push(`${p} `);
    have += 1;
  }

  out = rawLines.join("\n");
  out = dedupeAdjacentLines(out);
  out = dedupeStepLines(out, stepPrefixes);
  return out;
}

function buildFallbackCaption({ rubric, cta }) {
  const tpl = theme?.fallbackTemplates?.[rubric] || theme?.fallbackTemplates?.[RUBRICS[0]];
  const title = tpl?.title || "✨ Пост";
  const body = tpl?.body || "✨ Мини-практика:\n— сделай паузу\n— отметь чувство";
  const hashtagLine = buildHashtagsFallback(rubric);
  const rebuilt = rebuildBodyWithTail(body, cta, hashtagLine);
  return buildCaptionHTML(title, rebuilt);
}

function validateCaptionParts({ rubric, title, body, cta, expectedRubric, theme }) {
  const cleanTitle = stripHtml(title);
  const cleanBodyRaw = String(body || "");
  const cleanBody = normalizeLooseText(stripHtml(cleanBodyRaw));
  const errors = [];

  const v = getThemeValidation(theme);
  const combined = normalizeLooseText([cleanTitle, stripHtml(cleanBodyRaw), cta].filter(Boolean).join("\n\n"));

  // title rules (keep existing behavior)
  if (!cleanTitle || cleanTitle.length < 3 || cleanTitle.length > 80) errors.push("bad_title");
  if (!startsWithEmoji(cleanTitle)) errors.push("title_missing_emoji");
  if (countEmojis(cleanTitle) !== 1) errors.push("title_emoji_count");

  if (!cleanBody || cleanBody.length < 200) errors.push("short_body");

  // required sections (theme-driven)
  const required = (v.required_sections || []).filter((s) => s && s.required && s.label);
  for (const sec of required) {
    const re = makeSectionRegex(sec.label);
    if (!re.test("\n" + cleanBody)) {
      // keep legacy code for practice to avoid breaking logs
      if (sec.id === "practice") errors.push("missing_practice_block");
      else errors.push(`missing_section:${sec.id || "unknown"}`);
    }
  }

  // steps (theme-driven)
  const lines = cleanBodyRaw.split(/\r?\n/).map((line) => normalizeLooseText(stripHtml(line))).filter(Boolean);
  const stepsCount = lines.filter((line) => (v.step_prefixes || ["—"]).some((p) => line.startsWith(p))).length;
  if (stepsCount < (v.steps_min ?? 0)) errors.push("not_enough_steps");

  // CTA present
  if (cta) {
    const hasCTA = lines.some((l) => normalizeLooseText(l) === normalizeLooseText(cta));
    if (!hasCTA) errors.push("cta_missing");
  }

  // Hashtag line (same as before, but tolerant)
  const last = lines.length ? lines[lines.length - 1] : "";
  const hashtags = (last.match(/#[\p{L}\p{N}_]+/gu) || []);
  if (hashtags.length < 2 || hashtags.length > 6) errors.push("bad_hashtags");

  // rubric check
  if (expectedRubric && rubric && rubric !== expectedRubric) errors.push("wrong_rubric");

  // length
  if (combined.length < v.min_length || combined.length > v.max_length) errors.push("bad_length");

  return { ok: errors.length === 0, errors, length: combined.length, stepsCount };
}

function readValidationStats() {
  return readJson(VALIDATION_STATS_FILE, { total: 0, reasons: {} });
}

function writeValidationStats(stats) {
  writeJson(VALIDATION_STATS_FILE, stats);
}

function recordValidationFailure(errors = []) {
  const stats = readValidationStats();
  stats.total += 1;
  for (const reason of errors) {
    stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
  }
  writeValidationStats(stats);
}

function logValidationSummary() {
  const stats = readValidationStats();
  const entries = Object.entries(stats.reasons).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 5).map(([k, v]) => `${k}:${v}`).join(", ");
  console.log(`📊 Валидация: всего=${stats.total} топ=${top || "нет"}`);
}

// ===== Posting =====
async function post({ reason = "scheduled" } = {}) {
  if (!isActiveHours()) {
    console.log(`🌙 Неактивные часы — пропуск (${reason}) (${TIMEZONE})`);
    return;
  }

  const memory = readJson(POSTS_MEMORY_FILE, []);
  const lastEntry = memory.at(-1);
  const lastRubric = lastEntry?.rubric;
  const lastCta = lastEntry?.cta;

  for (let i = 0; i < MAX_TRIES; i++) {
    const rubricWanted = pickNextRubric(lastRubric);
    const tone = TONES[Math.floor(Math.random() * TONES.length)];
    const cta = pickCTA(lastCta);

    let raw;
    try {
      raw = await generateCaption({ rubric: rubricWanted, tone, cta });
    } catch (e) {
      console.error("Ошибка генерации:", e.response?.data || e.message);
      await sleep(1000 + i * 600);
      continue;
    }

    const parsed = parseModelOutput(raw);
    const rubric = parsed.rubric || rubricWanted;

    if (rubric === lastRubric) continue;

    const fixedTitle = fixTitle(parsed.title);
    let body = parsed.body;

    body = ensureRequiredBlockAndSteps({ body, rubric, cta, theme });

    let validation = validateCaptionParts({ rubric, title: fixedTitle, body, cta, expectedRubric: rubricWanted, theme });

    if (!validation.ok) {
      const reasons = validation.errors || [];
      if (reasons.includes("bad_hashtags") || reasons.includes("cta_missing") || reasons.includes("cta_position")) {
        const hashtagLine = (await generateHashtagLine({ rubric, title: fixedTitle })) || buildHashtagsFallback(rubric);
        body = rebuildBodyWithTail(body, cta, hashtagLine);
        validation = validateCaptionParts({ rubric, title: fixedTitle, body, cta, expectedRubric: rubricWanted, theme });
      }
    }

    if (!validation.ok) {
      recordValidationFailure(validation.errors || []);
      console.log(`⚠️ Валидация поста не пройдена: ${(validation.errors || []).join(",")}`);
      continue;
    }

    if (validation.warnings?.length) {
      console.log(`⚠️ Валидация с предупреждением: ${validation.warnings.join(",")}`);
    }

    const caption = buildCaptionHTML(fixedTitle, body);
    if (!caption || caption.length < 220) continue;
    if (memory.some((m) => similarity(m.text, caption) > SIM_THRESHOLD)) continue;

    let imageAsset = null;
    try {
      if (USE_UNSPLASH) imageAsset = await pickUnsplashImage(rubric);
      if (!imageAsset) {
        const p = pickImage(rubric);
        imageAsset = { type: "local", path: p };
      }
    } catch (e) {
      console.warn("⚠️ Images failed, sending text-only:", e?.message || e);
      imageAsset = null;
    }

    try {
      if (imageAsset?.type === "buffer") {
        await bot.sendPhoto(channelId, imageAsset.buffer, { caption, parse_mode: "HTML" }, { filename: imageAsset.filename, contentType: imageAsset.contentType });
      } else if (imageAsset?.type === "local") {
        const stream = fs.createReadStream(imageAsset.path);
        const fileOptions = { filename: path.basename(imageAsset.path), contentType: contentTypeFromPath(imageAsset.path) };
        await bot.sendPhoto(channelId, stream, { caption, parse_mode: "HTML" }, fileOptions);
      } else {
        await bot.sendMessage(channelId, caption, { parse_mode: "HTML", disable_web_page_preview: true });
      }
    } catch (e) {
      console.error("❌ Telegram send failed:", e?.message || e);
      await bot.sendMessage(channelId, caption, { parse_mode: "HTML", disable_web_page_preview: true });
    }

    memory.push({ ts: new Date().toISOString(), rubric, cta, text: caption });
    writeJson(POSTS_MEMORY_FILE, memory.slice(-40));

    console.log(`✅ Опубликовано (${reason})`, { rubric, tone, image: imageAsset ? imageAsset.type : "none", hour: getHourInTZ(TIMEZONE) });
    return;
  }

  const memory2 = readJson(POSTS_MEMORY_FILE, []);
  const lastEntry2 = memory2.at(-1);
  const lastRubric2 = lastEntry2?.rubric;
  const lastCta2 = lastEntry2?.cta;

  const fallbackRubric = pickNextRubric(lastRubric2);
  const fallbackCta = pickCTA(lastCta2);
  const fallbackCaption = buildFallbackCaption({ rubric: fallbackRubric, cta: fallbackCta });

  console.log("⚠️ Публикую запасной пост");
  await bot.sendMessage(channelId, fallbackCaption, { parse_mode: "HTML", disable_web_page_preview: true });
  memory2.push({ ts: new Date().toISOString(), rubric: fallbackRubric, cta: fallbackCta, text: fallbackCaption });
  writeJson(POSTS_MEMORY_FILE, memory2.slice(-40));
}

// ===== Scheduler (hourly) =====
function scheduleHourly() {
  const now = new Date();
  const msToNextHour = (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();
  console.log(`⏱ До следующего часа: ${Math.max(0, Math.round(msToNextHour / 1000))} сек`);

  setTimeout(() => {
    post({ reason: "hourly" });
    setInterval(() => post({ reason: "hourly" }), 60 * 60 * 1000);
  }, msToNextHour);
}

function parseHoursList(value, fallback = "8,12,18") {
  const raw = String(value || fallback)
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const hours = raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 23);
  return [...new Set(hours)].sort((a, b) => a - b);
}

function scheduleAtHours({ hours, minute }, fn, label = "hours") {
  const hoursList = parseHoursList(hours);
  const safeMinute = Math.min(59, Math.max(0, Number(minute) || 0));

  let lastRunKey = null;
  console.log(`🗓 ${label}: часы=${hoursList.join(",")} минуты=${String(safeMinute).padStart(2, "0")} (${TIMEZONE})`);

  setInterval(() => {
    if (!isActiveHours()) return;

    const t = getTimePartsInTZ(TIMEZONE);
    if (!hoursList.includes(t.hour)) return;
    if (t.minute !== safeMinute) return;

    const key = `${t.dateKey}-${t.hour}-${t.minute}`;
    if (key === lastRunKey) return;

    lastRunKey = key;
    fn();
  }, 20 * 1000);
}

// ===== Start =====
console.log(
  `🚀 Бот запущен. Активные часы ${ACTIVE_HOURS_START}:00–${ACTIVE_HOURS_END}:00 (${TIMEZONE}). MAIN=${MAIN_SCHEDULE_MODE}.`
);

logValidationSummary();
setInterval(logValidationSummary, VALIDATION_REPORT_INTERVAL);

if (SEND_TEST_ON_START) {
  setTimeout(() => post({ reason: "startup-test" }), 1500);
}

if (MAIN_SCHEDULE_MODE === "hourly") {
  scheduleHourly();
} else if (MAIN_SCHEDULE_MODE === "hours") {
  scheduleAtHours({ hours: MAIN_POST_HOURS, minute: MAIN_POST_MINUTE }, () => post({ reason: "hours" }), "main-bot");
} else if (MAIN_SCHEDULE_MODE === "daily") {
  scheduleDailyAt(parseHHMM(MAIN_POST_TIME, "12:00"), () => post({ reason: "daily" }), "main-bot");
} else if (MAIN_SCHEDULE_MODE === "off") {
  console.log("⏸ MAIN_SCHEDULE_MODE=off — основной бот выключен");
} else {
  console.log(`⚠️ MAIN_SCHEDULE_MODE неизвестен: ${MAIN_SCHEDULE_MODE} (hourly|hours|daily|off)`);
}

if (ENERGY_ENABLED) {
  startDailyEnergy({
    bot,
    channelId,
    timezone: TIMEZONE,
    activeHoursStart: ACTIVE_HOURS_START,
    activeHoursEnd: ACTIVE_HOURS_END,
    postTime: parseHHMM(ENERGY_POST_TIME, "08:30"),
    imagesDir: ENERGY_IMAGES_DIR,
    genApiKey: process.env.GENAPI_API_KEY,
  });
} else {
  console.log("⏸ ENERGY_ENABLED=false — энергия дня выключена");
}
