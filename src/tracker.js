// Оркестровка: что попросить у модели в этот раз, как разобрать ответ, когда делать отдельный запрос.

import {
    STAT_DEFS, activeStats, getSettings, moduleOn, MODULE_LIST, phonesExist, userPronoun,
} from './settings.js';
import {
    applyData, buildContext, buildInstruction, CONTEXTUAL, extractBlocks, Extras, LEGACY_TAGS, Loc,
    looksValid, OUR_TAGS, parseJsonBlock, TRACKERS,
} from './core/engine.js';
import {
    botMessagesBetween, clearData, findPreviousState, findPreviousWith, getData, getMessage, getPlaces,
    isBotMessage, markPlaceTry, placeTries, saveChat, savePlace, setData, setMessageText,
} from './store.js';
import { cardContext, chatHistory, errorText, recentStory, sideRequest } from './request.js';
import * as Log from './log.js';
import { stripAnyHtml, stripTagBlocks } from './util.js';

const ctx = () => SillyTavern.getContext();
const SCENE = ['sims', 'relations', 'world', 'marks', 'slowburn'];

/** Сообщения, для которых сейчас идёт отдельный запрос: id -> Promise */
export const pending = new Map();
/** id сообщений, где отдельный запрос пересчитывает числа (их стоит дождаться перед следующим ответом) */
const pendingScene = new Set();

/** Запросы, которые нужно дождаться перед новой генерацией. */
export function blockingJobs() {
    const s = getSettings();
    // полный запрос идёт через генерацию таверны — две генерации сразу ей не нравятся
    if (s.separateKind === 'full') return [...pending.values()];
    return [...pendingScene].map((id) => pending.get(id)).filter(Boolean);
}
let onChange = () => {};
export function setChangeListener(fn) { onChange = fn; }
export function clearPending() {
    pending.clear();
    pendingScene.clear();
}

// ---------------------------------------------------------------- опции

export function buildOpts() {
    const s = getSettings();
    const c = ctx();
    const stats = activeStats(s);
    const on = Object.fromEntries(MODULE_LIST.map((m) => [m.key, moduleOn(m.key, s)]));
    return {
        s,
        on,
        stats,
        decay: Object.fromEntries(stats.map((k) => [k, Number(s.modules.sims.stats[k]?.decay ?? STAT_DEFS[k].decay)])),
        charName: c.name2,
        userName: c.name1,
        pronoun: userPronoun(s),
        language: s.language || 'Russian',
        places: getPlaces(),
        phones: phonesExist(s),
    };
}

/** Теги, которые вырезаются из истории перед отправкой модели. */
export function cleanTagList(s = getSettings()) {
    const extra = String(s.cleanTags ?? '').split(/[,\s]+/).map((t) => t.trim().replace(/[<>/]/g, '')).filter((t) => /^[\w-]+$/.test(t));
    return [...new Set([...OUR_TAGS, ...LEGACY_TAGS, ...extra])];
}

/** Чистит текст сообщения для промпта. depth — насколько сообщение далеко от конца. */
export function cleanForPrompt(text, depth, s = getSettings()) {
    if (typeof text !== 'string' || !text) return text;
    let out = /<\w/.test(text) ? stripTagBlocks(text, cleanTagList(s)) : text;
    const n = Number(s.stripHtmlDepth) || 0;
    if (n > 0 && depth >= n) out = stripAnyHtml(out);
    return out;
}

// ---------------------------------------------------------------- что нужно в этот раз

function since(targetId, test) {
    const last = findPreviousWith(targetId, test);
    if (!last) return Infinity;
    return botMessagesBetween(last.id, targetId - 1) + 1;
}

/**
 * Какие модули «по расписанию» нужны для сообщения targetId.
 * @returns {{ trackers: Set<string>, diary: boolean, prev: object|null }}
 */
export function computeDue(targetId, opts = buildOpts()) {
    const prev = findPreviousState(targetId)?.value ?? null;
    const trackers = new Set();
    for (const k of SCENE) {
        if (!opts.on[k]) continue;
        if (k === 'sims' || k === 'slowburn' || k === 'relations' || k === 'world' || k === 'marks') {
            const every = Math.max(1, Number(opts.s.modules[k].every) || 1);
            if (every === 1 || since(targetId, (d) => d.upd?.includes(k)) >= every) trackers.add(k);
        }
    }
    let diary = false;
    if (opts.on.diary) {
        const cfg = opts.s.modules.diary;
        if (cfg.frequency === 'every') diary = true;
        else if (cfg.frequency === 'n') diary = since(targetId, (d) => !!d.diary) >= Math.max(1, Number(cfg.every) || 1);
        else if (cfg.frequency === 'day') {
            const last = findPreviousWith(targetId, (d) => !!d.diary);
            const lastDate = last?.data?.state?.date || String(last?.data?.diary?.date ?? '').split(' ')[0];
            diary = !last || !prev?.date || lastDate !== prev.date;
        }
    }
    return { trackers, diary, prev };
}

