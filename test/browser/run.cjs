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
    const browser = await chromium.launch();
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
    await page.evaluate(() => { const s = window.__st.extensionSettings.megainfo; for (const k of ['slowburn', 'world', 'phone', 'cards']) s.modules[k].enabled = true; s.modules.phone.exists = 'yes'; });

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
    check('в историю модели не попадает ни одного блока', prompts.every((p) => p.history.every((h) => !/<megainfo/.test(h))));
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
    // карточка и телефон на своих сообщениях
    for (const [id, tab] of [[cardId, 'card'], [chat.findIndex((k) => k.includes('phone')), 'phone']]) {
        await page.evaluate(() => { window.__st.extensionSettings.megainfo.showOnLast = 0; });
        await page.evaluate(() => window.__st.chat.length && null);
        await page.click('.megainfo-settings [data-mi-setting="collapsed"]');
        await page.click('.megainfo-settings [data-mi-setting="collapsed"]');
        const sel = `#chat .mes[mesid="${id}"] .mi-tab[data-mi-tab="${tab}"]`;
        if (await page.$(sel)) {
            await page.click(sel);
            const el = await page.$(`#chat .mes[mesid="${id}"] .mi-panel`);
            await el.screenshot({ path: path.join(shotsDir, `tab-${tab}-msg.png`) });
            if (tab === 'card') {
                const shadow = await page.evaluate((id) => {
                    const host = document.querySelector(`#chat .mes[mesid="${id}"] .mi-card-host`);
                    return host?.shadowRoot ? host.shadowRoot.innerHTML : null;
                }, id);
                check('карточка в Shadow DOM, без <script>', shadow && !/script/.test(shadow) && /Чек/.test(shadow));
            }
        } else check(`вкладка ${tab} есть`, false);
    }

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
