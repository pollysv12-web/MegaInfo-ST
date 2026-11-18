// Браузерные проверки редактора блока, причин изменений, валюты, карточек и точечной перерисовки.
// node test/browser/editor.cjs [папка для скриншотов]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const chromiumPath = require('./chromium.cjs');

const root = path.resolve(__dirname, '../..');
const shots = path.resolve(process.argv[2] || '/tmp/megainfo-editor');
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
        page.setDefaultTimeout(8000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('TOAST')) errors.push(message.text()); });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => typeof megaInfoInterceptor === 'function' && document.querySelector('#megainfo_preset_apply'));
        await page.evaluate(async () => {
            const { DEFAULTS } = await import('/ext/src/settings.js');
            const s = window.__st.extensionSettings.megainfo = structuredClone(DEFAULTS);
            Object.assign(s, { mode: 'inline', showOnLast: 0, collapsed: false });
            for (const [key, module] of Object.entries(s.modules)) module.enabled = ['sims', 'relations', 'cards'].includes(key);
            window.__popups = [];
            window.__toasts = [];
            window.toastr.error = (m) => window.__toasts.push(String(m));
            const base = SillyTavern.getContext;
            SillyTavern.getContext = () => ({ ...base(), async callGenericPopup() {
                if (!window.__popups.length) throw new Error('Неожиданное окно в тесте');
                return window.__popups.shift();
            } });
            window.__turn = 0;
            window.__st.model = (kind, payload) => {
                if (kind !== 'main') throw new Error('Сценарий без отдельных запросов не должен обращаться к модели');
                const first = ++window.__turn === 1;
                const asksCurrency = /"currency"/.test(payload.injection);
                return 'Алекс протянул чек.\n\n[[mi:card]]\n\nОн улыбнулся.\n\n<megainfo>' + JSON.stringify({
                    date: '12.11.2026', time: `1${window.__turn}:00`, location: 'Кофейня',
                    people: [
                        { name: 'Алекс', role: 'char', mood: 'Рад', outfit: 'Свитер', aff: 2, rel: 'Знакомые', d: { food: 5 },
                            reasons: { food: 'съел печенье', aff: 'Миша его поддержал' },
                            ...(first ? { new: { stats: { food: 60, hygiene: 80, energy: 70, arousal: 10 }, money: 1500, aff: 10 } } : {}) },
                        { name: 'Миша', role: 'user', outfit: 'Куртка' },
                    ],
                    money: [{ who: 'Алекс', amount: '-1,200', note: 'обед' }],
                    ...(asksCurrency ? { currency: '$' } : {}),
                }) + '</megainfo>\n<megainfo_html><div style="position:fixed;inset:0;background:red">Чек</div></megainfo_html>';
            };
            (await import('/ext/src/ui-settings.js')).loadValues();
            await window.__newChat('editor', 'Приветствие.');
            await window.__send('Первый ход');
        });
        // CHAT_CHANGED перерисовывает чат с задержкой 100 мс — дожидаемся её.
        await page.waitForTimeout(300);
        let id = await page.evaluate(() => window.__st.chat.length - 1);
        const msg = (n) => `#chat .mes[mesid="${n}"]`;

        const prompt1 = await page.evaluate(() => window.__st.prompts.at(-1).injection);
        check('в первом блоке модель просят определить валюту', /currency/.test(prompt1));
        check('валюта чата запомнилась из ответа модели', await page.evaluate(() => window.__st.chatMetadata.megainfo.currency) === '$');
        check('сумма «-1,200» посчитана как 1200', await page.evaluate(n => window.__st.chat[n].extra.megainfo.state.people['алекс'].money, id) === 300);
        check('баланс показан в найденной валюте', /300 \$/.test(await page.locator(`${msg(id)} .mi-money`).first().textContent()));
        check('причина изменения симпатии сохранена', await page.evaluate(n => window.__st.chat[n].extra.megainfo.state.people['алекс'].changes.aff?.[0]?.reason, id) === 'Миша его поддержал');

        await page.waitForFunction(n => document.querySelector(`#chat .mes[mesid="${n}"] .mi-card-host`)?.shadowRoot && getComputedStyle(document.querySelector(`#chat .mes[mesid="${n}"] .mi-card-host`)).contain !== '', id);
        const card = await page.locator(`${msg(id)} .mi-card-host`).evaluate((host) => {
            const inner = host.shadowRoot.querySelector('div > div');
            const box = inner.getBoundingClientRect();
            return { contain: getComputedStyle(host).contain, position: getComputedStyle(inner).position, width: box.width, height: box.height, viewport: innerWidth, host: host.getBoundingClientRect().width };
        });
        check('карточка с position:fixed не растягивается на всё окно', /paint/.test(card.contain) && card.position !== 'fixed' && card.height > 0 && card.width <= card.host + 1 && card.width < card.viewport, card);

        await page.evaluate(() => { document.querySelector('#chat .mes[mesid="2"] .mi-info-host').dataset.testMark = 'old'; });
        await page.evaluate(() => window.__send('Второй ход'));
        id = await page.evaluate(() => window.__st.chat.length - 1);
        check('новый ответ не перестраивает панели старых сообщений', await page.locator('#chat .mes[mesid="2"] .mi-info-host[data-test-mark="old"]').count() === 1);
        check('во втором ответе валюту больше не спрашивают', !/currency/.test(await page.evaluate(() => window.__st.prompts.at(-1).injection)));

        const before = await page.evaluate(n => JSON.stringify(window.__st.chat[n].extra.megainfo.state), id);
        await page.evaluate(() => window.__popups.push('{ "people": [] }', '{ сломано', false));
        await page.locator(`${msg(id)} [data-mi-act="edit"]`).click();
        await page.waitForFunction(() => window.__popups.length === 0);
        await page.waitForTimeout(50);
        const toasts = await page.evaluate(() => window.__toasts);
        check('редактор не сохраняет неверную структуру и объясняет почему', toasts.some((t) => /people/.test(t)), toasts);
        check('редактор не сохраняет нечитаемый JSON', toasts.some((t) => /JSON не читается/.test(t)), toasts);
        check('после отказа состояние не изменилось', await page.evaluate(n => JSON.stringify(window.__st.chat[n].extra.megainfo.state), id) === before);
        await page.evaluate((n) => {
            const state = structuredClone(window.__st.chat[n].extra.megainfo.state);
            state.people['алекс'].stats.food = 150;
            window.__popups.push(JSON.stringify(state));
        }, id);
        await page.locator(`${msg(id)} [data-mi-act="edit"]`).click();
        await page.waitForFunction(n => window.__st.chat[n].extra.megainfo.state.people['алекс'].stats.food === 100, id);
        check('верная правка сохраняется с числами в границах', true);

        await page.locator(`${msg(id)} [data-mi-tab="chars"]`).click();
        check('причины раскрываются по нажатию, пока они включены', await page.locator(`${msg(id)} details.mi-stat-change`).count() > 0);
        await page.locator('[data-mi-setting="modules.sims.reasons"]').evaluate((el) => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForFunction(n => !document.querySelector(`#chat .mes[mesid="${n}"] details.mi-stat-change`), id);
        check('без причин значения показываются без раскрытия', await page.locator(`${msg(id)} .mi-no-reasons`).count() > 0);
        await page.evaluate(() => window.__send('Третий ход'));
        check('без причин модель их не просят', !/reasons/.test(await page.evaluate(() => window.__st.prompts.at(-1).injection)));
        check('нет ошибок JavaScript и лишних окон', errors.length === 0 && await page.evaluate(() => window.__popups.length) === 0, errors);
    } catch (error) {
        failure = error;
        console.error(error.stack);
        if (page) await page.screenshot({ path: path.join(shots, 'editor-failure.png'), fullPage: true }).catch(() => {});
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        console.log(`${results.filter(r => r.passed).length}/${results.length} passed`);
        if (failure || results.some(r => !r.passed)) process.exitCode = 1;
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
