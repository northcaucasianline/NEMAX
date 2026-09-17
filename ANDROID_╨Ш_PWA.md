# Android и PWA: сборка приложения

Проект остаётся одним React-приложением: в браузере он работает как адаптивная web/PWA-версия, а для Android собирается через Capacitor. Backend не встраивается в APK — Core API и Realtime должны быть размещены на доступном HTTPS/WSS-сервере.

## Что уже подготовлено

- `capacitor.config.json`;
- зависимости `@capacitor/core`, `@capacitor/android`, `@capacitor/cli`;
- команды `android:add`, `android:sync`, `android:open`, `android:run`;
- PWA manifest, service worker и ярлыки разделов;
- safe-area для вырезов экрана и нижней системной панели;
- адаптивные чаты, поиск, новости, доски и настройки;
- touch-friendly кнопки и standalone-режим.

## Требования

1. Node.js 22+ и npm.
2. Android Studio последней стабильной версии.
3. Android SDK, Platform Tools и JDK, предложенный Android Studio.
4. Размещённый backend с HTTPS и WSS.

## 1. Установка зависимостей

```bash
npm install
```

## 2. Адреса production-сервера

Создайте `.env.production` в корне проекта:

```env
VITE_API_URL=https://example.com/api
VITE_GAME_API_URL=https://example.com/game-api
VITE_WS_URL=wss://example.com/ws
VITE_MEDIA_URL=https://example.com
```

Замените `example.com` своим доменом. Для Android нельзя оставлять `localhost` в адресе API: внутри телефона это сам телефон, а не компьютер с backend. В `PUBLIC_ORIGIN` backend добавьте Capacitor-origin `https://localhost` вместе с адресом web-клиента.

Для теста в одной Wi-Fi-сети можно временно указать локальный IP компьютера:

```env
VITE_API_URL=http://192.168.1.50:3001/api
VITE_GAME_API_URL=http://192.168.1.50:3004/game-api
VITE_WS_URL=ws://192.168.1.50:3002/ws
VITE_MEDIA_URL=http://192.168.1.50:3001
```

В production используйте HTTPS/WSS. В `capacitor.config.json` небезопасный mixed content специально отключён.

## 3. Первое создание Android-проекта

```bash
npm run build
npm run android:add
npm run android:sync
npm run android:open
```

После `android:add` появится папка `android/`. Она создаётся один раз. После любых изменений React-кода достаточно:

```bash
npm run android:sync
```

## 4. Запуск на эмуляторе или телефоне

Через команду:

```bash
npm run android:run
```

Или откройте Android Studio командой `npm run android:open`, выберите устройство и нажмите Run.

Для физического телефона включите «Для разработчиков» и «Отладка по USB».

## 5. Сборка APK

В Android Studio:

1. Откройте меню **Build**.
2. Выберите **Build APK(s)** для тестового APK.
3. Готовый debug APK обычно находится в `android/app/build/outputs/apk/debug/`.

## 6. Подписанный AAB для Google Play

1. **Build → Generate Signed Bundle / APK**.
2. Выберите **Android App Bundle**.
3. Создайте и безопасно сохраните keystore.
4. Соберите release AAB.
5. Не добавляйте keystore и пароли в Git или архив с исходниками.

## 7. PWA без APK

После публикации сайта по HTTPS пользователь может установить приложение из браузера:

- Android Chrome: меню → «Установить приложение»;
- настольный Chrome/Edge: иконка установки в адресной строке.

PWA поддерживает standalone-окно, service worker, push-уведомления и ярлыки «Чаты», «Новости», «Доски», «Поиск».

## 8. Что проверить перед публикацией

- регистрация и вход;
- автоматическое обновление access-токена;
- WebSocket через `wss://`;
- отправка текста, файлов, голосовых и стикеров;
- GIF/video-аватары;
- системные push;
- загрузка файлов через мобильную сеть;
- разрешения камеры/микрофона для звонка;
- кнопка «Назад» Android и переходы по deep link;
- работа после сворачивания и возврата приложения.

## Частые проблемы

### Network Error

Почти всегда указан `localhost`, неправильный домен или отсутствует HTTPS-сертификат. Проверьте `.env.production` и доступность `/api/health` с телефона.

### WebSocket не соединяется

Укажите `VITE_WS_URL=wss://домен/ws` и проверьте proxy-конфигурацию Nginx для Upgrade/Connection headers.

### Изменения React не появились в Android

Выполните:

```bash
npm run android:sync
```

### Push работает в PWA, но не как полноценный нативный push

Текущая версия использует Web Push. Для максимально надёжной фоновой доставки в нативном Android-приложении следующим этапом подключается Firebase Cloud Messaging через Capacitor-плагин. Backend уже разделяет push-подписки по устройствам, поэтому это можно добавить без переделки модели сообщений.

## Новые экраны в мобильной оболочке

В адаптивную и Capacitor-версию включены `/rooms` и `/games`. Выбор города на узком экране открывает крупную панель поверх интерфейса, а кастомные списки выбора — нижнюю touch-friendly панель. Категории досок прокручиваются горизонтально, карточки комнат/игр переходят в одну колонку, а конструктор игры перестраивается без закреплённой боковой панели.

Справочник городов находится внутри web-сборки, поэтому поиск по уже загруженной базе работает без внешнего геокодингового API. Размер файла составляет около нескольких мегабайт и он кешируется service worker/browser cache.
