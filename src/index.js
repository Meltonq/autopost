import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

import { loadTheme } from "./themeLoader.js";
import { createGenerator } from "./generator/index.js";
import { buildPrompt, pickBrief } from "./generator/prompt.js";
import { createStores } from "./storage/index.js";
import { similarity } from "./validation/similarity.js";
import { validateCaption } from "./validation/captionValidator.js";
import { scheduleDailyAt, scheduleHourly, scheduleAtHours } from "./scheduler/index.js";
import { getTimePartsInTZ, isActiveHours, parseHHMM } from "./scheduler/time.js";
import { pickLocalImage, contentTypeFromPath } from "./media/local.js";
import { pickUnsplashImage } from "./media/unsplash.js";

dotenv.config();

process.env.NTBA_FIX_350 = process.env.NTBA_FIX_350 || "1";

const REQUIRED_ENV = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

const BOT_THEME = process.env.BOT_THEME || "default";
const THEMES_DIR = process.env.THEMES_DIR || "./src/themes";
const { theme, usedPath } = loadTheme(BOT_THEME, { themesDir: THEMES_DIR });

const TIMEZONE = process.env.BOT_TIMEZONE || "Europe/Helsinki";
const ACTIVE_HOURS_START = Number(process.env.ACTIVE_HOURS_START ?? 7);
const ACTIVE_HOURS_END = Number(process.env.ACTIVE_HOURS_END ?? 23);
const SEND_TEST_ON_START = String(process.env.SEND_TEST_ON_START ?? "false") === "true";

const MAIN_SCHEDULE_MODE = (process.env.MAIN_SCHEDULE_MODE || theme.schedule?.mode || "hourly").toLowerCase();
const MAIN_POST_TIME = process.env.MAIN_POST_TIME || theme.schedule?.time || "12:00";
const MAIN_POST_HOURS = process.env.MAIN_POST_HOURS || theme.schedule?.hours || "8,12,18";
const MAIN_POST_MINUTE = Number(process.env.MAIN_POST_MINUTE ?? theme.schedule?.minute ?? 0);

const DAILY_RUBRIC_ENABLED = String(process.env.DAILY_RUBRIC_ENABLED ?? "false") === "true";
const DAILY_RUBRIC_NAME = process.env.DAILY_RUBRIC_NAME || "Daily Energy";
const DAILY_RUBRIC_TIME = process.env.DAILY_RUBRIC_TIME || "08:30";
const DAILY_RUBRIC_TONE = process.env.DAILY_RUBRIC_TONE || theme.tones?.[0] || "спокойный";

const IMAGE_MODE = (process.env.IMAGE_MODE || "auto").toLowerCase();
const USE_UNSPLASH = String(process.env.USE_UNSPLASH || "false").toLowerCase() === "true";
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || "";
const UNSPLASH_APP_NAME = process.env.UNSPLASH_APP_NAME || "universal-bot";
const UNSPLASH_ORIENTATION = process.env.UNSPLASH_ORIENTATION || "portrait";
const UNSPLASH_CONTENT_FILTER = process.env.UNSPLASH_CONTENT_FILTER || "high";
const UNSPLASH_IMG_W = Number(process.env.UNSPLASH_IMG_W || 1280);
const UNSPLASH_IMG_Q = Number(process.env.UNSPLASH_IMG_Q || 80);
const UNSPLASH_QUERY_DEFAULT = process.env.UNSPLASH_QUERY_DEFAULT || "minimal calm";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const IMAGES_DIR = path.resolve(process.env.IMAGES_DIR || "./images");
const IMAGES_DIRS = (process.env.IMAGES_DIRS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });
for (const dir of IMAGES_DIRS) {
  fs.mkdirSync(dir, { recursive: true });
}

const TG_MAX_PHOTO_BYTES = Number(process.env.TG_MAX_PHOTO_BYTES || 1900000);
const VALIDATION_REPORT_INTERVAL = Number(process.env.VALIDATION_REPORT_INTERVAL_MS || 24 * 60 * 60 * 1000);

const generator = createGenerator({
  provider: process.env.LLM_PROVIDER,
  genApiKey: process.env.GENAPI_API_KEY,
  genApiEndpoint: process.env.GENAPI_ENDPOINT,
  genApiModel: process.env.GENAPI_MODEL,
  temperature: Number(process.env.LLM_TEMPERATURE ?? 0.85),
  topP: Number(process.env.LLM_TOP_P ?? 0.9),
  maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 600),
});

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: String(process.env.COMMANDS_ENABLED ?? "true") === "true",
});
const channelId = process.env.TELEGRAM_CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID || "";

const stores = createStores({ dataDir: DATA_DIR });

const logContext = {
  theme: theme.name || BOT_THEME,
  schedule: MAIN_SCHEDULE_MODE,
  timezone: TIMEZONE,
};

