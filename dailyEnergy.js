import axios from "axios";
import fs from "fs";
import path from "path";

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
