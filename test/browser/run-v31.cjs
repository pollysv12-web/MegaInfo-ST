// Focused 0.3.1 DOM-handler checks against the SillyTavern browser fixture.
// node test/browser/run-v31.cjs [screenshots-directory]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const shots = path.resolve(process.argv[2] || '/tmp/megainfo-v31-browser');
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
        browser = await chromium.launch({ executablePath: process.env.MEGAINFO_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
        page = await browser.newPage({ viewport: { width: 1250, height: 950 } });
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => typeof megaInfoInterceptor === 'function' && document.querySelector('#megainfo_preset_apply'));
        await page.addStyleTag({ content: '#layout{grid-template-columns:minmax(0,1fr) 380px}.text_pole{box-sizing:border-box;max-width:100%}' });
        check('release badge matches manifest', (await page.locator('.mi-edition-tag').textContent()).trim() === require('../../manifest.json').version);

        await page.locator('[data-mi-config-tab="presets"]').click();
        check('settings tab navigation activates only the selected pane', await page.locator('[data-mi-config-panel="presets"]').isVisible() && !await page.locator('[data-mi-config-panel="people"]').isVisible());
        const beforePreset = await page.evaluate(() => JSON.stringify(window.__st.extensionSettings.megainfo));
        await page.selectOption('#megainfo_preset', 'passion');
        check('selecting a gameplay preset alone does not change settings', await page.evaluate(() => JSON.stringify(window.__st.extensionSettings.megainfo)) === beforePreset);
        await page.locator('#megainfo_preset_apply').click();
        check('explicit preset application changes gameplay pace', await page.evaluate(() => window.__st.extensionSettings.megainfo.lastPreset === 'passion' && window.__st.extensionSettings.megainfo.modules.slowburn.speed === 'fast'));

        await page.evaluate(async () => {
            const { DEFAULTS } = await import('/ext/src/settings.js');
            const s = window.__st.extensionSettings.megainfo = structuredClone(DEFAULTS);
            Object.assign(s, { mode: 'inline', showOnLast: 0, collapsed: false });
            for (const [key, module] of Object.entries(s.modules)) module.enabled = ['sims', 'relations', 'world', 'slowburn', 'pocket'].includes(key);
            s.modules.sims.npcMax = 3;
            s.tracking.pinnedNpc = 'Кира';
            window.__popupQueue = [];
            const base = SillyTavern.getContext;
            SillyTavern.getContext = () => ({ ...base(), async callGenericPopup(html) {
                const action = window.__popupQueue.shift();
                if (!action) throw new Error('Unexpected popup in test');
                if (action.form) {
                    html.find('[data-pocket-name]').val(action.form.name);
                    html.find('[data-pocket-note]').val(action.form.note);
                    return true;
                }
                return action.value;
            } });
            window.__v31turn = 0;
            window.__st.model = (kind) => {
                if (kind !== 'main') throw new Error('Focused inline scenario must not call a model service');
                const first = ++window.__v31turn === 1;
                const payload = {
                    date: '12.11.2026', time: first ? '10:00' : '12:00', location: 'Кофейня', weather: 'Ясно',
                    people: [
                        { name: 'Алекс', role: 'char', mood: 'Рад встрече', outfit: 'Рубашка и джинсы',
                            ...(first ? { new: { stats: { food: 60, hygiene: 80, energy: 70, arousal: 60 }, excitement: 5, money: 2000 } }
                                : { d: { food: 20, arousal: 5, excitement: 30 }, reasons: { food: 'съел сэндвич', arousal: 'поцелуй', excitement: 'хорошая новость' } }) },
                        { name: 'Миша', role: 'user', outfit: 'Куртка', ...(first ? { new: { stats: { food: 70, hygiene: 90, energy: 75, arousal: 0 }, money: 500 } } : {}) },
                        { name: 'Кира', role: 'npc', mood: 'Задумчива', outfit: 'Фартук', ...(first ? { new: { stats: { food: 55 }, money: 300 } } : {}) },
                        { name: 'Илья', role: 'npc', mood: 'Весел', outfit: 'Куртка', ...(first ? { new: { stats: { food: 85 } } } : {}) },
                    ],
                    slowburn: { d: 1, moment: '' },
                    world: { pace: 'slow', plot: 'Разговор', plot_d: 1, ...(first ? { thread_add: [{ text: 'Обещал вернуть книгу', endings: ['Вернуть книгу', 'Обсудить потерю'] }] } : {}) },
                    ...(first ? { pocket: { add: [{ who: 'Алекс', name: 'Ключ', note: 'От квартиры' }, { who: 'Миша', name: 'Письмо', note: 'Неотправленное' }] } } : {}),
                };
                return 'Алекс улыбнулся и поставил кофе на стол.\n\n<megainfo>' + JSON.stringify(payload) + '</megainfo>';
            };
            await (await import('/ext/src/ui-settings.js')).loadValues();
            await window.__newChat('v31-focused', 'Приветствие.');
            await window.__send('Первый ход');
            await window.__send('Второй ход');
        });
        const id = await page.evaluate(() => window.__st.chat.length - 1);
        const message = `#chat .mes[mesid="${id}"]`;
        const panel = `${message} .mi-info-host`;
        const main = `${message} .mi-role-char`;
        await page.locator(`${message} [data-mi-tab="chars"]`).click();
        const numbers = await page.evaluate(id => { const p = window.__st.chat[id].extra.megainfo.state.people['алекс']; return [p.stats.arousal, p.excitement]; }, id);
        check('passion and emotional excitement keep independent values and labels', numbers[0] === 55 && numbers[1] === 30
            && (await page.locator(`${main} [data-mi-stat="arousal"] .mi-stat-label`).textContent()).trim() === 'Страсть'
            && (await page.locator(`${main} [data-mi-stat="excitement"] .mi-stat-label`).textContent()).trim() === 'Возбуждение', numbers);
        const foodReason = page.locator(`${main} [data-mi-stat="food"] .mi-stat-change`);
        check('hover text explains time and event causes', /По времени/.test(await foodReason.locator('summary').getAttribute('title')) && /съел сэндвич/.test(await foodReason.locator('summary').getAttribute('title')));
        await foodReason.locator('summary').click();
        check('tapping a stat expands its change explanation', await foodReason.evaluate(el => el.open) && /В сцене/.test(await foodReason.textContent()));
        await foodReason.locator('summary').click();
        check('change explanations collapse again', !await foodReason.evaluate(el => el.open));

        await page.evaluate(() => window.__popupQueue.push({ value: '75' }));
        await page.locator(`${main} [data-mi-act="edit-field"][data-mi-field="arousal"]`).click();
        await page.waitForFunction(id => window.__st.chat[id].extra.megainfo.state.people['алекс'].stats.arousal === 75, id);
        check('stat pencil edits the selected stat and current swipe without changing emotions', await page.evaluate(id => {
            const m = window.__st.chat[id], p = m.extra.megainfo.state.people['алекс'];
            return p.excitement === 30 && p.changes.arousal.some(c => c.kind === 'manual') && m.swipe_info[m.swipe_id].extra.megainfo.state.people['алекс'].stats.arousal === 75;
        }, id));
        await page.evaluate(() => window.__popupQueue.push({ value: 'Красное пальто' }));
        await page.locator(`${main} [data-mi-act="edit-field"][data-mi-field="outfit"]`).click();
        await page.waitForFunction(id => window.__st.chat[id].extra.megainfo.state.people['алекс'].outfit === 'Красное пальто', id);
        check('clothing pencil updates the rendered field', /Красное пальто/.test(await page.locator(main).textContent()));
        await page.evaluate(() => window.__popupQueue.push({ value: '1234' }));
        await page.locator(`${message} [data-mi-sec="profile"] > summary`).click();
        await page.locator(`${message} [data-mi-pane="chars"] [data-mi-act="edit-field"][data-mi-person="алекс"][data-mi-field="money"]`).click();
        await page.waitForFunction(id => window.__st.chat[id].extra.megainfo.state.people['алекс'].money === 1234, id);
        check('money pencil edits the balance', await page.evaluate(id => window.__st.chat[id].extra.megainfo.state.people['алекс'].money === 1234, id));

        await page.locator(`${message} [data-mi-tab="npc"]`).click();
        const npc = page.locator(`${message} [data-mi-pane="npc"] .mi-person`);
        const npcStats = await npc.evaluateAll(els => els.map(el => ({ name: el.querySelector('.mi-name')?.textContent, stats: el.querySelectorAll('[data-mi-stat]').length, pencils: el.querySelectorAll('[data-mi-act="edit-field"]').length })));
        check('pinned NPC is detailed while other NPC stays brief', npcStats.find(p => p.name.includes('Кира'))?.stats > 0 && npcStats.find(p => p.name.includes('Илья'))?.stats === 0, npcStats);
        check('NPC pane does not expose Pulse pencil controls', npcStats.every(p => p.pencils === 0));

        await page.locator('[data-mi-config-tab="people"]').click();
        await page.locator('#megainfo_tracking_name').evaluate(el => { el.closest('details').open = true; });
        await page.locator('#megainfo_tracking_name').fill('Алекс');
        await page.locator('#megainfo_tracking_name').dispatchEvent('change');
        await page.locator('[data-mi-track-field="outfit"]').uncheck();
        await page.locator(`${message} [data-mi-tab="chars"]`).click();
        check('per-person field selection hides clothing without deleting its data', !await page.locator(`${main} [data-mi-field="outfit"]`).count()
            && await page.evaluate(id => window.__st.chat[id].extra.megainfo.state.people['алекс'].outfit === 'Красное пальто', id));
        await page.locator('[data-mi-track-field="outfit"]').check();

        await page.locator('[data-mi-config-tab="view"]').click();
        await page.locator('[data-mi-order="rel"][data-mi-direction="-1"]').evaluate(el => { el.closest('details').open = true; });
        await page.locator('[data-mi-order="rel"][data-mi-direction="-1"]').click();
        const order = await page.locator(`${message} .mi-tab`).evaluateAll(els => els.map(el => el.dataset.miTab));
        check('settings order arrows reorder actual response tabs', order.indexOf('rel') < order.indexOf('npc'), order);
        await page.locator('[data-mi-config-subtab="colors"]').click();
        const sizeBefore = await page.locator(panel).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        await page.locator('[data-mi-setting="display.fontSize"]').fill('125');
        await page.locator('[data-mi-setting="display.fontSize"]').dispatchEvent('change');
        await page.selectOption('[data-mi-setting="display.contrast"]', 'high');
        check('text size and contrast controls affect the actual panel', await page.locator(panel).evaluate(el => parseFloat(getComputedStyle(el).fontSize)) > sizeBefore
            && await page.locator(panel).getAttribute('data-mi-contrast') === 'high');
        await page.selectOption('[data-mi-setting="theme"]', 'custom');
        const contrastColors = [];
        for (const contrast of ['normal', 'high', 'soft']) {
            await page.selectOption('[data-mi-setting="display.contrast"]', contrast);
            contrastColors.push(await page.locator(`${main} [data-mi-stat="food"] .mi-stat-label`).evaluate(el => getComputedStyle(el).color));
        }
        check('custom palette preserves all three visibly different contrast choices', new Set(contrastColors).size === 3, contrastColors);
        await page.selectOption('[data-mi-setting="theme"]', 'tavern');
        await page.selectOption('[data-mi-setting="display.contrast"]', 'high');
        await page.locator('[data-mi-config-subtab="layout"]').click();
        await page.locator('[data-mi-setting="display.pulse.outfit"]').evaluate(el => { el.closest('details').open = true; });
        await page.selectOption('[data-mi-setting="display.pulse.outfit"]', 'collapse');
        check('Pulse fields can move under a closed disclosure', await page.locator(`${main} details[data-mi-sec="pulse:алекс:outfit"]`).count() === 1
            && !await page.locator(`${main} details[data-mi-sec="pulse:алекс:outfit"]`).evaluate(el => el.open));

        await page.locator(`${message} [data-mi-tab="pocket"]`).click();
        await page.evaluate(() => window.__popupQueue.push({ form: { name: 'Подарок', note: 'Для Миши' } }));
        await page.locator(`${message} [data-mi-act="pocket-add"][data-mi-person="алекс"]`).click();
        await page.waitForFunction(id => window.__st.chat[id].extra.megainfo.state.pockets['алекс'].some(i => i.name === 'Подарок'), id);
        const giftId = await page.evaluate(id => window.__st.chat[id].extra.megainfo.state.pockets['алекс'].find(i => i.name === 'Подарок').id, id);
        check('Pocket add handler stores the chosen item and updates current swipe', await page.evaluate(([id, itemId]) => window.__st.chat[id].swipe_info[0].extra.megainfo.state.pockets['алекс'].some(i => i.id === itemId), [id, giftId]));
        await page.evaluate(() => window.__popupQueue.push({ form: { name: 'Подарок в упаковке', note: 'Не открывать до встречи' } }));
        await page.locator(`${message} [data-mi-act="pocket-edit"][data-mi-item="${giftId}"]`).click();
        await page.waitForFunction(([id, itemId]) => window.__st.chat[id].extra.megainfo.state.pockets['алекс'].some(i => i.id === itemId && i.name === 'Подарок в упаковке'), [id, giftId]);
        check('Pocket edit handler updates name and note', await page.locator(`${message} .mi-pockets`).textContent().then(text => text.includes('Не открывать до встречи')));
        await page.locator(`${message} [data-mi-act="pocket-remove"][data-mi-item="${giftId}"]`).click();
        await page.waitForFunction(([id, itemId]) => !window.__st.chat[id].extra.megainfo.state.pockets['алекс'].some(i => i.id === itemId), [id, giftId]);
        check('Pocket remove handler persists the removal in metadata', await page.evaluate(itemId => window.__st.chatMetadata.megainfo.pocketEdits.some(e => e.itemId === itemId && e.removed), giftId));
        await page.evaluate(() => window.__popupQueue.push({ form: { name: 'Жетон', note: 'Памятная вещь' } }));
        await page.locator(`${message} [data-mi-act="pocket-add"][data-mi-person="user"]`).click();
        await page.waitForFunction(id => window.__st.chat[id].extra.megainfo.state.pockets.user.some(i => i.name === 'Жетон'), id);
        check('the user has an independently editable Pocket', await page.evaluate(id => !window.__st.chat[id].extra.megainfo.state.pockets['алекс'].some(i => i.name === 'Жетон'), id));

        await page.locator(`${message} [data-mi-tab="world"]`).click();
        await page.locator(`${message} .mi-thread-endings > summary`).click();
        check('open story threads reveal possible endings on tap', /Вернуть книгу/.test(await page.locator(`${message} .mi-thread-endings`).textContent()) && await page.locator(`${message} .mi-thread-endings`).evaluate(el => el.open));
        await page.locator(`${message} [data-mi-act="thread-dismiss"]`).click();
        await page.waitForFunction(id => window.__st.chat[id].extra.megainfo.state.world.threads.length === 0, id);
        check('thread removal updates state, swipe, and metadata', await page.evaluate(id => window.__st.chatMetadata.megainfo.dismissedThreads.length === 1 && window.__st.chat[id].swipe_info[0].extra.megainfo.state.world.threads.length === 0, id));

        await page.locator(`${message} [data-mi-tab="chars"]`).click();
        await page.locator(panel).screenshot({ path: path.join(shots, 'v31-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addStyleTag({ content: '#layout{display:block}#extensions_settings2{width:100%;min-width:0}' });
        const mobile = await page.locator(`${message} .mi-panel`).evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
        check('mobile Pulse panel has no horizontal overflow at 390px', mobile.scroll <= mobile.client + 1, mobile);
        await page.locator(panel).screenshot({ path: path.join(shots, 'v31-mobile.png') });
        await page.locator('[data-mi-config-tab="presets"]').click();
        const settingsWidth = await page.locator('.mi-ui-settings').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
        check('compact settings fit 390px mobile width', settingsWidth.scroll <= settingsWidth.client + 1, settingsWidth);
        check('no browser errors or unconsumed test popups', errors.length === 0 && await page.evaluate(() => window.__popupQueue.length) === 0, errors);
    } catch (error) {
        failure = error;
        console.error(error.stack);
        if (page) await page.screenshot({ path: path.join(shots, 'v31-failure.png'), fullPage: true }).catch(() => {});
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        fs.writeFileSync(path.join(shots, 'v31-results.json'), JSON.stringify({ passed: results.filter(r => r.passed).length, total: results.length, results, errors, ...(failure ? { failure: failure.stack } : {}) }, null, 2));
        console.log(`${results.filter(r => r.passed).length}/${results.length} passed`);
        if (failure || results.some(r => !r.passed)) process.exitCode = 1;
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
