// Браузерный тест на макете SillyTavern: npm run test:browser
// node test/browser/run.cjs <extDir> <node_modules с jquery и dompurify> [папка для скриншотов]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [extDir = path.join(__dirname, '../..'), depsDir = path.join(__dirname, '../../node_modules'), shotsDir = path.join(__dirname, 'shots')] = process.argv.slice(2);
const roots = { '/ext/': extDir, '/deps/': depsDir, '/harness/': __dirname };
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (url === '/') url = '/harness/index.html';
    const prefix = Object.keys(roots).find((p) => url.startsWith(p));
    if (!prefix) { res.writeHead(404); return res.end(); }
    const file = path.join(roots[prefix], url.slice(prefix.length));
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('nf'); }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
        res.end(data);
    });
});

const results = [];
function check(name, ok, info = '') {
    results.push({ name, ok, info });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}

(async () => {
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    fs.mkdirSync(shotsDir, { recursive: true });
    const browser = await chromium.launch({
        executablePath: process.env.MEGAINFO_CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
        args: ['--no-sandbox'],
    });
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('TOAST') && !m.text().startsWith('[MegaInfo]')) errors.push(m.text()); });
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => typeof globalThis.megaInfoInterceptor === 'function' && document.querySelector('.megainfo-settings'));

    const settle = () => page.waitForFunction(() => !document.querySelector('.mi-pending'), null, { timeout: 5000 }).then(() => page.waitForTimeout(50));
    const lastBot = () => page.evaluate(() => {
        const chat = window.__st.chat;
        for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user) return { id: i, mes: chat[i].mes, data: chat[i].extra?.megainfo ?? null };
        return null;
    });
    const send = async (text, behavior = 'good', type = 'normal') => {
        await page.evaluate((b) => { window.__behavior = b; }, behavior);
        await page.evaluate(([t, ty]) => window.__send(t, ty), [text, type]);
        await settle();
    };
    const setSetting = (fn) => page.evaluate(fn);

    // ---------------------------------------------------------- 1. длинный чат
    await page.evaluate(() => window.__newChat('chat-1', 'Алекс протирает стойку и поднимает глаза.'));
    await page.evaluate(() => { const s = window.__st.extensionSettings.megainfo; for (const k of ['slowburn', 'world', 'phone', 'cards']) s.modules[k].enabled = true; s.modules.phone.exists = 'yes'; s.modules.diary.mode = 'separate'; });

    const plan = ['good', 'good', 'forget', 'good', 'broken', 'good', 'truncated', 'good', 'good', 'good', 'good', 'good'];
    let prevTime = '';
    for (let i = 0; i < plan.length; i++) {
        if (i === 5) await page.evaluate(() => { window.__location = 'Парк у реки'; });
        await page.evaluate((i) => { window.__phone = i === 7; window.__card = i === 8; }, i);
        await send(`Реплика ${i + 1}`, plan[i]);
        const lb = await lastBot();
        const st = lb.data?.state;
        check(`ход ${i + 1} (${plan[i]}): у ответа есть состояние`, !!st, st ? `${st.time} ${st.location}` : JSON.stringify(lb.data));
        check(`ход ${i + 1}: блок вырезан из текста`, !/megainfo/.test(lb.mes));
        if (st && prevTime) check(`ход ${i + 1}: время идёт вперёд`, st.time > prevTime, `${prevTime} → ${st.time}`);
        if (st) prevTime = st.time;
        const panel = await page.$(`#chat .mes[mesid="${lb.id}"] .mi-panel .mi-head`);
        check(`ход ${i + 1}: панель нарисована`, !!panel);
    }
    const prompts = await page.evaluate(() => window.__st.prompts);
    check('в историю модели не попадает ни одного блока или маркера вставки', prompts.every((p) => p.history.every((h) => !/<megainfo|\[\[mi:(?:phone|card)\]\]/.test(h))));
    check('каждый обычный запрос получил инструкцию с текущим состоянием', prompts.slice(1).every((p) => /CURRENT STATE \(calculated/.test(p.injection)), prompts.map((p) => p.injection.length).join(','));
    const lb1 = await lastBot();
    const st1 = lb1.data.state;
    check('деньги считаются по каждой трате', st1.people['алекс'].money === 20000 - 350 * 12, String(st1.people['алекс'].money));
    check('симпатия плавно растёт', st1.people['алекс'].aff === 5 + 2 * 11, String(st1.people['алекс'].aff));
    check('слоуберн копится', st1.slow.points >= 6, String(st1.slow.points));
    check('слух сохраняется', st1.world.rumors.length === 1);
    check('синяк на месте', st1.marks.length === 1);
    const places = await page.evaluate(() => Object.keys(window.__st.chatMetadata.megainfo.places));
    check('описаны оба места', places.length === 2, places.join(' | '));
    const chat = await page.evaluate(() => window.__st.chat.map((m) => m.extra?.megainfo ? Object.keys(m.extra.megainfo) : []));
    check('дневник пишется к каждому ответу (отдельный запрос)', chat.filter((k) => k.includes('diary')).length === 12, chat.map((k) => k.includes('diary') ? 'd' : '-').join(''));
    check('телефон только когда им пользовались', chat.filter((k) => k.includes('phone')).length === 1);
    check('HTML-карточка сохранена', chat.filter((k) => k.includes('card')).length === 1);
    const cardId = chat.findIndex((k) => k.includes('card'));
    const card = await page.evaluate((id) => window.__st.chat[id].extra.megainfo.card, cardId);
    check('карточка без скрипта после очистки при показе', true, card.length + ' символов');
    const rawCalls = await page.evaluate(() => window.__calls.raw);
    check('отдельные запросы: по одному на ответ (дневник + добор вместе)', rawCalls === 12, String(rawCalls));
    const diaryAbout = await page.evaluate(() => window.__st.chat.find((m) => m.extra?.megainfo?.diary)?.extra.megainfo.diary.aboutUser);
    check('в дневнике «он», а не «она» (персона — парень)', /Он/.test(diaryAbout), diaryAbout);

    // вкладки и скриншоты
    const lastId = lb1.id;
    const tabs = await page.$$eval(`#chat .mes[mesid="${lastId}"] .mi-tab`, (els) => els.map((e) => e.dataset.miTab));
    check('вкладки', tabs.length >= 6, tabs.join(','));
    for (const t of tabs) {
        await page.click(`#chat .mes[mesid="${lastId}"] .mi-tab[data-mi-tab="${t}"]`);
        const el = await page.$(`#chat .mes[mesid="${lastId}"] .mi-panel`);
        await el.screenshot({ path: path.join(shotsDir, `tab-${t}.png`) });
    }
    // Карточки и телефон встроены в текст; старые ответы не теряют предметы,
    // когда ограничение «последние N» скрывает их основную панель.
    await page.evaluate(() => { window.__st.extensionSettings.megainfo.showOnLast = 0; });
    await page.selectOption('.megainfo-settings [data-mi-setting="theme"]', 'glass');
    await page.selectOption('.megainfo-settings [data-mi-setting="theme"]', 'tavern');
    const phoneId = chat.findIndex((k) => k.includes('phone'));
    for (const [id, kind] of [[cardId, 'card'], [phoneId, 'phone']]) {
        const inline = await page.$(`#chat .mes[mesid="${id}"] .mes_text [data-mi-inline="${kind}"]`);
        check(`${kind}: блок находится внутри текста ответа`, !!inline);
        check(`${kind}: блок убран из вкладок инфопанели`, !(await page.$(`#chat .mes[mesid="${id}"] .mi-panel [data-mi-tab="${kind}"]`)));
        const order = await page.evaluate(([id, kind]) => {
            const text = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
            const html = text.innerHTML;
            const before = kind === 'phone' ? 'Он достал телефон' : 'Алекс развернул бумажный чек';
            const after = kind === 'phone' ? 'Убрав телефон' : 'Он отложил чек';
            const slot = html.indexOf(`data-mi-inline="${kind}"`);
            return html.indexOf(before) < slot && slot < html.indexOf(after) && !/\[\[mi:/.test(text.textContent);
        }, [id, kind]);
        check(`${kind}: вставка между связанными с ней абзацами, без сырого маркера`, order);
        if (inline) await inline.screenshot({ path: path.join(shotsDir, `inline-${kind}.png`) });
        if (kind === 'card') {
            const shadow = await page.evaluate((id) => {
                const host = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text .mi-card-host`);
                return host?.shadowRoot ? host.shadowRoot.innerHTML : null;
            }, id);
            check('карточка в Shadow DOM, без <script>', shadow && !/<script/i.test(shadow) && /Чек/.test(shadow));
        }
    }
    await page.evaluate(() => { window.__st.extensionSettings.megainfo.showOnLast = 1; });
    await page.selectOption('.megainfo-settings [data-mi-setting="theme"]', 'glass');
    check('историческая карточка остаётся в тексте вне последних N панелей', !!(await page.$(`#chat .mes[mesid="${cardId}"] .mes_text [data-mi-inline="card"]`)));
    await page.evaluate(() => { window.__st.extensionSettings.megainfo.showOnLast = 0; });
    await page.selectOption('.megainfo-settings [data-mi-setting="theme"]', 'tavern');

    // Дневник рисуется отдельным блоком сразу после текста, а настройка
    // перемещает ту же запись перед текстом без нового запроса модели.
    const diaryOrder = async (placement) => {
        await page.selectOption('.megainfo-settings [data-mi-setting="modules.diary.placement"]', placement);
        return page.evaluate(([id, placement]) => {
            const text = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
            const sibling = placement === 'top' ? text.previousElementSibling : text.nextElementSibling;
            return sibling?.matches('.mi-diary-host') && !document.querySelector(`#chat .mes[mesid="${id}"] .mi-panel [data-mi-tab="diary"]`);
        }, [lastId, placement]);
    };
    check('дневник появляется сразу после ответа отдельным блоком', await diaryOrder('bottom'));
    check('дневник можно переместить в начало ответа', await diaryOrder('top'));
    await diaryOrder('bottom');

    // Удаление отметины из раннего сообщения должно убрать её и из уже
    // рассчитанных будущих состояний; иначе следующий ответ воскресит след.
    const firstMarkId = await page.evaluate(() => window.__st.chat.findIndex((m) => m.extra?.megainfo?.state?.marks?.length));
    const markId = await page.evaluate((id) => window.__st.chat[id].extra.megainfo.state.marks[0].id, firstMarkId);
    await page.click(`#chat .mes[mesid="${firstMarkId}"] .mi-tab[data-mi-tab="body"]`);
    await page.click(`#chat .mes[mesid="${firstMarkId}"] [data-mi-act="remove-mark"][data-mi-mark="${markId}"]`);
    const removedEverywhere = await page.evaluate(([start, mark]) => window.__st.chat.slice(start).every((m) => !(m.extra?.megainfo?.state?.marks ?? []).some((x) => x.id === mark)), [firstMarkId, markId]);
    check('кнопка удаления следа убирает его из текущего и последующих состояний', removedEverywhere);

    // ---------------------------------------------------------- 2. свайпы
    const before = (await lastBot()).data.state.time;
    await send('', 'good', 'swipe');
    const afterSwipe = await lastBot();
    check('свайп: новый вариант получил свой блок', afterSwipe.data?.state && afterSwipe.data.state.time !== before, `${before} → ${afterSwipe.data?.state?.time}`);
    await page.evaluate(() => window.__swipeLeft());
    await page.waitForTimeout(50);
    const back = await lastBot();
    check('свайп назад: вернулось старое состояние', back.data?.state?.time === before, back.data?.state?.time);
    await send('', 'forget', 'swipe');
    const sw2 = await lastBot();
    check('свайп, где модель забыла блок: старое состояние не протекает, добирается заново', sw2.data?.state && sw2.data.state.time !== before, sw2.data?.state?.time);

    // ---------------------------------------------------------- 3. новый чат (баг из v0.1)
    await page.evaluate(() => window.__newChat('chat-2', 'Новая история начинается.'));
    for (let i = 0; i < 4; i++) {
        await send(`Новый чат, реплика ${i + 1}`, 'good');
        const lb = await lastBot();
        check(`новый чат, ход ${i + 1}: блок есть`, !!lb.data?.state, lb.data?.state?.time);
    }

    // ---------------------------------------------------------- 4. регулярка пользователя режет блок
    await page.evaluate(() => { window.__st.outputRegex = /<megainfo>[\s\S]*?<\/megainfo>/g; });
    await send('Реплика при злой регулярке', 'good');
    const rx = await lastBot();
    check('регулярка съела блок → авто добрал отдельным запросом', !!rx.data?.state);
    const log = await page.evaluate(() => document.querySelector('#megainfo_log').innerText);
    check('в диагностике видно, что блока не было', /нет блока/.test(log));
    await page.evaluate(() => { window.__st.outputRegex = null; });

    // ---------------------------------------------------------- 5. режим «только отдельным запросом»
    await page.evaluate(() => { window.__st.extensionSettings.megainfo.mode = 'separate'; });
    const rawBefore = await page.evaluate(() => window.__calls.raw);
    await send('Режим separate', 'good');
    const sp = await lastBot();
    const lastPrompt = await page.evaluate(() => window.__st.prompts.at(-1).injection);
    check('separate: в обычный запрос не просим блок', !/status tracker/.test(lastPrompt) && /current story state/.test(lastPrompt));
    check('separate: блок пришёл отдельным запросом', !!sp.data?.state && (await page.evaluate(() => window.__calls.raw)) > rawBefore);

    // ---------------------------------------------------------- 6. отдельный запрос сломался
    await page.evaluate(() => { window.__sepBehavior = 'garbage'; });
    await send('Модель отказалась', 'good');
    const gb = await lastBot();
    check('отказ модели в отдельном запросе → ошибка с кнопкой «Повторить»', !!gb.data?.err && !!(await page.$(`#chat .mes[mesid="${gb.id}"] .mi-error`)), gb.data?.err?.text);
    await page.evaluate(() => { window.__sepBehavior = 'good'; });
    await page.click(`#chat .mes[mesid="${gb.id}"] .mi-error .mi-act`);
    await settle();
    const fixed = await lastBot();
    check('кнопка «Повторить» чинит блок', !!fixed.data?.state && !fixed.data?.err);
    await page.evaluate(() => { window.__st.extensionSettings.megainfo.mode = 'auto'; });

    // ---------------------------------------------------------- 6b. только в ответе + модель забыла
    await page.evaluate(() => { const s = window.__st.extensionSettings.megainfo; s.mode = 'inline'; s.modules.diary.mode = 'inline'; });
    const rawB = await page.evaluate(() => window.__calls.raw);
    await send('inline, забыла', 'forget');
    const inl = await lastBot();
    check('inline: без отдельных запросов', (await page.evaluate(() => window.__calls.raw)) === rawB);
    check('inline: на последнем ответе кнопка «Создать»', !!(await page.$(`#chat .mes[mesid="${inl.id}"] .mi-missing [data-mi-act="regen"]`)));
    await send('inline, нормально', 'good');
    const inl2 = await lastBot();
    check('inline: дневник пришёл прямо в ответе', !!inl2.data?.diary && !!inl2.data?.state);

    // ---------------------------------------------------------- 6c. полный отдельный запрос
    await page.evaluate(() => { const s = window.__st.extensionSettings.megainfo; s.mode = 'separate'; s.separateKind = 'full'; s.modules.diary.mode = 'separate'; });
    const qBefore = await page.evaluate(() => window.__st.quietPrompts.length);
    await send('full separate', 'good');
    const full = await lastBot();
    const q = await page.evaluate(() => window.__st.quietPrompts.at(-1));
    check('full: блок пришёл через полный запрос', !!full.data?.state && (await page.evaluate(() => window.__st.quietPrompts.length)) > qBefore);
    check('full: есть история с ролями и последней репликой пользователя', q.prompt.length > 2 && q.prompt.at(-1).role === 'user', String(q.prompt.length));
    check('full: в истории полного запроса нет блоков', q.prompt.slice(0, -1).every((m) => !/<megainfo/.test(m.content)));
    // полный запрос падает с Bad Request → сам повторяет лёгким
    await page.evaluate(() => { window.__rawFailWithHistory = true; });
    await send('full падает', 'good');
    const fb = await lastBot();
    const flog = await page.evaluate(() => document.querySelector('#megainfo_log').innerText);
    check('full: Bad Request → автоповтор лёгким запросом', !!fb.data?.state && !fb.data?.err && /пробую ещё раз \(light\)/.test(flog));
    await page.evaluate(() => { window.__rawFailWithHistory = false; });

    // ---------------------------------------------------------- 6e. регулярка срезала только теги, JSON остался
    await page.evaluate(() => { const s = window.__st.extensionSettings.megainfo; s.mode = 'inline'; window.__st.outputRegex = /<\/?megainfo>/g; });
    await send('теги срезаны', 'good');
    const br = await lastBot();
    check('теги срезаны регуляркой → JSON в конце всё равно найден', !!br.data?.state && !/"date"/.test(br.mes), br.mes.slice(-80));
    await page.evaluate(() => { window.__st.outputRegex = null; window.__st.extensionSettings.megainfo.mode = 'separate'; });
    await page.evaluate(() => { const s = window.__st.extensionSettings.megainfo; s.mode = 'auto'; s.separateKind = 'light'; });

    // ---------------------------------------------------------- 6d. продолжение ответа
    const contBefore = (await lastBot()).data.state.time;
    await send('', 'forget', 'continue');
    const cont = await lastBot();
    check('continue без блока: состояние сообщения сохраняется', cont.data?.state?.time === contBefore, cont.data?.state?.time);

    // ---------------------------------------------------------- 6f. несколько вставок, отключение модулей
    await page.evaluate(() => { window.__phone = true; window.__card = true; });
    await send('Телефон и бумажный чек в одной сцене', 'good');
    const mixed = await lastBot();
    const mixedSelector = `#chat .mes[mesid="${mixed.id}"] .mes_text`;
    check('телефон и карточка могут появиться в одном ответе', (await page.$$(`${mixedSelector} [data-mi-inline]`)).length === 2);
    await page.selectOption('.megainfo-settings [data-mi-setting="theme"]', 'glass');
    check('перерисовка не дублирует встроенные блоки', (await page.$$(`${mixedSelector} [data-mi-inline]`)).length === 2);
    await page.click('.megainfo-settings [data-mi-setting="modules.phone.enabled"]');
    check('выключенный телефон скрыт и не оставляет сырой маркер', !(await page.$(`${mixedSelector} [data-mi-inline="phone"]`)) && !/\[\[mi:phone\]\]/.test(await page.locator(mixedSelector).innerText()));
    await page.click('.megainfo-settings [data-mi-setting="modules.phone.enabled"]');
    // Старые сообщения 0.2.x хранят карточку/телефон без маркеров в тексте.
    await page.evaluate(async (id) => {
        const c = SillyTavern.getContext();
        const m = c.chat[id];
        m.mes = m.mes.replace(/\[\[mi:(?:phone|card)\]\]/g, '');
        if (m.swipes) m.swipes[m.swipe_id] = m.mes;
        c.updateMessageBlock(id);
        await c.eventSource.emit(c.eventTypes.MESSAGE_UPDATED, id);
    }, mixed.id);
    check('ответ без маркеров всё равно показывает телефон и карточку в тексте', (await page.$$(`${mixedSelector} [data-mi-inline]`)).length === 2);
    await page.evaluate(() => { window.__phone = false; window.__card = false; });

    // ---------------------------------------------------------- 7. выключенное расширение
    await page.evaluate(() => { window.__st.extensionSettings.megainfo.enabled = false; });
    await send('Выключено', 'good');
    const offPrompt = await page.evaluate(() => window.__st.prompts.at(-1).injection);
    check('выключено: ничего не вставляем', offPrompt === '');
    await page.evaluate(() => { window.__st.extensionSettings.megainfo.enabled = true; });

    // ---------------------------------------------------------- 8. мобильный вид и темы
    await page.setViewportSize({ width: 390, height: 844 });
    await send('Мобилка', 'good');
    const mid = (await lastBot()).id;
    const mob = await page.$(`#chat .mes[mesid="${mid}"] .mi-panel`);
    await mob.screenshot({ path: path.join(shotsDir, 'mobile.png') });
    const overflow = await page.evaluate((id) => {
        const p = document.querySelector(`#chat .mes[mesid="${id}"] .mi-panel`);
        return p.scrollWidth - p.clientWidth;
    }, mid);
    check('на телефоне нет горизонтальной прокрутки', overflow <= 1, String(overflow));
    await page.setViewportSize({ width: 1100, height: 900 });
    for (const theme of ['glass', 'noir', 'parchment', 'pastel', 'minimal']) {
        await page.selectOption('.megainfo-settings [data-mi-setting="theme"]', theme);
        await page.click(`#chat .mes[mesid="${mid}"] .mi-tab[data-mi-tab="chars"]`).catch(() => {});
        const el = await page.$(`#chat .mes[mesid="${mid}"] .mi-panel`);
        await el.screenshot({ path: path.join(shotsDir, `theme-${theme}.png`) });
    }
    await page.selectOption('.megainfo-settings [data-mi-setting="layout"]', 'stack');
    const el = await page.$(`#chat .mes[mesid="${mid}"] .mi-panel`);
    await el.screenshot({ path: path.join(shotsDir, 'layout-stack.png') });

    // MBTI раскрывается с телефона.
    const mbti = page.locator(`#chat .mes[mesid="${mid}"] .mi-mbti`).first();
    if (await mbti.count()) {
        await mbti.evaluate((el) => { for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
        await mbti.locator('summary').click();
        check('MBTI раскрывается тапом и показывает описание', await mbti.evaluate((el) => el.open && el.textContent.length > 60));
    } else check('MBTI имеет доступное раскрываемое описание', false);

    const firstSection = page.locator(`#chat .mes[mesid="${mid}"] .mi-sec`).first();
    const sectionKey = await firstSection.getAttribute('data-mi-sec');
    await firstSection.locator(':scope > summary').click();
    await page.waitForTimeout(50);

    // Настоящая перезагрузка страницы с восстановлением сохранённого чата
    // отбрасывает всю оперативную память расширения.
    const toggleSelector = `#chat .mes[mesid="${mid}"] [data-mi-act="toggle"]`;
    await page.click(toggleSelector);
    const collapsedBeforeReload = await page.evaluate((id) => window.__st.chat[id].extra.megainfo.ui?.collapsed, mid);
    check('свёрнутость сохранена в данных сообщения', collapsedBeforeReload === true);
    await page.evaluate(() => window.__persistForReload());
    await page.reload();
    await page.waitForFunction(() => typeof globalThis.megaInfoInterceptor === 'function' && document.querySelector('.megainfo-settings'));
    await page.waitForFunction((id) => document.querySelector(`#chat .mes[mesid="${id}"] .mi-panel`), mid);
    const collapseAfterReload = await page.evaluate((id) => {
        const data = window.__st.chat[id].extra.megainfo;
        const panel = document.querySelector(`#chat .mes[mesid="${id}"] .mi-panel`);
        return data.ui?.collapsed === true && panel.classList.contains('mi-collapsed');
    }, mid);
    check('свёрнутая панель остаётся свёрнутой после перезагрузки страницы', collapseAfterReload);
    await page.click(toggleSelector);
    const sectionAfterReload = page.locator(`#chat .mes[mesid="${mid}"] .mi-sec[data-mi-sec="${sectionKey}"]`);
    check('свёрнутый раздел стопки остаётся свёрнутым после перезагрузки', await sectionAfterReload.evaluate((el) => !el.open));

    check('нет ошибок JS на странице', errors.length === 0, errors.slice(0, 5).join(' | '));
    await page.screenshot({ path: path.join(shotsDir, 'settings.png'), fullPage: false });

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    await browser.close();
    server.close();
    process.exit(failed.length ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(2);
});