/** Что просим у модели прямо в ответе. */
export function inlineRequestFor(due, opts) {
    const r = new Set();
    if (opts.s.mode === 'separate') return r;
    for (const k of due.trackers) r.add(k);
    if (opts.on.location && due.trackers.size) r.add('location');
    for (const k of CONTEXTUAL) if (opts.on[k]) r.add(k);
    if (due.diary && opts.s.modules.diary.mode === 'inline') r.add('diary');
    return r;
}

/** Предыдущая запись дневника (чтобы новая не повторяла её). */
function previousDiary(beforeId) {
    return findPreviousWith(beforeId, (d) => !!d.diary)?.data?.diary ?? null;
}

// ---------------------------------------------------------------- вставка в промпт

/**
 * Текст, который вставляется в обычный запрос.
 * @param {number} targetId  id сообщения, которое сейчас будет сгенерировано
 */
export function injectionFor(targetId) {
    const opts = buildOpts();
    if (!opts.s.enabled) return { text: '', request: new Set() };
    const due = computeDue(targetId, opts);
    const request = inlineRequestFor(due, opts);
    let text = '';
    if (request.size) {
        text = buildInstruction({
            state: due.prev, request, opts, separate: false, prevDiary: request.has('diary') ? previousDiary(targetId) : null,
        });
    } else if (opts.s.remindState) {
        text = buildContext(due.prev, opts);
    }
    return { text, request };
}

// ---------------------------------------------------------------- разбор ответа

function storeResult(id, message, res, { scene }) {
    if (scene) {
        setData(message, 'state', res.state);
        const upd = [...new Set([...(getData(message)?.upd ?? []), ...res.upd])];
        setData(message, 'upd', upd);
        setData(message, 'err', undefined);
    }
    if (res.diary) setData(message, 'diary', res.diary);
    if (res.phone) setData(message, 'phone', res.phone);
    if (res.card) setData(message, 'card', res.card);
    if (res.place) {
        savePlace(res.place, id);
        setData(message, 'newPlace', res.place.name);
    }
}

/** Применяет найденный JSON. @returns {{ok:boolean, res?:object, error?:string}} */
function applyJson(id, message, json, request, opts, { base, fresh }) {
    try {
        const data = parseJsonBlock(json);
        if (!looksValid(data)) throw new Error('в JSON нет ожидаемых полей');
        const res = applyData({ base, fresh, data, request, opts });
        res.upd = [...request].filter((k) => TRACKERS.includes(k));
        const scene = SCENE.some((k) => request.has(k));
        storeResult(id, message, res, { scene });
        if (res.issues?.length) Log.warn(`#${id}: поправлено кодом`, res.issues);
        return { ok: true, res };
    } catch (e) {
        Log.warn(`#${id}: блок не разобран — ${e.message}`, json.slice(0, 600));
        return { ok: false, error: e.message };
    }
}

/**
 * Вызывается после каждого ответа бота.
 */
