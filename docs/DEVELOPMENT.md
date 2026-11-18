# MegaInfo — устройство расширения

## Как это работает

1. Перед каждой генерацией `megaInfoInterceptor` (см. `generate_interceptor` в `manifest.json`)
   вырезает из истории старые блоки и маркеры, затем вставляет инструкцию на глубине
   `depth` от имени `user`. В инструкции — текущее состояние, формат JSON и правила
   только для модулей, которым пора обновиться.
2. Модель дописывает в конец ответа `<megainfo>{…}</megainfo>`, при необходимости
   `<megainfo_html>…</megainfo_html>` и маркеры `[[mi:phone]]` / `[[mi:card]]` в тексте.
3. На `MESSAGE_RECEIVED` блок извлекается, проверяется и применяется к состоянию
   прошлого ответа. Числа считает код; модель присылает только изменения.
4. Если блока нет, он испорчен или оборван, в режиме «Авто» уходит отдельный запрос
   (`src/request.js`). Он всегда заканчивается сообщением `user` — иначе Gemini через
   OpenRouter отвечает 400.

## Протокол

Главные поля JSON:

```text
date, time, weather, location
people[]        {name, role: char|user|npc, mood, outfit, thought, d, set, reasons, aff, rel, new}
money[]         {who, amount, note}
currency        символ валюты — только пока валюта чата неизвестна
world           {pace, twist, plot, plot_d, schedule, rumor_add, rumor_drop, thread_add, thread_drop, thread_update}
slowburn        {d, moment}
marks           {add[], heal[]}
place           {name, look, details, mood}
diary           {date, title, entry, about_user, npcs[], gossip}
phone           {app, kind, title, items[]}
pocket          {add[], drop[], update[]}
```

`d` — изменение за ответ, `set` — полный сброс (сон, душ, разрядка), `reasons` —
причина под тем же ключом, включая `aff`. Пропущенный ключ коллекции её не очищает.

## Хранение

`message.extra.megainfo` (и копия в `swipe_info[swipe_id].extra.megainfo`):

```text
state           состояние после этого ответа
  people[id]    профиль, stats, excitement, money, aff, rel, mood, outfit, thought, changes
  scene         id людей в сцене
  marks, world, slow, pockets[personId]
diary, phone, card, ui (свёрнутость), manualPulse, err, dbg, upd
```

`person.changes[field]` — список `{kind: time|event|initial|manual, from, to, delta, reason}`
за текущий ответ. При переносе состояния на новый ответ очищается.

`chatMetadata.megainfo`: `places`, `placeTries`, `overrides` (модули, телефоны,
валюта и местоимение этого чата), `currency` и `currencyTries` (найденная моделью
валюта), `dismissedMarks`, `dismissedThreads`, `pocketEdits`.

Ручные правки кармашка (`pocketEdits`) хранят `fromMessage` и `upto`: правка
защищает ответы с `fromMessage` по `upto` от запоздавшего пересчёта, но не перебивает
более поздние изменения модели. Ручное добавление (`added: true`) переносится во все
уже существующие следующие ответы.

## Люди

Имена сравниваются по словам: «Кира» — это «Бариста Кира», а «Анна Смирнова» —
не «Анна Петрова». Если короткое имя подходит нескольким людям, выбирается тот,
кто был в прошлой сцене; иначе запись пропускается с пометкой в журнале.

В групповом чате (`opts.group`) все участники — `role: char`, главные персонажи
не выпадают из памяти, а кармашек и Slow burn привязаны к именам.

Если на той же дате время «откатилось» на 6 часов и больше (23:30 → 00:15), это
следующий день; меньший откат считается ошибкой модели и время не меняется.

## Настройки

`schemaVersion: 5`. Миграции в `src/settings.js` выполняются один раз для объекта
настроек; результат кэшируется до замены объекта. Новые поля заполняются значениями
по умолчанию, выбранные пользователем значения не сбрасываются. В версии 5 валюта
по умолчанию `₽` стала `auto`.

## Карта файлов

```text
index.js                 события таверны, перехватчик, отрисовка и кнопки
src/settings.js          значения по умолчанию, миграции, настройки чата, валюта
src/tracker.js           расписание модулей, разбор ответа, отдельные запросы
src/request.js           история и запросы к модели
src/store.js             сообщения и свайпы, места, ручные правки коллекций
src/manual.js            карандашики Пульса и проверка JSON из редактора блока
src/render.js            панели, вкладки, причины изменений, карточки
src/inline.js            телефон и карточки внутри текста ответа
src/tracking.js          подробность и поля для каждого человека
src/presets.js           игровые наборы
src/ui-settings.js       панель настроек
src/quick.js             меню волшебной палочки
src/log.js, export.js    диагностика и экспорт
src/core/engine.js       сборка инструкции, извлечение и применение блока
src/core/people.js       сцена, люди, потребности, деньги, отношения
src/core/changes.js      причины изменений
src/core/pocket.js       кармашек
src/core/world.js        сюжет, напряжение, расписание, слухи, нити
src/core/marks.js        следы и заживление
src/core/slowburn.js     стадии Slow burn
src/core/location.js     описания мест
src/core/extras.js       заметки, телефон, карточки
settings.html, style.css интерфейс настроек и оформление
```

## Проверки

```bash
npm test
```

```bash
npm run test:browser
```

Юнит-тесты (`test/*.test.mjs`) разложены по функциям. Браузерные сценарии
(`test/browser/`) работают на макете SillyTavern (`mock-st.js`) с подставной моделью
(`fake-model.js`):

- `story.cjs` — длинная игра: ответы, свайпы, отдельные запросы, сломанные блоки;
- `controls.cjs` — карандашики, наборы, кармашек, нити, мобильная ширина;
- `layout.cjs` — темы, вкладки, раскрывающиеся разделы, свёрнутость заметок;
- `editor.cjs` — редактор блока, причины изменений, валюта, карточки, перерисовка.

Макет не заменяет проверку в настоящей таверне с настоящей моделью.

## Выпуск

1. Поднять версию в `manifest.json`, `package.json`, `src/settings.js` (`VERSION`)
   и в `settings.html` (`mi-edition-tag`); добавить запись `## X.Y.Z — дата` в `CHANGELOG.md`.
2. Отправить в `main`. GitHub Actions прогонит проверки, поставит тег `vX.Y.Z`
   и, если GitHub разрешит, страницу выпуска с текстом из истории версий; слитые ветки `claude/*` удалит.

Встроенный ключ GitHub Actions не может ставить теги на коммиты, которые меняют файлы
в `.github/workflows`, и не может создавать страницы выпусков. Поэтому в
**Settings → Secrets and variables → Actions** хранится секрет `RELEASE_TOKEN` —
fine-grained ключ только для этого репозитория с правами **Contents** и **Workflows**
(Read and write). Без секрета шаг выпуска выводит предупреждение и не падает.
