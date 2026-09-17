# Backend-сервисы НЕМАКС

Изначально проект был разделён на Core и Realtime. Сейчас архитектура включает четыре специализированных Node.js-процесса.

## Core API — `3001`

Владелец аккаунтов, сессий, прав, чатов, сообщений, файлов, PostgreSQL, S3/MinIO и серверных ключей шифрования.

## Realtime / Worker — `3002`

WebSocket, heartbeat, presence, Redis offline queue, typing/recording, WebRTC-сигналинг, повторная доставка и фоновые команды Core.

## Code Runner — `3003`

Изолированный запуск учебных JavaScript, Python и Java-проектов. Не имеет доступа к базе мессенджера и ключам сообщений.

## Game Server — `3004`

Отдельная игровая база и серверная логика:

- шахматы и русские шашки;
- аркадные рекорды;
- условный игровой кошелёк;
- турниры и кэш-столы Texas Hold’em;
- таймеры, карты, банки, результаты и игровые события.

## Взаимодействие

```text
Browser ── REST/Media ─────────────> Core
Browser ── WebSocket ──────────────> Realtime
Browser ── /game-api ──────────────> Game Server
Core / Game Server ── events ──────> Realtime
Realtime / Game Server ── auth ────> Core
Core ── isolated execution ────────> Code Runner
```

Внутренние маршруты защищены `INTERNAL_SERVICE_SECRET`.

## Отказоустойчивость

- при падении Realtime Core продолжает сохранять сообщения;
- offline-события находятся в Redis и persistent outbox;
- клиенты восстанавливают чаты через cursor sync;
- Game Server хранит игровой state отдельно и не блокирует работу мессенджера;
- при недоступном Game Server чаты продолжают работать, а игровой интерфейс показывает ошибку состояния;
- при падении Core новые авторизации и проверка игровых токенов временно недоступны.