console.log("🎛 Theme loaded:", logContext, { path: usedPath });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(fn, { retries = 3, baseDelay = 500, label = "action" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = baseDelay * 2 ** attempt + Math.floor(Math.random() * 200);
      console.warn(`⚠️ ${label} failed (attempt ${attempt + 1}/${retries + 1}):`, err?.message || err);
      if (attempt < retries) await sleep(delay);
    }
  }
  throw lastErr;
}

function recordValidationResult({ ok, reasons }) {
  stores.validationStats.update((stats) => {
    const next = stats || { totalAttempts: 0, failedAttempts: 0, reasons: {} };
    next.totalAttempts += 1;
    if (!ok) next.failedAttempts += 1;
    for (const reason of reasons || []) {
      next.reasons[reason] = (next.reasons[reason] || 0) + 1;
    }
    return next;
  });
}

function logValidationSummary() {
  const stats = stores.validationStats.read();
  const entries = Object.entries(stats.reasons || {}).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 5).map(([k, v]) => `${k}:${v}`).join(", ");
  console.log(`📊 Валидация: всего=${stats.totalAttempts} ошибки=${stats.failedAttempts} топ=${top || "нет"}`);
}

function pickFrom(list, exclude) {
  const options = exclude ? list.filter((item) => item !== exclude) : list;
  const pool = options.length ? options : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

function getLastMemory() {
  const memory = stores.postsMemory.read();
  const last = memory[memory.length - 1];
  return { memory, last };
}

async function generateCaption({ rubric, tone, cta }) {
  const brief = pickBrief(theme, rubric);
  const prompt = buildPrompt({ theme, rubric, tone, cta, brief });
  const text = await withRetry(
    () => generator.generate({ system: prompt.system, user: prompt.user, timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 60000) }),
    { label: "llm" }
  );
  return text.trim();
}

async function pickImage({ rubric }) {
  if (IMAGE_MODE === "off") return null;

  const preferUnsplash = IMAGE_MODE === "unsplash" || (IMAGE_MODE === "auto" && USE_UNSPLASH);
  if (preferUnsplash && UNSPLASH_ACCESS_KEY) {
    return pickUnsplashImage({
      accessKey: UNSPLASH_ACCESS_KEY,
      appName: UNSPLASH_APP_NAME,
      rubric,
      theme,
      usedStore: stores.unsplashUsed,
      orientation: UNSPLASH_ORIENTATION,
      contentFilter: UNSPLASH_CONTENT_FILTER,
      maxBytes: TG_MAX_PHOTO_BYTES,
      imgWidth: UNSPLASH_IMG_W,
      imgQuality: UNSPLASH_IMG_Q,
      defaultQuery: UNSPLASH_QUERY_DEFAULT,
    });
  }

  if (IMAGE_MODE === "unsplash" && !UNSPLASH_ACCESS_KEY) {
    console.warn("⚠️ IMAGE_MODE=unsplash but UNSPLASH_ACCESS_KEY missing, falling back to local images");
  }

  const localPath = pickLocalImage({
    rubric,
    imagesDir: IMAGES_DIR,
    imagesDirs: IMAGES_DIRS,
    usedStore: stores.imagesUsed,
    maxBytes: TG_MAX_PHOTO_BYTES,
  });
  return { type: "local", path: localPath };
}

async function sendToTelegram({ text, image }) {
  if (!text) throw new Error("Empty text is not allowed");

  if (image?.type === "buffer") {
    await withRetry(
      () =>
        bot.sendPhoto(
          channelId,
          image.buffer,
          { caption: text, disable_web_page_preview: true },
          { filename: image.filename, contentType: image.contentType }
        ),
      { label: "telegram-photo" }
    );
    return;
  }

  if (image?.type === "local") {
    const stream = fs.createReadStream(image.path);
    const fileOptions = {
      filename: path.basename(image.path),
      contentType: contentTypeFromPath(image.path),
    };
    await withRetry(
      () => bot.sendPhoto(channelId, stream, { caption: text, disable_web_page_preview: true }, fileOptions),
      { label: "telegram-photo" }
    );
    return;
  }

  await withRetry(() => bot.sendMessage(channelId, text, { disable_web_page_preview: true }), { label: "telegram-message" });
}

