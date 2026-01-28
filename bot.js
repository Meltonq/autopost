import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { startDailyEnergy } from "./dailyEnergy.js";

dotenv.config();

// ===== node-telegram-bot-api deprecation fix =====
// Включает улучшенную отправку файлов (fix для предупреждения про content-type)
process.env.NTBA_FIX_350 = process.env.NTBA_FIX_350 || "1";

// ===== ENV CHECK =====
if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("Нет TELEGRAM_BOT_TOKEN");
if (!process.env.TELEGRAM_CHANNEL_ID) throw new Error("Нет TELEGRAM_CHANNEL_ID");
if (!process.env.GENAPI_API_KEY) throw new Error("Нет GENAPI_API_KEY");

// ===== Telegram =====
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const channelId = process.env.TELEGRAM_CHANNEL_ID;

// ===== ENV SETTINGS =====
const TIMEZONE = process.env.BOT_TIMEZONE || "Europe/Helsinki";

const ACTIVE_HOURS_START = Number(process.env.ACTIVE_HOURS_START ?? 7);
const ACTIVE_HOURS_END = Number(process.env.ACTIVE_HOURS_END ?? 23);

const SEND_TEST_ON_START = String(process.env.SEND_TEST_ON_START ?? "false") === "true";

const MAIN_SCHEDULE_MODE = (process.env.MAIN_SCHEDULE_MODE || "hourly").toLowerCase();
// MAIN_POST_TIME используется только в режиме daily (один раз в день)
const MAIN_POST_TIME = process.env.MAIN_POST_TIME || "12:00";
// ✅ Режим "hours": постить в конкретные часы (в TIMEZONE), например: "8,12,18"
// Минуты задаются отдельно (по умолчанию 00). Это сделано так, чтобы ты мог(ла) легко менять расписание в .env.
const MAIN_POST_HOURS = process.env.MAIN_POST_HOURS || "8,12,18";
const MAIN_POST_MINUTE = Number(process.env.MAIN_POST_MINUTE ?? 0);

const ENERGY_ENABLED = String(process.env.ENERGY_ENABLED ?? "true") === "true";
const ENERGY_POST_TIME = process.env.ENERGY_POST_TIME || "08:30";
const ENERGY_IMAGES_DIR = process.env.ENERGY_IMAGES_DIR || "./images/energy";

// ===== SETTINGS =====
const RUBRICS = ["clarity", "practice", "reflection"];
const TONES = ["спокойный", "поддерживающий", "вдохновляющий", "мягко-провокационный"];
const CTA = [
  "Как откликается? Напиши одно слово 👇",
  "Сохрани, чтобы вернуться позже ✨",
  "Хочешь продолжение этой темы?",
  "Замечаешь это у себя?",
  "Если было полезно — поставь реакцию ❤️",
];

const IMAGES_DIR = path.resolve("./images");
const USED_IMAGES_FILE = "./images_used.json";
const POSTS_MEMORY_FILE = "./posts_memory.json";

const CAPTION_LIMIT = 900;
const CAPTION_MIN = 500;
const CAPTION_MAX = 900;
const MAX_TRIES = 4;
const SIM_THRESHOLD = 0.45;

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
  // Возвращает дату/время "как в таймзоне", без сторонних библиотек.
  // Полезно для планировщиков: сравниваем часы/минуты именно в TIMEZONE.
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

  // Ключ даты в таймзоне (YYYY-MM-DD)
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return { year, month, day, hour, minute, dateKey };
}

// Активные часы: 07:00–23:00 (по TIMEZONE)
// Если окно "через полночь" — тоже поддерживается (редко)
function isActiveHours() {
  const hour = getHourInTZ(TIMEZONE);

  if (ACTIVE_HOURS_START < ACTIVE_HOURS_END) {
    return hour >= ACTIVE_HOURS_START && hour < ACTIVE_HOURS_END;
  }
  return hour >= ACTIVE_HOURS_START || hour < ACTIVE_HOURS_END;
}