export async function handleReceived(messageId, type) {
    const opts = buildOpts();
    const s = opts.s;
    if (!s.enabled || type === 'impersonate') return;
    const id = Number(messageId);
    const message = getMessage(id);
    if (!isBotMessage(message)) return;

    // У нового свайпа/перегенерации таверна оставляет extra от прошлого варианта — чистим своё.
    if (type !== 'continue') clearData(message);

    let blocks = extractBlocks(message.mes);
    let fromReasoning = false;
    if (!blocks.json && typeof message.extra?.reasoning === 'string' && message.extra.reasoning.includes('<megainfo')) {
        const r = extractBlocks(message.extra.reasoning);
        if (r.json) {
            blocks = { ...blocks, json: r.json, card: blocks.card ?? r.card };
            message.extra.reasoning = r.text;
            fromReasoning = true;
        }
    }
    if (blocks.found) setMessageText(message, blocks.text);
    if (blocks.found || fromReasoning) {
        const $el = $(`#chat .mes[mesid="${id}"]`);
        if ($el.length) ctx().updateMessageBlock(id, message);
    }

    if (type === 'first_message') {
        if (blocks.found) await saveChat();
        return;
    }

    const due = computeDue(id, opts);
    const request = inlineRequestFor(due, opts);
    const base = due.prev;
    let jsonOk = false;
    let gotDiary = false;
    let newState = null;

    // Оборванный блок (ответ упёрся в лимит длины): если можно добрать отдельным запросом — добираем,
    // иначе применяем то, что успело прийти.
    const truncated = !!blocks.json && !blocks.jsonClosed;
    if (truncated && s.mode !== 'inline' && due.trackers.size) {
        Log.warn(`#${id}: блок оборван (ответ упёрся в лимит длины) — доберу отдельным запросом`);
    } else if (blocks.json && request.size) {
        const r = applyJson(id, message, blocks.json, request, opts, { base, fresh: true });
        jsonOk = r.ok;
        if (r.ok) {
            newState = r.res.state;
            gotDiary = !!r.res.diary;
            Log.info(`#${id}: блок из ответа применён`, { modules: [...request], closed: blocks.jsonClosed, fromReasoning });
            ctx().getTokenCountAsync?.(blocks.json).then((n) => setData(message, 'outTokens', n)).catch(() => {});
        } else {
            setData(message, 'err', { text: r.error, raw: blocks.json.slice(0, 4000) });
        }
    } else if (request.size && !(type === 'continue' && getData(message)?.state)) {
        const tail = String(message.mes ?? '').slice(-220).replace(/\s+/g, ' ');
        const hint = /[{}]/.test(tail) ? ' (в конце есть фигурные скобки — возможно, блок испорчен регуляркой)' : '';
        Log.warn(`#${id}: в ответе нет блока <megainfo> (тип: ${type ?? 'normal'})${hint}`, { asked: [...request], tail });
    }
    if (blocks.bare) Log.info(`#${id}: блок без тега <megainfo> — найден JSON в конце ответа`);
    if (request.size) {
        setData(message, 'dbg', {
            asked: [...request], found: !!blocks.json, bare: !!blocks.bare, truncated, ok: jsonOk,
            tail: blocks.json ? '' : String(message.mes ?? '').slice(-300),
        });
    }
    if (blocks.card) {
        const card = Extras.parseCard(blocks.card, s.modules.cards.maxChars);
        if (card && opts.on.cards) setData(message, 'card', card);
    }

    // Что не пришло и нужно добрать отдельным запросом
    const missing = new Set();
    const contextual = CONTEXTUAL.filter((k) => opts.on[k]);
    if (s.mode === 'separate' && due.trackers.size) {
        for (const k of due.trackers) missing.add(k);
        for (const k of contextual) missing.add(k);
    } else if (s.mode === 'auto' && !jsonOk && due.trackers.size && !(type === 'continue' && getData(message)?.state)) {
        for (const k of due.trackers) missing.add(k);
        for (const k of contextual) if (k !== 'cards' || !getData(message)?.card) missing.add(k);
    }
    if (opts.on.location && s.mode !== 'inline') {
        if (SCENE.some((k) => missing.has(k))) missing.add('location');
        else if (newState && Loc.needsPlace(newState, getPlaces()) && placeTries(newState.location) < 2) {
            markPlaceTry(newState.location);
            missing.add('location');
        }
    }
    if (opts.on.diary && due.diary) {
        if (s.modules.diary.mode === 'separate' || (s.mode !== 'inline' && !gotDiary)) missing.add('diary');
    }

    await saveChat();
    onChange(id);
    if (missing.size) runSeparate(id, missing);
}

/** Пользователь отредактировал сообщение — если вписал блок руками, применяем его. */
export async function handleEdited(messageId) {
    const opts = buildOpts();
    if (!opts.s.enabled) return;
    const id = Number(messageId);
    const message = getMessage(id);
    if (!isBotMessage(message)) return;
    const blocks = extractBlocks(message.mes);
    if (!blocks.found) return;
    setMessageText(message, blocks.text);
    ctx().updateMessageBlock(id, message);
    if (blocks.json) {
        const due = computeDue(id, opts);
        const request = new Set([...TRACKERS.filter((k) => opts.on[k]), ...CONTEXTUAL.filter((k) => opts.on[k]), ...(opts.on.diary ? ['diary'] : [])]);
        applyJson(id, message, blocks.json, request, opts, { base: due.prev, fresh: true });
    }
    await saveChat();
    onChange(id);
}

// ---------------------------------------------------------------- отдельный запрос

/**
 * Запрашивает недостающие блоки для сообщения отдельным запросом.
 * @param {number} messageId
 * @param {Set<string>|string[]} modules
 * @param {{ force?: boolean, retry?: number }} [o]
 */