async function post({ reason = "scheduled", rubricOverride, toneOverride, ctaOverride, dryRun = false } = {}) {
  if (!isActiveHours({ timezone: TIMEZONE, start: ACTIVE_HOURS_START, end: ACTIVE_HOURS_END })) {
    console.log(`🌙 Неактивные часы — пропуск (${reason}) (${TIMEZONE})`);
    return;
  }

  const { memory, last } = getLastMemory();
  const maxTries = Number(theme.captionRules?.maxTries ?? 4);
  const similarityThreshold = Number(theme.captionRules?.similarityThreshold ?? 0.45);

  if (dryRun && !adminChatId) {
    console.warn("⚠️ Dry run requested but ADMIN_CHAT_ID is not set.");
    return;
  }

  for (let i = 0; i < maxTries; i += 1) {
    const rubric = rubricOverride || pickFrom(theme.rubrics, last?.rubric);
    const tone = toneOverride || pickFrom(theme.tones, null);
    const cta = ctaOverride || pickFrom(theme.cta, last?.cta);

    let text;
    try {
      text = await generateCaption({ rubric, tone, cta });
    } catch (err) {
      console.error("❌ Generation failed:", err?.message || err);
      await sleep(800 + i * 400);
      continue;
    }

    const validation = validateCaption({ text, theme });
    recordValidationResult(validation);
    if (!validation.ok) {
      console.warn(`⚠️ Validation failed (${validation.reasons.join(", ")}). Retry ${i + 1}/${maxTries}`);
      continue;
    }

    const isDuplicate = memory.some((item) => similarity(item.text, text) > similarityThreshold);
    if (isDuplicate) {
      console.warn("⚠️ Similarity too high, regenerating");
      continue;
    }

    if (dryRun && adminChatId) {
      await bot.sendMessage(adminChatId, `🧪 Dry run (${rubric}/${tone})\n\n${text}`);
      console.log("✅ Dry run sent to admin", { rubric, tone, reason });
      return;
    }

    let image = null;
    try {
      image = await pickImage({ rubric });
    } catch (err) {
      console.warn("⚠️ Image selection failed, sending text-only:", err?.message || err);
      image = null;
    }

    await sendToTelegram({ text, image });

    memory.push({ ts: new Date().toISOString(), rubric, tone, cta, text });
    stores.postsMemory.write(memory.slice(-40));

    console.log(`✅ Опубликовано (${reason})`, {
      rubric,
      tone,
      image: image ? image.type : "none",
      time: getTimePartsInTZ(TIMEZONE),
    });
    return;
  }

  console.warn("⚠️ Все попытки исчерпаны, пост не опубликован");
}

function setupCommands() {
  if (!adminChatId) {
    console.log("ℹ️ ADMIN_CHAT_ID not set, commands are limited to channel posting only.");
  }

  bot.onText(/\/theme/, (msg) => {
    if (adminChatId && String(msg.chat.id) !== String(adminChatId)) return;
    bot.sendMessage(msg.chat.id, `Текущая тема: ${theme.name} (${BOT_THEME})`);
  });

  bot.onText(/\/post/, (msg) => {
    if (adminChatId && String(msg.chat.id) !== String(adminChatId)) return;
    post({ reason: "manual" });
    bot.sendMessage(msg.chat.id, "Пост поставлен в очередь на отправку в канал.");
  });

  bot.onText(/\/dryrun/, async (msg) => {
    if (adminChatId && String(msg.chat.id) !== String(adminChatId)) return;
    await post({ reason: "dryrun", dryRun: true });
  });
}

console.log(
  `🚀 Бот запущен. Активные часы ${ACTIVE_HOURS_START}:00–${ACTIVE_HOURS_END}:00 (${TIMEZONE}). MAIN=${MAIN_SCHEDULE_MODE}.`
);

logValidationSummary();
setInterval(logValidationSummary, VALIDATION_REPORT_INTERVAL);

setupCommands();

if (SEND_TEST_ON_START) {
  setTimeout(() => post({ reason: "startup-test" }), 1500);
}

if (MAIN_SCHEDULE_MODE === "hourly") {
  scheduleHourly(() => post({ reason: "hourly" }));
} else if (MAIN_SCHEDULE_MODE === "hours") {
  scheduleAtHours(
    { hours: MAIN_POST_HOURS, minute: MAIN_POST_MINUTE, timezone: TIMEZONE, activeHours: { start: ACTIVE_HOURS_START, end: ACTIVE_HOURS_END } },
    () => post({ reason: "hours" }),
    "main-bot"
  );
} else if (MAIN_SCHEDULE_MODE === "daily") {
  scheduleDailyAt(parseHHMM(MAIN_POST_TIME, "12:00"), () => post({ reason: "daily" }), "main-bot");
} else if (MAIN_SCHEDULE_MODE === "off") {
  console.log("⏸ MAIN_SCHEDULE_MODE=off — основной бот выключен");
} else {
  console.log(`⚠️ MAIN_SCHEDULE_MODE неизвестен: ${MAIN_SCHEDULE_MODE} (hourly|hours|daily|off)`);
}

if (DAILY_RUBRIC_ENABLED) {
  scheduleDailyAt(parseHHMM(DAILY_RUBRIC_TIME, "08:30"), () =>
    post({ reason: "daily-rubric", rubricOverride: DAILY_RUBRIC_NAME, toneOverride: DAILY_RUBRIC_TONE })
  );
  console.log(`🌞 Daily rubric enabled: ${DAILY_RUBRIC_NAME} at ${DAILY_RUBRIC_TIME}`);
}
