# Sweezy News Bot

Production-ready Telegram-бот редакционного цикла: сбор новостей → LLM-отбор → украинская черновая публикация → правка/апрув → канал.

## Структура

```text
src/
  ai/          OpenAI: отбор, написание, правка, изображения
  bot/         grammY handlers, клавиатуры, отправка/публикация
  db/          общий Store + SQLite и PostgreSQL
  news/        RSS, NewsAPI, нормализация и дедупликация
  scheduler/   cron и job создания черновика
  config.ts    ENV-валидация
  health.ts    GET /health
  index.ts     запуск worker
tests/         prompt и approve/revise/reject flow
```

## Локальный запуск

Требования: Node.js 20+ (рекомендуется 22), Telegram bot token, OpenAI API key.

```bash
cp .env.example .env
npm ci
npm run typecheck
npm test
npm run dev
```

`POST_CRON` использует стандартные пять полей cron. Пример `0 9,15 * * *` запускает job в 09:00 и 15:00 по `TIMEZONE`. Автоматический запуск при старте намеренно отключён: это защищает от случайного расхода API после каждого redeploy.

## Telegram

1. Создайте бота через `@BotFather`; токен запишите в `BOT_TOKEN`.
2. Отправьте боту `/start`. В ответе будет ваш числовой ID; запишите его в `ADMIN_CHAT_ID`.
3. Добавьте бота в канал **Sweezy | Ukrainian x Swiss Community** как администратора.
4. Включите право **Post Messages / Публиковать сообщения**.
5. Для публичного канала задайте `CHANNEL_ID=@channel_username`. Для приватного используйте числовой ID вида `-100...`; его можно получить, переслав пост канала диагностическому боту либо через Telegram API `getUpdates` до запуска worker.

Все approve/revise/reject callbacks и обычные сообщения игнорируются, если sender ID не равен `ADMIN_CHAT_ID`. Команда `/start` доступна всем только для показа собственного Telegram ID. При старте worker проверяет права канала, пишет ошибку в лог и отправляет администратору alert.

## Render Background Worker

1. Push проекта в GitHub/GitLab.
2. Render Dashboard → **New Blueprint** → выберите репозиторий. `render.yaml` создаст Docker Background Worker и persistent disk `/data`.
3. Выставьте секреты: `BOT_TOKEN`, `ADMIN_CHAT_ID`, `CHANNEL_ID`, `OPENAI_API_KEY`; опционально `NEWS_API_KEY`.
4. Проверьте `POST_CRON`, `TIMEZONE`, `SQLITE_PATH=/data/sweezy.db`.
5. Deploy. В логах должны появиться `Channel posting permission verified`, `Scheduler started`, `Bot starting long polling`.

Background Worker не нуждается в публичном URL. Минимальный HTTP server всё равно слушает `PORT` и отвечает `200` на `/health`; он полезен внутри контейнера, но Render может не публиковать endpoint worker наружу.

### PostgreSQL

Если задан непустой `DATABASE_URL`, бот автоматически использует PostgreSQL. Таблицы создаются при старте. Изображения всё равно хранятся локально до публикации, поэтому persistent disk `/data` рекомендуется и с PostgreSQL. Без диска незавершённые черновики после redeploy могут потерять media-файл.

## Источники и изображения

Бот опрашивает прямые RSS SRF/Blick и Google News RSS-фильтры для Swissinfo, 20 Minuten, Watson (их прежние публичные RSS возвращают 404/410). Ошибка одного feed не останавливает остальные. `NEWS_API_KEY` добавляет NewsAPI-запрос по Switzerland/Ukraine/Schutzstatus S.

По умолчанию `ALLOW_SOURCE_IMAGES=false`: бот генерирует новое изображение через OpenAI Images, снижая лицензионный риск. Включайте исходные изображения только при наличии права на повторную публикацию. Если загрузка исходной картинки не удалась, используется сгенерированная.

## Команды и flow

- ✅ **Опублікувати** — атомарно переводит `pending_review → approved`, публикует, затем ставит `published`.
- ✏️ **Переробити** — сохраняет ожидающую правку в БД; следующий admin text становится комментарием LLM. Цикл не ограничен.
- ❌ **Відхилити** — переводит пост в `rejected`.
- `/cancel` — отменяет ожидание комментария.

Повторный callback безопасен: переход состояния выполняется только из ожидаемого статуса. При ошибке Telegram-публикации статус возвращается в `pending_review`, поэтому кнопку можно нажать снова.

## Production checklist

- Настройте Render persistent disk или PostgreSQL + disk для media.
- Держите `.env` вне Git; логгер редактирует известные секретные поля.
- Проверьте расходы OpenAI и установите account limits.
- Убедитесь, что канал и NewsAPI/OpenAI доступны из региона Render.
- Сделайте пробный deploy с тестовым каналом перед production-каналом.
