// Браузерные проверки тем, вкладок, раскрывающихся разделов и вёрстки на макете SillyTavern.
// node test/browser/layout.cjs [папка для скриншотов]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const chromiumPath = require('./chromium.cjs');

const root = path.resolve(__dirname, '../..');
const shots = path.resolve(process.argv[2] || '/tmp/megainfo-layout');
const roots = { '/ext/': root, '/deps/': path.join(root, 'node_modules'), '/harness/': __dirname };
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
const results = [], errors = [];
function check(name, ok, detail) {
    results.push({ name, passed: !!ok, ...(detail === undefined ? {} : { detail }) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    assert.ok(ok, `${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);
}
const server = http.createServer((request, response) => {
    const url = decodeURIComponent(request.url.split('?')[0]);
    if (url === '/favicon.ico') { response.writeHead(204); return response.end(); }
    const target = url === '/' ? '/harness/index.html' : url;
    const prefix = Object.keys(roots).find(p => target.startsWith(p));
    if (!prefix) { response.writeHead(404); return response.end(); }
    const file = path.resolve(roots[prefix], target.slice(prefix.length));
    if (!file.startsWith(roots[prefix] + path.sep)) { response.writeHead(403); return response.end(); }
    fs.readFile(file, (error, data) => {
        if (error) { response.writeHead(404); return response.end(); }
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        response.end(data);
    });
});

(async () => {
    fs.mkdirSync(shots, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser, page, failure;
    try {
        browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
        page = await browser.newPage({ viewport: { width: 1250, height: 950 } });
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => typeof megaInfoInterceptor === 'function' && document.querySelector('#megainfo_custom_css_section'));
        await page.addStyleTag({ content: '#layout{grid-template-columns:minmax(0,1fr) 380px}.text_pole{box-sizing:border-box;max-width:100%}' });
        await page.evaluate(async () => {
            const { DEFAULTS } = await import('/ext/src/settings.js');
            const s = window.__st.extensionSettings.megainfo = structuredClone(DEFAULTS);
            Object.assign(s, { mode: 'inline', showOnLast: 0, collapsed: false });
            for (const [key, module] of Object.entries(s.modules)) module.enabled = ['sims', 'relations', 'diary', 'pocket'].includes(key);
            s.modules.diary.mode = 'inline';
            s.modules.diary.placement = 'bottom';
            window.__layoutPopups = [];
            const base = SillyTavern.getContext;
            SillyTavern.getContext = () => ({ ...base(), async callGenericPopup() {
                if (!window.__layoutPopups.length) throw new Error('Неожиданное окно в тесте');
                return window.__layoutPopups.shift();
            } });
            window.__layoutTurn = 0;
            window.__st.model = (kind) => {
                if (kind !== 'main') throw new Error('Сценарий без отдельных запросов не должен обращаться к модели');
                const first = ++window.__layoutTurn === 1;
                return 'Алекс поставил кофе на стол.\n\n<megainfo>' + JSON.stringify({
                    date: '12.11.2026', time: first ? '10:00' : '10:30', location: 'Кофейня', weather: 'Ясно',
                    people: [
                        { name: 'Алекс', role: 'char', mood: 'Рад встрече', outfit: 'Синий свитер', rel: 'Знакомые',
                            ...(first ? { new: { stats: { food: 60, hygiene: 80, energy: 70, arousal: 10 }, excitement: 30, money: 1234, mbti: 'INTJ', birthday: '01.02', aff: 12 } } : {}) },
                        { name: 'Миша', role: 'user', outfit: 'Куртка', ...(first ? { new: { stats: { food: 70, hygiene: 90, energy: 75, arousal: 0 }, money: 500 } } : {}) },
                    ],
                    diary: { title: 'После встречи', date: '12.11.2026', entry: 'Сохраняемые заметки о встрече.', about_user: 'Он принёс хорошую новость.' },
                    ...(first ? { pocket: { add: [{ who: 'Алекс', name: 'Письмо', note: 'Неотправленное' }, { who: 'Миша', name: 'Ключ', note: 'От квартиры' }] } } : {}),
                }) + '</megainfo>';
            };
            (await import('/ext/src/ui-settings.js')).loadValues();
            await window.__newChat('layout', 'Приветствие.');
            await window.__send('Первый ход');
        });
        const id = await page.evaluate(() => window.__st.chat.length - 1);
        const message = `#chat .mes[mesid="${id}"]`;
        const host = `${message} .mi-info-host`;
        const pulse = `${message} [data-mi-pane="chars"]`;
        const diary = `${message} details.mi-diary[data-mi-sec="diary"]`;
        await page.locator(`${message} [data-mi-tab="chars"]`).click();

        await page.locator('[data-mi-config-tab="view"]').click();
        await page.locator('[data-mi-config-subtab="colors"]').click();
        await page.evaluate(() => document.documentElement.style.setProperty('--SmartThemeQuoteColor', '#2ea8b1'));
        await page.selectOption('[data-mi-setting="theme"]', 'tavern');
        const activeColor = () => page.locator(`${message} .mi-tab.mi-active`).evaluate(el => getComputedStyle(el).color);
        check('акцент панели в чате следует теме таверны', await activeColor() === 'rgb(46, 168, 177)', await activeColor());
        const settingsColor = await page.locator('.mi-ui-tab[aria-selected="true"]').evaluate(el => getComputedStyle(el).backgroundColor);
        const purple = settingsColor.match(/[\d.]+/g)?.map(Number) ?? [];
        check('настройки используют свой фиолетовый акцент', purple.length >= 3 && purple[2] > purple[0] && purple[0] > purple[1] && settingsColor !== await activeColor(), settingsColor);
        await page.evaluate(() => document.documentElement.style.setProperty('--SmartThemeQuoteColor', '#e1bc47'));
        await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).color === 'rgb(225, 188, 71)', `${message} .mi-tab.mi-active`);
        check('смена темы таверны перекрашивает чат, но не настройки', await activeColor() === 'rgb(225, 188, 71)'
            && await page.locator('.mi-ui-tab[aria-selected="true"]').evaluate(el => getComputedStyle(el).backgroundColor) === settingsColor);
        const accents = [];
        for (const theme of ['tavern', 'noir', 'parchment', 'pastel']) {
            await page.selectOption('[data-mi-setting="theme"]', theme);
            accents.push(await activeColor());
        }
        check('темы панели сохраняют свои акценты', new Set(accents).size === 4, accents);
        await page.selectOption('[data-mi-setting="theme"]', 'custom');
        await page.locator('[data-mi-setting="custom.accent"]').fill('#32ba76');
        await page.locator('[data-mi-setting="custom.accent"]').dispatchEvent('change');
        check('свой акцент чата отображается как выбран', await activeColor() === 'rgb(50, 186, 118)', await activeColor());
        const contrasts = [];
        for (const contrast of ['normal', 'high', 'soft']) {
            await page.selectOption('[data-mi-setting="display.contrast"]', contrast);
            contrasts.push(await page.locator(`${pulse} [data-mi-stat="food"] .mi-stat-label`).first().evaluate(el => getComputedStyle(el).color));
        }
        check('свои цвета по-прежнему дают три контраста', new Set(contrasts).size === 3, contrasts);
        await page.selectOption('[data-mi-setting="display.contrast"]', 'normal');
        await page.selectOption('[data-mi-setting="theme"]', 'tavern');
        await page.evaluate(() => document.documentElement.style.setProperty('--SmartThemeQuoteColor', '#2ea8b1'));

        const cssDetails = page.locator('#megainfo_custom_css_section');
        const cssSummary = cssDetails.locator('summary');
        const affordance = await cssSummary.evaluate(el => ({ cursor: getComputedStyle(el).cursor, minHeight: parseFloat(getComputedStyle(el).minHeight), arrow: getComputedStyle(el, '::after').content }));
        check('«Свой CSS» явно выглядит раскрывающимся', affordance.cursor === 'pointer' && affordance.minHeight >= 40 && !['none', 'normal', '""'].includes(affordance.arrow), affordance);
        await cssSummary.click();
        check('«Свой CSS» открывается по нажатию на заголовок', await cssDetails.evaluate(el => el.open) && await cssDetails.locator('textarea').isVisible());
        await cssSummary.focus(); await cssSummary.press('Enter');
        await page.waitForFunction(() => !document.querySelector('#megainfo_custom_css_section').open);
        check('«Свой CSS» сворачивается клавишей Enter', !await cssDetails.evaluate(el => el.open));
        await page.locator('[data-mi-config-tab="people"]').click();
        const personDetails = page.locator('#megainfo_person_fields_section');
        const personSummary = personDetails.locator('summary');
        await personSummary.click();
        check('раздел отдельного персонажа открывает свои настройки', await personDetails.evaluate(el => el.open) && await page.locator('#megainfo_tracking_name').isVisible());
        await personSummary.focus(); await personSummary.press('Enter');
        await page.waitForFunction(() => !document.querySelector('#megainfo_person_fields_section').open);
        check('раздел отдельного персонажа сворачивается с клавиатуры', !await personDetails.evaluate(el => el.open));

        check('отношения не закреплены над вкладками', await page.locator(`${message} .mi-main-relation`).count() === 0);
        await page.locator(`${message} [data-mi-tab="rel"]`).click();
        check('отношения доступны в своей вкладке', await page.locator(`${message} [data-mi-pane="rel"] .mi-aff`).isVisible());
        await page.locator(`${message} [data-mi-tab="chars"]`).click();
        check('в Пульсе нет копии кармашка', await page.locator(`${pulse} .mi-pocket-summary, ${pulse} .mi-pockets`).count() === 0 && !(await page.locator(pulse).textContent()).includes('Кармашек'));
        await page.locator(`${message} [data-mi-tab="pocket"]`).click();
        check('содержимое кармашка — в своей вкладке', (await page.locator(`${message} [data-mi-pane="pocket"]`).textContent()).includes('Письмо'));
        await page.locator(`${message} [data-mi-tab="chars"]`).click();
        const profile = page.locator(`${pulse} details[data-mi-sec="profile"]`);
        check('деньги — в «Общей информации», не в карточках', await profile.locator('.mi-money').count() === 2 && await page.locator(`${pulse} .mi-person .mi-money`).count() === 0);
        check('«Общая информация» сначала свёрнута', !await profile.evaluate(el => el.open));
        await profile.locator(':scope > summary').click();
        await page.waitForFunction(id => window.__st.chat[id].extra.megainfo.ui?.details?.['section:profile'] === true, id);
        check('раскрытая «Общая информация» показывает балансы и карандашики', await profile.locator('[data-mi-act="edit-field"][data-mi-field="money"]').first().isVisible());
        await page.evaluate(() => window.__layoutPopups.push('1800'));
        await profile.locator('[data-mi-person="алекс"][data-mi-field="money"]').click();
        await page.waitForFunction(id => window.__st.chat[id].extra.megainfo.state.people['алекс'].money === 1800, id);
        check('карандашик денег обновляет состояние и свайп', await page.evaluate(id => window.__st.chat[id].swipe_info[0].extra.megainfo.state.people['алекс'].money === 1800, id));
        await profile.locator('.mi-money [data-mi-sec="change:алекс:money"] > summary').click();
        check('причины изменения денег доступны в «Общей информации»', /Исправлено вручную/.test(await profile.textContent()));
        await page.evaluate(async () => {
            const s = window.__st.extensionSettings.megainfo;
            s.tracking.overrides = { алекс: { detail: 'full', fields: { profile: false } } };
            s.modules.sims.showProfile = false;
            s.display.pulse.profile = 'hide';
            (await import('/ext/index.js')).renderAll();
        });
        check('выключенный профиль не прячет деньги', await profile.locator('.mi-money [data-mi-person="алекс"][data-mi-field="money"]').count() === 1 && !await profile.locator('.mi-mbti').count());

        check('у заметок есть заметный сворачиваемый заголовок', await page.locator(`${diary} > summary`).textContent().then(text => /Заметки/.test(text)) && await page.locator(diary).evaluate(el => el.open));
        await page.locator(`${diary} > summary`).click();
        await page.waitForFunction(id => window.__st.chat[id].extra.megainfo.ui?.details?.['section:diary'] === false, id);
        check('сворачивание заметок прячет текст и сохраняется в свайпе', !await page.locator(`${diary} .mi-diary-body`).isVisible()
            && await page.evaluate(id => window.__st.chat[id].swipe_info[0].extra.megainfo.ui.details['section:diary'] === false, id));
        await page.locator('[data-mi-config-tab="view"]').click();
        await page.locator('[data-mi-config-subtab="colors"]').click();
        await page.selectOption('[data-mi-setting="theme"]', 'glass');
        check('свёрнутые заметки остаются свёрнутыми после смены темы', !await page.locator(diary).evaluate(el => el.open));
        await page.evaluate(async () => {
            window.__st.extensionSettings.megainfo.showOnLast = 1;
            await window.__send('Следующий ход');
        });
        check('старые заметки помнят свёрнутость без основной панели', await page.locator(`${message} .mi-info-host`).count() === 0
            && await page.locator(diary).count() === 1 && !await page.locator(diary).evaluate(el => el.open));
        await page.evaluate(() => window.__persistForReload());
        await page.reload();
        await page.waitForSelector(diary);
        check('свёрнутость заметок переживает перезагрузку', !await page.locator(diary).evaluate(el => el.open)
            && await page.evaluate(id => window.__st.chat[id].swipe_info[0].extra.megainfo.ui.details['section:diary'] === false, id));
        await page.locator(`${diary} > summary`).click();
        await page.waitForFunction(id => window.__st.chat[id].extra.megainfo.ui.details['section:diary'] === true, id);
        check('старые заметки раскрываются отдельно от скрытой панели', await page.locator(`${diary} .mi-diary-body`).isVisible() && await page.locator(`${message} .mi-info-host`).count() === 0);

        const latest = await page.evaluate(() => window.__st.chat.length - 1);
        await page.evaluate(() => document.documentElement.style.setProperty('--SmartThemeQuoteColor', '#2ea8b1'));
        await page.locator(`#chat .mes[mesid="${latest}"] [data-mi-tab="chars"]`).click();
        await page.locator(`#chat .mes[mesid="${latest}"] .mi-info-host`).screenshot({ path: path.join(shots, 'layout-chat-desktop.png') });
        await page.locator('[data-mi-config-tab="people"]').click();
        await page.locator('.mi-ui-settings').screenshot({ path: path.join(shots, 'layout-settings-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addStyleTag({ content: '#layout{display:block}#extensions_settings2{width:100%;min-width:0}' });
        const mobile = await page.locator(`#chat .mes[mesid="${latest}"] .mi-panel`).evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
        check('панель ответа на телефоне (390 px) без горизонтальной прокрутки', mobile.scroll <= mobile.client + 1, mobile);
        const settingsWidth = await page.locator('.mi-ui-settings').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
        check('фиолетовые настройки и раскрывашки помещаются в 390 px', settingsWidth.scroll <= settingsWidth.client + 1, settingsWidth);
        await page.locator(`#chat .mes[mesid="${latest}"]`).screenshot({ path: path.join(shots, 'layout-chat-mobile.png') });
        await page.evaluate(async () => {
            const s = window.__st.extensionSettings.megainfo;
            for (const [key, module] of Object.entries(s.modules)) module.enabled = key === 'diary';
            s.showOnLast = 0;
            window.__st.model = kind => {
                if (kind !== 'main') throw new Error('Сценарий только с заметками не должен делать отдельных запросов');
                return 'Тихий вечер.\n<megainfo>' + JSON.stringify({ diary: { title: 'Тихий вечер', entry: 'Заметка без панели состояния.' } }) + '</megainfo>';
            };
            await window.__newChat('layout-diary-only', 'Новый чат.');
            await window.__send('Первый вечер');
            await window.__send('Второй вечер');
        });
        const diaryOnly = '#chat .mes[mesid="2"] details.mi-diary[data-mi-sec="diary"]';
        check('у старого ответа только с заметками нет основной панели', await page.locator('#chat .mes[mesid="2"] .mi-info-host').count() === 0 && await page.locator(diaryOnly).count() === 1);
        await page.locator(`${diaryOnly} > summary`).click();
        await page.waitForFunction(() => window.__st.chat[2].extra.megainfo.ui?.details?.['section:diary'] === false);
        check('ответ только с заметками запоминает свёрнутость', await page.evaluate(() => window.__st.chat[2].swipe_info[0].extra.megainfo.ui.details['section:diary'] === false));
        await page.evaluate(async () => { (await import('/ext/index.js')).renderAll(); });
        check('эта свёрнутость переживает перерисовку', !await page.locator(diaryOnly).evaluate(el => el.open));
        await page.evaluate(() => window.__persistForReload());
        await page.reload();
        await page.waitForSelector(diaryOnly);
        check('и перезагрузку страницы, без лишней панели', !await page.locator(diaryOnly).evaluate(el => el.open) && await page.locator('#chat .mes[mesid="2"] .mi-info-host').count() === 0);
        check('нет ошибок JavaScript и лишних окон ввода', errors.length === 0 && await page.evaluate(() => window.__layoutPopups?.length ?? 0) === 0, errors);
    } catch (error) {
        failure = error;
        console.error(error.stack);
        if (page) await page.screenshot({ path: path.join(shots, 'layout-failure.png'), fullPage: true }).catch(() => {});
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        fs.writeFileSync(path.join(shots, 'layout-results.json'), JSON.stringify({ passed: results.filter(r => r.passed).length, total: results.length, results, errors, ...(failure ? { failure: failure.stack } : {}) }, null, 2));
        console.log(`${results.filter(r => r.passed).length}/${results.length} passed`);
        if (failure || results.some(r => !r.passed)) process.exitCode = 1;
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
