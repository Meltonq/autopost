import axios from "axios";
import dns from "dns";
import fs from "fs";
import path from "path";

try { dns.setDefaultResultOrder("ipv4first"); } catch {}
// ===== Unsplash (optional, uses env from entrypoint) =====
const USE_UNSPLASH = String(process.env.USE_UNSPLASH ?? "false") === "true";
const UNSPLASH_ORIENTATION = process.env.UNSPLASH_ORIENTATION || "portrait";
const UNSPLASH_CONTENT_FILTER = process.env.UNSPLASH_CONTENT_FILTER || "high";
const UNSPLASH_APP_NAME = process.env.UNSPLASH_APP_NAME || "app";
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || "";
const UNSPLASH_USED_FILE = "./unsplash_used_energy.json";
const UNSPLASH_QUERY_ENERGY = process.env.UNSPLASH_QUERY_ENERGY || "calm morning, coffee, sunrise, minimal";

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch {}
}


function shouldRetryUnsplash(err) {
  const code = err?.code;
  const status = err?.response?.status;
  const netCodes = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ECONNABORTED"]);
  if (code && netCodes.has(code)) return true;
  if (status && [429, 500, 502, 503, 504].includes(status)) return true;
  return false;
}

async function unsplashRequest(getFn, retries = Number(process.env.UNSPLASH_RETRIES ?? 3)) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getFn();
    } catch (err) {
      lastErr = err;
      if (!shouldRetryUnsplash(err) || attempt === retries) break;
      const base = Number(process.env.UNSPLASH_RETRY_BASE_MS ?? 600);
      const jitter = Math.floor(Math.random() * 250);
      const delay = base * Math.pow(2, attempt) + jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function unsplashGetRandomPhoto({ query, orientation, content_filter }) {
  const headers = {
    Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
    "Accept-Version": "v1",
    "User-Agent": `tg-bot/${UNSPLASH_APP_NAME || "app"}`,
  };
  const params = { query, orientation, content_filter };

  const res = await unsplashRequest(() =>
    axios.get("https://api.unsplash.com/photos/random", {
      headers,
      params,
      timeout: Number(process.env.UNSPLASH_TIMEOUT_MS ?? 30000),
    })
  );

  return res.data;
}

async function unsplashTrackDownload(download_location) {
  const headers = {
    Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
    "Accept-Version": "v1",
    "User-Agent": `tg-bot/${UNSPLASH_APP_NAME || "app"}`,
  };

  const res = await unsplashRequest(() =>
    axios.get(download_location, {
      headers,
      timeout: Number(process.env.UNSPLASH_TIMEOUT_MS ?? 30000),
    })
  );

  return res.data?.url;
}

function buildUnsplashAttribution(photo) {
  const app = encodeURIComponent(UNSPLASH_APP_NAME);
  const userName = photo?.user?.name || "Unknown";
  const userLink = photo?.user?.links?.html || "";
  const photoLink = photo?.links?.html || "";
  const userUrl = userLink ? `${userLink}?utm_source=${app}&utm_medium=referral` : "";
  const unsplashUrl = `https://unsplash.com/?utm_source=${app}&utm_medium=referral`;

  return [
    `📷 Фото: ${userName} / Unsplash`,
    userUrl ? `Профиль автора: ${userUrl}` : null,
    photoLink ? `Страница фото: ${photoLink}?utm_source=${app}&utm_medium=referral` : null,
    `Unsplash: ${unsplashUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function pickUnsplashEnergyImage() {
  if (!USE_UNSPLASH) return null;
  if (!UNSPLASH_ACCESS_KEY) throw new Error("USE_UNSPLASH=true, но нет UNSPLASH_ACCESS_KEY");

  const used = readJsonSafe(UNSPLASH_USED_FILE, { ids: [] });

  for (let i = 0; i < 5; i++) {
    const photo = await unsplashGetRandomPhoto({
      query: UNSPLASH_QUERY_ENERGY,
      orientation: UNSPLASH_ORIENTATION,
      content_filter: UNSPLASH_CONTENT_FILTER,
    });

    if (!photo?.id || !photo?.links?.download_location) continue;
    if (used.ids.includes(photo.id)) continue;

let url = null;
try {
  url = await unsplashTrackDownload(photo.links.download_location);
} catch (e) {
  console.warn("Unsplash track download failed:", e?.code || e?.message || e);
}
if (!url) {
  url = photo?.urls?.regular || photo?.urls?.full || photo?.urls?.raw;
}
if (!url) continue;

    used.ids.push(photo.id);
    if (used.ids.length > 300) used.ids = used.ids.slice(-250);
    writeJsonSafe(UNSPLASH_USED_FILE, used);

    return { url, attribution: buildUnsplashAttribution(photo) };
  }

  return null;
}



// Если хочешь, можешь включить фикс и здесь (лучше — в entrypoint до импорта бота):
// process.env.NTBA_FIX_350 = "1";

const ENERGY_MIN = 350;
const ENERGY_MAX = 700;
const ENERGY_MAX_TRIES = 3;
const ENERGY_HASHTAGS = ["#энергиядня", "#утро", "#поддержка", "#настрой"];

function getHourInTZ(tz) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "00";
  return Number(hourStr);
}

function isActiveHours({ timezone, activeHoursStart, activeHoursEnd }) {
  const hour = getHourInTZ(timezone);

  if (activeHoursStart < activeHoursEnd) {
    return hour >= activeHoursStart && hour < activeHoursEnd;
  }
  return hour >= activeHoursStart || hour < activeHoursEnd;
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

function pickEnergyImage(imagesDir) {
  const dir = path.resolve(imagesDir);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
  if (!files.length) throw new Error(`Нет картинок в папке: ${dir}`);
  const chosen = files[Math.floor(Math.random() * files.length)];
  return path.join(dir, chosen);
}

function getTodayRu(timezone) {
  return new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: timezone,
  });
}

function mimeByExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  // fallback
  return "application/octet-stream";
}

function normalizeText(text) {
  return String(text || "").replace(/\r/g, "").trim();
}

function validateEnergyCaption(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const length = normalized.length;
  if (length < ENERGY_MIN || length > ENERGY_MAX) return false;

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 6) return false;

  const hasTodayLine = lines.some((line) => line.toLowerCase().startsWith("сегодня —"));
  if (!hasTodayLine) return false;

  const hasEnergyLine = lines.some((line) => line.toLowerCase().startsWith("энергия дня:"));
  if (!hasEnergyLine) return false;

  const hasRecommendationsHeader = lines.some((line) => line.toLowerCase().startsWith("рекомендации"));
  if (!hasRecommendationsHeader) return false;

  const hasRecommendation = lines.some((line) => line.startsWith("—"));
  if (!hasRecommendation) return false;

  return true;
}

function appendEnergyHashtags(text) {
  const normalized = normalizeText(text);
  if (!normalized) return normalized;

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1) || "";
  if (last.startsWith("#")) return normalized;

  const shuffled = [...ENERGY_HASHTAGS].sort(() => Math.random() - 0.5);
  const count = Math.min(3, Math.max(2, Math.floor(Math.random() * 2) + 2));
  lines.push(shuffled.slice(0, count).join(" "));
  return lines.join("\n");
}

function buildEnergyFallbackCaption({ timezone }) {
  const today = getTodayRu(timezone);
  return [
    "Энергия дня",
    "",
    `Сегодня — ${today}.`,
    "Энергия дня: мягкая устойчивость",
    "",
    "Сегодня важно бережно распределить силы и не спешить. Маленькие шаги помогут почувствовать опору.",
    "",
    "Рекомендации:",
    "— выбери один приоритет и держись его",
    "— делай паузы между задачами",
    "",
    ENERGY_HASHTAGS.slice(0, 3).join(" "),
  ].join("\n");
}

async function generateEnergyCaption({ timezone, genApiKey }) {
  const today = getTodayRu(timezone);

  const prompt = `
Ты — автор утреннего Telegram-канала. Тон: спокойный, тёплый, без пафоса.

Задача:
Написать пост "Энергия дня" на русском.

Формат:
Заголовок (1 строка)

Сегодня — ${today}.
Энергия дня: <название>

2–3 предложения описания энергии.

Рекомендации:
— рекомендация
— рекомендация

Ограничения:
— 350–700 символов
— Без ссылок
— Без обещаний
— Без эзотерического перегруза
— Без упоминания ИИ

Верни только текст.
`.trim();

  const res = await axios.post(
    "https://api.gen-api.ru/api/v1/networks/qwen-3",
    {
      is_sync: true,
      model: "qwen-plus",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_new_tokens: 420,
    },
    {
      headers: { Authorization: `Bearer ${genApiKey}` },
      timeout: 60000,
    }
  );

  return (res.data?.response?.[0]?.message?.content || "").trim();
}

async function postDailyEnergy({
  bot,
  channelId,
  timezone,
  activeHoursStart,
  activeHoursEnd,
  imagesDir,
  genApiKey,
}) {
  if (
    !isActiveHours({
      timezone,
      activeHoursStart,
      activeHoursEnd,
    })
  ) {
    console.log(`🌙 Энергия дня: неактивные часы — пропуск (${timezone})`);
    return;
  }

  try {
    let caption = "";
    for (let i = 0; i < ENERGY_MAX_TRIES; i++) {
      caption = await generateEnergyCaption({ timezone, genApiKey });
      caption = appendEnergyHashtags(caption);
      if (validateEnergyCaption(caption)) break;
      caption = "";
      await new Promise((resolve) => setTimeout(resolve, 800 + i * 400));
    }
    if (!caption) {
      console.log("🌞 Энергия дня: не удалось сгенерировать корректный текст, использую шаблон");
      caption = buildEnergyFallbackCaption({ timezone });
    }

// ===== Image source =====
if (USE_UNSPLASH) {
  try {
    const picked = await pickUnsplashEnergyImage();
    if (picked?.url) {
      await bot.sendPhoto(channelId, picked.url, { caption });
      if (picked.attribution) {
        await bot.sendMessage(channelId, picked.attribution, { disable_web_page_preview: true });
      }
      console.log("🌞 Энергия дня опубликована (Unsplash)");
      return;
    }
  } catch (e) {
    console.error("🌞 Unsplash не сработал, пробую локальную картинку:", e.response?.data || e.message);
  }
}

let imagePath;
try {
  imagePath = pickEnergyImage(imagesDir);
} catch (e) {
  console.error("🌞 Нет картинки для энергии дня:", e.message);
}

if (!imagePath) {
  await bot.sendMessage(channelId, caption);
  console.log("🌞 Энергия дня опубликована без картинки");
  return;
}

try {
  const stream = fs.createReadStream(imagePath);

  // ✅ ВАЖНО: fileOptions (4-й аргумент) — чтобы убрать DeprecationWarning
  const fileOptions = {
    filename: path.basename(imagePath),
    contentType: mimeByExt(imagePath),
  };

  await bot.sendPhoto(channelId, stream, { caption }, fileOptions);
  console.log("🌞 Энергия дня опубликована");
} catch (e) {
  console.error("🌞 Ошибка отправки фото энергии дня:", e.response?.data || e.message);
  await bot.sendMessage(channelId, caption);
  console.log("🌞 Энергия дня опубликована без картинки");
}

  } catch (e) {
    console.error("🌞 Ошибка энергии дня:", e.response?.data || e.message);
  }
}

export function startDailyEnergy({
  bot,
  channelId,
  timezone = "Europe/Moscow",
  activeHoursStart = 7,
  activeHoursEnd = 23,
  postTime = { hour: 8, minute: 30 },
  imagesDir = "./images/energy",
  genApiKey,
} = {}) {
  if (!bot) throw new Error("startDailyEnergy: нет bot");
  if (!channelId) throw new Error("startDailyEnergy: нет channelId");
  if (!genApiKey) throw new Error("startDailyEnergy: нет genApiKey");

  scheduleDailyAt(
    postTime,
    () =>
      postDailyEnergy({
        bot,
        channelId,
        timezone,
        activeHoursStart,
        activeHoursEnd,
        imagesDir,
        genApiKey,
      }),
    "energy-day"
  );
}
