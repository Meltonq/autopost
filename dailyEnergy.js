import axios from "axios";
import fs from "fs";
import path from "path";

// Если хочешь, можешь включить фикс и здесь (лучше — в entrypoint до импорта бота):
// process.env.NTBA_FIX_350 = "1";

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
    const caption = await generateEnergyCaption({ timezone, genApiKey });
    const imagePath = pickEnergyImage(imagesDir);

    const stream = fs.createReadStream(imagePath);

    // ✅ ВАЖНО: fileOptions (4-й аргумент) — чтобы убрать DeprecationWarning
    const fileOptions = {
      filename: path.basename(imagePath),
      contentType: mimeByExt(imagePath),
    };

    await bot.sendPhoto(channelId, stream, { caption }, fileOptions);
    console.log("🌞 Энергия дня опубликована");
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