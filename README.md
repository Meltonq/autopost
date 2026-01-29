# Universal Autonomous Telegram Content Bot

Автономный Telegram-бот, который генерирует и публикует посты в канал по заданным темам (themes), переключается по `BOT_THEME`, работает по расписанию и хранит память постов в локальных JSON-файлах.

## Возможности

- Несколько тем (themes) в `src/themes/*.json` с валидацией структуры.
- Автономная публикация по расписанию (hourly / daily / список часов).
- Активные часы в заданной таймзоне.
- Дополнительная ежедневная рубрика (опционально).
- Генерация текста через внешний API (GENAPI).
- Антиповторы и проверка похожести контента.
- Локальные изображения и Unsplash (без повторов).
- Админ-команды: `/theme`, `/post`, `/dryrun`.

## Быстрый старт

```bash
npm i
cp .env.example .env
# заполните переменные окружения
npm start
```

## Настройка `.env`

Список ключей — в `.env.example`. Основные:

- `TELEGRAM_BOT_TOKEN` — токен бота.
- `TELEGRAM_CHANNEL_ID` — ID канала или `@channel`.
- `BOT_THEME` — имя темы (например `default`, `game`, `coaching40plus`).
- `LLM_PROVIDER` — `genapi` (если не указано, выбирается по ключам).
- `GENAPI_API_KEY` — ключ LLM.
- `MAIN_SCHEDULE_MODE` — `hourly`, `hours`, `daily`, `off`.
- `BOT_TIMEZONE` — таймзона (по умолчанию `Europe/Helsinki`).

## Структура проекта

```
bot.js
src/
  index.js
  themeLoader.js
  generator/
  scheduler/
  storage/
  media/
  validation/
  themes/
data/
images/
```

### Основные папки

- `src/themes` — JSON-файлы тем.
- `src/generator` — адаптеры LLM и построение промптов.
- `src/scheduler` — расписания.
- `src/storage` — хранение в JSON (подготовлено для будущей замены на БД).
- `src/media` — локальные изображения и Unsplash.
- `src/validation` — проверка длины и анти-повторы.
- `data/` — память постов и статистика.
- `images/` — локальные картинки (по подпапкам рубрик или общие).

## Темы (Themes)

Пример структуры файла:

```json
{
  "name": "default",
  "audience": "...",
  "rubrics": ["focus", "balance"],
  "tones": ["спокойный", "практичный"],
  "cta": ["Сохрани пост ✨"],
  "captionRules": {
    "min": 380,
    "max": 750,
    "minSoft": 360,
    "maxSoft": 780,
    "maxTries": 4,
    "similarityThreshold": 0.45
  },
  "schedule": {
    "mode": "hours",
    "hours": "9,13,19",
    "minute": 0
  }
}
```

Чтобы добавить новую тему:

1. Создайте файл в `src/themes/newtheme.json`.
2. Заполните обязательные поля `name`, `audience`, `rubrics`, `tones`, `cta`, `captionRules`.
3. Установите `BOT_THEME=newtheme`.

## Изображения

- Локальные: положите изображения в `images/<rubric>/` или прямо в `images/`.
- Доп. каталоги: `IMAGES_DIRS=/abs/path1,/abs/path2` добавит дополнительные папки для поиска (каждая со своей структурой `rubric/`).
- Unsplash: включите `USE_UNSPLASH=true` и задайте `UNSPLASH_ACCESS_KEY`.

## Команды

- `/theme` — показать текущую тему.
- `/post` — сгенерировать и отправить пост в канал.
- `/dryrun` — сгенерировать пост и показать администратору (без публикации).

## Деплой

Можно запускать как обычный Node.js процесс (PM2, Docker, systemd). Пример:

```bash
npm start
```

## Замечания по надежности

- Все сетевые запросы обернуты ретраями с backoff.
- Пустой текст не публикуется.
- Валидация длины и анти-повторов сохраняет статистику в `data/validation_stats.json`.
