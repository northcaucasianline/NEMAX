# НЕМАКС Code Studio

Code Studio находится внутри раздела **НЕМАКС PLAY**: откройте `/games` и выберите вкладку **«⌘ Code Studio»**. Это встроенная учебная среда разработки небольших приложений и игр на JavaScript, Python и Java.

## Возможности интерфейса

- создание проекта из готового шаблона;
- галерея опубликованных приложений и раздел личных проектов;
- многофайловый редактор;
- добавление, переименование и удаление файлов;
- выбор стартового файла;
- номера строк и вставка отступа клавишей Tab;
- стандартный ввод для консольных программ;
- отдельные stdout, stderr, ошибки компиляции, exit code и время выполнения;
- browser preview для JavaScript web/Canvas-проектов;
- сохранение проекта на backend;
- публикация исходников в общей галерее;
- открытие чужого опубликованного проекта в read-only режиме;
- создание своей копии опубликованного проекта;
- поиск проектов по названию, описанию, тегам и языку;
- открытие опубликованного приложения из глобального поиска НЕМАКС.

## Поддерживаемые режимы

### JavaScript

Доступны:

- консольные `.js` и `.mjs` программы;
- web-приложения из `index.html`, `style.css` и `main.js`;
- Canvas-игры;
- вспомогательные `.json` и `.txt` файлы.

Web/Canvas-приложение запускается в браузере через `iframe srcDoc`. У iframe нет `allow-same-origin`; Content Security Policy запрещает сетевые подключения. Код preview не получает cookies, `localStorage`, access-токены или DOM основного приложения.

Консольный JavaScript может запускаться отдельным Code Runner. Если runner недоступен, интерфейс может выполнить простой JavaScript-проект в browser sandbox, но это не полная замена Node.js.

### Python

Поддерживаются небольшие консольные проекты с файлами `.py`, `.json` и `.txt`. Python запускается с `-I -S`, ограничением времени, памяти, числа процессов, размера файлов и размера вывода.

### Java

Поддерживаются консольные проекты с файлами `.java`, `.json` и `.txt`. Сначала выполняется `javac`, затем стартует public-класс из выбранного стартового файла. Для простого проекта используйте `public class Main` в `Main.java` без `package`.

## Локальный запуск

Требуется:

- Node.js 22+;
- Python 3 для запуска Python-проектов;
- JDK 17+ для компиляции и запуска Java-проектов.

Команда:

```bash
npm install
npm run dev
```

запускает:

- frontend на `5173`;
- Core API на `3001`;
- Realtime на `3002`;
- Code Runner на `3003`.

Отдельный runner:

```bash
CODE_RUNNER_ENABLED=true npm run server:runner
```

PowerShell:

```powershell
$env:CODE_RUNNER_ENABLED="true"
npm run server:runner
```

Проверка языков:

```bash
npm run test:code-runner
```

## Production

Для публичного развёртывания используйте Docker Compose:

```bash
cp .env.example .env
docker compose up --build -d
```

В production Code Runner:

- находится в отдельном контейнере;
- не публикует TCP-порт наружу;
- вообще не подключён к Docker-сети (`network_mode: none`);
- общается с Core только через Unix socket в отдельном volume;
- не получает пользовательские access/refresh-токены и не подключается к базе;
- имеет read-only корневую файловую систему и временный `tmpfs`;
- запускает пользовательский процесс под отдельным UID/GID `10002`;
- ограничивается по CPU, памяти, PID, размеру файлов, длительности и выводу;
- сбрасывает все capabilities и возвращает только минимальные `CHOWN`, `SETUID`, `SETGID`, необходимые родительскому runner для подготовки временного каталога и запуска дочернего процесса;
- работает с `no-new-privileges`.

Родительский процесс runner запускается как root только внутри изолированного контейнера, чтобы сменить UID дочернего процесса. Сам пользовательский код работает под непривилегированным UID и не может читать окружение родительского процесса. Контейнер не имеет сетевого интерфейса.

Локальный process-runner не следует публиковать в интернет. Он предназначен для разработки на собственном компьютере. Для общего доступа используйте контейнерную схему и дополнительно изолируйте узел запуска от основной инфраструктуры.

## Переменные окружения

```env
CODE_RUNNER_ENABLED=false
CODE_RUNNER_PORT=3003
CODE_RUNNER_HOST=127.0.0.1
CODE_RUNNER_INTERNAL_URL=http://127.0.0.1:3003
CODE_RUNNER_SOCKET=
CODE_RUNNER_TIMEOUT_MS=6000
CODE_RUNNER_MAX_SOURCE_BYTES=240000
CODE_RUNNER_MAX_OUTPUT_BYTES=96000
CODE_RUNNER_MAX_FILES=24
CODE_RUNNER_DISABLE_NETWORK=true
CODE_RUNNER_USE_PRLIMIT=true
CODE_RUNNER_CHILD_UID=0
CODE_RUNNER_CHILD_GID=0
CODE_RUNNER_SOCKET_GID=0
```

В обычном локальном режиме используется TCP на `127.0.0.1:3003` и внутренний секрет. В Docker Compose используется Unix socket; доступ к нему ограничивается файловыми правами.

## API

- `GET /api/code/status` — состояние runner;
- `GET /api/code/projects` — галерея и личные проекты;
- `POST /api/code/projects` — создание проекта;
- `GET /api/code/projects/:id` — чтение проекта;
- `PATCH /api/code/projects/:id` — сохранение изменений;
- `DELETE /api/code/projects/:id` — удаление;
- `POST /api/code/projects/:id/publish` — публикация или снятие с публикации;
- `GET /api/code/projects/:id/runs` — последние запуски владельца;
- `POST /api/code/run` — запуск проекта.

Лимит Core API: не более 20 запусков на пользователя в минуту. Runner также ограничивает количество файлов, общий размер исходников, stdin, вывод и время выполнения.

## Ограничения

Code Studio не заменяет VS Code, IntelliJ IDEA или PyCharm. В текущей версии нет:

- установки произвольных npm, pip, Maven или Gradle-зависимостей;
- Language Server Protocol и полноценного автодополнения;
- debugger с breakpoints;
- desktop GUI для Python/Java;
- Android/iOS-компиляции пользовательских проектов;
- долговременных фоновых процессов;
- доступа пользовательского кода к внешней сети;
- доступа к файловой системе Core API;
- гарантии безопасности, достаточной для запуска произвольного кода от полностью недоверенных пользователей без дополнительной VM/microVM-песочницы.

Для крупного публичного сервиса следующий уровень защиты — отдельные worker-узлы, одноразовые microVM (например, Firecracker), очередь заданий, жёсткие cgroups/seccomp/AppArmor и регулярный security audit.