export function runSeparate(messageId, modules, o = {}) {
    const id = Number(messageId);
    if (pending.has(id)) return pending.get(id);
    const message = getMessage(id);
    if (!isBotMessage(message)) return null;
    const c = ctx();
    const chatId = c.getCurrentChatId();
    const swipeId = message.swipe_id;
    const stillValid = () => ctx().getCurrentChatId() === chatId && getMessage(id) === message && message.swipe_id === swipeId;

    const job = (async () => {
        const opts = buildOpts();
        const s = opts.s;
        const request = new Set([...modules].filter((k) => opts.on[k]));
        if (!request.size) return;
        const scene = SCENE.some((k) => request.has(k));
        const prevState = findPreviousState(id)?.value ?? null;
        // Трекеры считаем заново от прошлого сообщения; дневник/место — дописываем к текущему.
        const base = scene ? prevState : (getData(message)?.state ?? prevState);
        const instruction = buildInstruction({
            state: base, request, opts, separate: true, prevDiary: request.has('diary') ? previousDiary(id) : null,
        });
        const maxTokens = Math.max(400, Number(s.maxTokens) || 2500);
        Log.info(`#${id}: отдельный запрос (${o.kind ?? s.separateKind}${o.retry ? ', повтор' : ''})`, { modules: [...request] });

        const ask = 'Now output ONLY the <megainfo> block for the moment right after the last message of the story.';
        const kind = o.kind ?? s.separateKind;
        let answer = '';
        if (kind === 'full') {
            const card = cardContext();
            answer = await sideRequest({
                system: card ? `${instruction}\n\n---\nCONTEXT:\n${card}` : instruction,
                history: chatHistory(id, 60, cleanTagList(s)),
                final: `[Конец истории]\n${ask}`,
                profileId: s.profileId,
                maxTokens,
            });
        } else {
            const story = recentStory(id, Math.max(1, Number(s.contextMessages) || 6), cleanTagList(s));
            answer = await sideRequest({ system: instruction, final: `STORY (latest part):\n\n${story}\n\n---\n${ask}`, profileId: s.profileId, maxTokens });
        }
        if (!stillValid()) {
            Log.info(`#${id}: ответ отдельного запроса устарел (свайп/смена чата) — пропускаю`);
            return 'stale';
        }
        const blocks = extractBlocks(answer);
        const json = blocks.json ?? (answer.includes('{') ? answer : null);
        if (blocks.card && request.has('cards')) {
            const card = Extras.parseCard(blocks.card, s.modules.cards.maxChars);
            if (card) setData(message, 'card', card);
        }
        if (!json) {
            if (request.size === 1 && request.has('cards')) return 'ok';
            throw Object.assign(new Error('модель не прислала блок'), { soft: true, answer });
        }
        const r = applyJson(id, message, json, request, opts, { base, fresh: scene });
        if (!r.ok) {
            if ((o.retry ?? 0) < 1) {
                Log.info(`#${id}: повторяю отдельный запрос`);
                pending.delete(id);
                pendingScene.delete(id);
                return runSeparate(id, request, { ...o, retry: (o.retry ?? 0) + 1 });
            }
            if (scene) setData(message, 'err', { text: r.error, raw: json.slice(0, 4000) });
            await saveChat();
            toastr.warning('Модель вернула неразборчивый блок. Можно нажать ⟳ ещё раз.', 'MegaInfo');
            return 'error';
        }
        Log.info(`#${id}: отдельный запрос применён`, { modules: [...request] });
        await saveChat();
        return 'ok';
    })().catch(async (e) => {
        const msg = errorText(e);
        Log.error(`#${id}: отдельный запрос не удался — ${msg}`, e?.answer ? String(e.answer).slice(0, 500) : undefined);
        // Один повтор: после ошибки API — лёгким запросом (меньше и проще), после пустого ответа — тем же.
        if ((o.retry ?? 0) < 1 && stillValid()) {
            const kind = e?.soft ? (o.kind ?? getSettings().separateKind) : 'light';
            Log.info(`#${id}: пробую ещё раз (${kind})`);
            pending.delete(id);
            pendingScene.delete(id);
            return runSeparate(id, modules, { ...o, retry: 1, kind });
        }
        if (stillValid() && SCENE.some((k) => [...modules].includes(k))) {
            setData(message, 'err', { text: msg, raw: e?.answer ? String(e.answer).slice(0, 2000) : '' });
            await saveChat().catch(() => {});
        }
        toastr.error(msg, 'MegaInfo: не удалось получить блок');
        return 'error';
    });

    pending.set(id, job);
    if (SCENE.some((k) => [...modules].includes(k))) pendingScene.add(id);
    onChange(id);
    job.finally(() => {
        if (pending.get(id) === job) {
            pending.delete(id);
            pendingScene.delete(id);
        }
        onChange(id);
    });
    return job;
}

/** Все модули для кнопки «перегенерировать». */
export function allTrackerModules(opts = buildOpts()) {
    const list = TRACKERS.filter((k) => opts.on[k]);
    return new Set(list);
}