// Универсальный ежедневный планировщик
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
function normalize(t) {
  return (t || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function similarity(a, b) {
  const A = new Set(normalize(a).split(" ").filter((w) => w.length > 3));
  const B = new Set(normalize(b).split(" ").filter((w) => w.length > 3));
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

// ===== Images =====
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

// ===== Generation =====
function pickNextRubric(prevRubric) {
  const options = prevRubric ? RUBRICS.filter((r) => r !== prevRubric) : RUBRICS;
  return options[Math.floor(Math.random() * options.length)];
}

function clampCaption(text) {
  if (!text) return "";
  return text.length <= CAPTION_LIMIT ? text : text.slice(0, CAPTION_LIMIT).trim();
}

async function generateCaption({ rubric, tone, cta }) {
  const prompt = `
Ты — автор Telegram-канала про коучинг для женщин 40+.
Пишешь как живой человек: спокойно, тепло, честно, без экспертного пафоса.

Контекст канала:
Коучинг для женщин 40+ по моделям GROW и Колесу жизни.
Темы: кризисы, самооценка, личные границы, усталость, принятие зрелой себя.
Формат канала: последовательная работа и регулярные практики (ритм 21 дня).
Нейрографика — опционально, не основной акцент.

Входные параметры:
РУБРИКА = ${rubric} (clarity | practice | reflection)
ТОН = ${tone}
CTA = "${cta}" (добавь в конце ДОСЛОВНО)

Задача:
Написать ОДИН caption под фото для Telegram.

Формат вывода (СТРОГО):
1) RUBRIC: clarity|practice|reflection
2) TITLE: короткий заголовок без тегов

Далее текст caption на русском.

Разметка:
— Используй Telegram HTML
— Разрешён ТОЛЬКО тег <b> для заголовка
— Никаких других HTML-тегов
— НЕ Markdown

Структура caption:
1) <b>Заголовок</b> (1 эмодзи)
2) 2–4 предложения: конкретный инсайт + пример ситуации БЕЗ имён (никаких «Ирина/Марина»). Пиши во 2-м лице («ты») или обезличенно.
3) Блок:
✨ Мини-практика:
— шаг
— шаг
4) CTA — отдельной строкой, без изменений
5) Последняя строка: 2–4 хэштега

Ограничения:
— Общая длина 500–900 символов (включая хэштеги)
— Без клише («поверь в себя», «выйти из зоны комфорта», «всё возможно»)
— Без ссылок
— Не упоминай ИИ
— Без обещаний быстрых результатов и гарантий

Подсказка по рубрикам:
clarity — ясность, выбор, приоритеты
practice — маленькое действие, наблюдение, шаг
reflection — чувства, пауза, честный взгляд на себя

Верни ТОЛЬКО текст в указанном формате.
`.trim();

  const res = await axios.post(
    "https://api.gen-api.ru/api/v1/networks/qwen-3",
    {
      is_sync: true,
      model: "qwen-plus",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "text" },
      temperature: 0.9,
      top_p: 0.95,
      max_new_tokens: 520,
    },
    {
      headers: { Authorization: `Bearer ${process.env.GENAPI_API_KEY}` },
      timeout: 60000,
    }
  );

  return (res.data?.response?.[0]?.message?.content || "").trim();
}

function parseModelOutput(raw) {
  const lines = (raw || "").split(/\r?\n/);
  const rubricLine = (lines[0] || "").trim();
  const titleLine = (lines[1] || "").trim();

  const rm = rubricLine.match(/^RUBRIC:\s*(clarity|practice|reflection)\s*$/i);
  const tm = titleLine.match(/^TITLE:\s*(.+)\s*$/i);

  const rubric = rm ? rm[1].toLowerCase() : null;
  const title = tm ? tm[1].trim() : null;
  const body = lines.slice(2).join("\n").trim();

  return { rubric, title, body };
}

// ✅ FIX: не превращаем <b>..</b> в b../b
function buildCaptionHTML(title, body) {
  const cleanTitle = (title || "")
    .replace(/<\/?b>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .trim();

  const cleanBody = (body || "")
    .replace(/<\/?b>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .trim();

  return clampCaption(`<b>${cleanTitle}</b>\n\n${cleanBody}`);
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<\/?b>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .trim();
}

function hasValidHashtags(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) return false;
  const tags = trimmed.split(/\s+/).filter(Boolean);
  return (
    tags.length >= 2 &&
    tags.length <= 4 &&
    tags.every((tag) => /^#[\p{L}\p{N}_-]+$/u.test(tag))
  );
}

function validateCaptionParts({ title, body, cta }) {
  const cleanTitle = stripHtml(title);
  const cleanBody = stripHtml(body);

  if (!cleanTitle || cleanTitle.length < 3) return false;
  if (!cleanBody || cleanBody.length < 200) return false;
  if (!cleanBody.includes("✨ Мини-практика:")) return false;

  const lines = cleanBody.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const stepsCount = lines.filter((line) => line.startsWith("—")).length;
  if (stepsCount < 2) return false;

  if (!lines.includes(cta)) return false;

  const hashtagLine = lines.at(-1);
  if (!hasValidHashtags(hashtagLine)) return false;

  const combined = stripHtml(buildCaptionHTML(cleanTitle, cleanBody));
  if (combined.length < CAPTION_MIN || combined.length > CAPTION_MAX) return false;

  return true;
}

// ===== Posting =====
async function post({ reason = "scheduled" } = {}) {
  if (!isActiveHours()) {
    console.log(`🌙 Неактивные часы — пропуск (${reason}) (${TIMEZONE})`);
    return;
  }

  const memory = readJson(POSTS_MEMORY_FILE, []);
  const lastRubric = memory.at(-1)?.rubric;

  for (let i = 0; i < MAX_TRIES; i++) {
    const rubricWanted = pickNextRubric(lastRubric);
    const tone = TONES[Math.floor(Math.random() * TONES.length)];
    const cta = CTA[Math.floor(Math.random() * CTA.length)];

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

    if (!validateCaptionParts({ title: parsed.title, body: parsed.body, cta })) continue;

    const caption = buildCaptionHTML(parsed.title || "Небольшая пауза", parsed.body);
    if (!caption || caption.length < 220) continue;
    if (memory.some((m) => similarity(m.text, caption) > SIM_THRESHOLD)) continue;

    let imagePath;
    try {
      imagePath = pickImage(rubric);
    } catch (e) {
      console.error(e.message);
      await bot.sendMessage(channelId, caption, { parse_mode: "HTML", disable_web_page_preview: true });
      memory.push({ ts: new Date().toISOString(), rubric, text: caption });
      writeJson(POSTS_MEMORY_FILE, memory.slice(-40));
      console.log(`✅ Опубликовано без фото (${reason})`, { rubric, tone });
      return;
    }

    // ✅ FIX: отправка фото как multipart через stream
    try {
      const stream = fs.createReadStream(imagePath);
      const fileOptions = {
        filename: path.basename(imagePath),
        contentType: contentTypeFromPath(imagePath),
      };
      await bot.sendPhoto(channelId, stream, { caption, parse_mode: "HTML" }, fileOptions);
    } catch (err) {
      console.error("HTML не прошёл, отправляю plain:", err.response?.data || err.message);
      const stream2 = fs.createReadStream(imagePath);
      const fileOptions2 = {
        filename: path.basename(imagePath),
        contentType: contentTypeFromPath(imagePath),
      };
      await bot.sendPhoto(
        channelId,
        stream2,
        { caption: caption.replace(/<\/?b>/g, "") },
        fileOptions2
      );
    }

    memory.push({ ts: new Date().toISOString(), rubric, text: caption });
    writeJson(POSTS_MEMORY_FILE, memory.slice(-40));

    console.log(`✅ Опубликовано (${reason})`, { rubric, tone, hour: getHourInTZ(TIMEZONE) });
    return;
  }

  console.log("❌ Не удалось сгенерировать уникальный пост");
}

// ===== Scheduler (hourly) =====
function scheduleHourly() {
  const now = new Date();
  const msToNextHour =
    (60 - now.getMinutes()) * 60 * 1000 -
    now.getSeconds() * 1000 -
    now.getMilliseconds();

  console.log(`⏱ До следующего часа: ${Math.max(0, Math.round(msToNextHour / 1000))} сек`);

  setTimeout(() => {
    post({ reason: "hourly" });
    setInterval(() => post({ reason: "hourly" }), 60 * 60 * 1000);
  }, msToNextHour);
}
// ===== Scheduler (specific hours) =====
function parseHoursList(value, fallback = "8,12,18") {
  // Принимает строку вида "8,12,18" или "08 12 18" и возвращает массив часов [8,12,18]
  const raw = String(value || fallback)
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const hours = raw
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23);

  // Уникальные + сортировка
  return [...new Set(hours)].sort((a, b) => a - b);
}

function scheduleAtHours({ hours, minute }, fn, label = "hours") {
  // Лёгкий "cron" без библиотек:
  // раз в 20 секунд проверяем текущее время в TIMEZONE и запускаем fn только один раз в минуту.
  const hoursList = parseHoursList(hours);
  const safeMinute = Math.min(59, Math.max(0, Number(minute) || 0));

  let lastRunKey = null;

  console.log(`🗓 ${label}: часы=${hoursList.join(",")} минуты=${String(safeMinute).padStart(2, "0")} (${TIMEZONE})`);

  setInterval(() => {
    if (!isActiveHours()) return;

    const t = getTimePartsInTZ(TIMEZONE);
    if (!hoursList.includes(t.hour)) return;
    if (t.minute !== safeMinute) return;

    // Один запуск на конкретную минуту
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

// Тестовый пост при старте (по желанию)
if (SEND_TEST_ON_START) {
  setTimeout(() => post({ reason: "startup-test" }), 1500);
}

// Основной бот: hourly/hours/daily/off
if (MAIN_SCHEDULE_MODE === "hourly") {
  scheduleHourly();
} else if (MAIN_SCHEDULE_MODE === "hours") {
  scheduleAtHours(
    { hours: MAIN_POST_HOURS, minute: MAIN_POST_MINUTE },
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

// Энергия дня
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
