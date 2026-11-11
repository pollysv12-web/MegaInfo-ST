// Движок: собирает одну общую инструкцию из включённых модулей и применяет ответ модели.
// Модель присылает ОДИН JSON в теге <megainfo>, код раскладывает его по модулям.

import * as People from './people.js';
import * as Slow from './slowburn.js';
import * as World from './world.js';
import * as Marks from './marks.js';
import * as Loc from './location.js';
import * as Extras from './extras.js';
import { deepClone, findTagBlock, parseLooseJson, stripTagBlocks } from '../util.js';

export const TAG = 'megainfo';
export const CARD_TAG = Extras.CARD_TAG;
export const OUR_TAGS = [CARD_TAG, TAG];
/** Места для визуальных блоков в тексте; сами данные по-прежнему хранятся отдельно. */
export const INLINE_MARKERS = Object.freeze({ phone: '[[mi:phone]]', card: '[[mi:card]]' });

/** Убирает служебные места вставки из истории, которую получает модель. */
export function stripPlacementMarkers(text) {
    if (typeof text !== 'string' || !text) return text;
    return text.replace(/\[\[\s*mi\s*:\s*(?:phone|card)\s*\]\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}
/** Теги v0.1 — тоже вырезаем из истории. */
export const LEGACY_TAGS = ['sims'];

/** Модули, которым нужна сцена (дата/время/место). */
const SCENE_MODULES = ['sims', 'relations', 'world', 'marks', 'slowburn'];
/** Модули-трекеры: их состояние переносится из сообщения в сообщение. */
export const TRACKERS = ['sims', 'relations', 'slowburn', 'world', 'marks', 'location'];
/** Модули «по ситуации»: модель сама решает, нужен ли блок. */
export const CONTEXTUAL = ['phone', 'cards'];

const needScene = (request) => SCENE_MODULES.some((k) => request.has(k));

// ---------------------------------------------------------------- состояние для модели

/** Строки «текущего состояния» для всех включённых модулей. */
export function stateLines(state, opts) {
    const out = [];
    const on = opts.on;
    if (state && (on.sims || on.relations || on.world || on.marks || on.slowburn || on.location)) out.push(...People.stateLines(state, opts));
    if (on.location) out.push(...Loc.stateLines(state, opts));
    if (on.slowburn) out.push(...Slow.stateLines(state, opts));
    if (on.world && state) out.push(...World.stateLines(state, opts));
    if (on.marks && state) out.push(...Marks.stateLines(state, opts));
    return out;
}

/** Только напоминание о состоянии, без просьбы выводить блок. */
export function buildContext(state, opts) {
    const lines = stateLines(state, opts);
    if (!lines.length) return '';
    return ['[MegaInfo · current story state — calculated by the system, keep the story consistent with it. Do NOT output any status block in this reply.]', ...lines].join('\n');
}

// ---------------------------------------------------------------- запрос блока

function mergeSchema(state, request, opts) {
    const out = {};
    if (needScene(request)) Object.assign(out, People.schema(state, request, opts));
    if (request.has('slowburn')) Object.assign(out, Slow.schema(state, opts));
    if (request.has('world')) Object.assign(out, World.schema(state, opts));
    if (request.has('marks')) Object.assign(out, Marks.schema(state, opts));
    if (request.has('location')) Object.assign(out, Loc.schema(state, opts));
    if (request.has('diary')) Object.assign(out, Extras.diarySchema(opts));
    if (request.has('phone')) Object.assign(out, Extras.phoneSchema(opts));
    return out;
}

function mergeRules(state, request, opts, prevDiary, separate) {
    const r = [];
    if (needScene(request)) r.push(...People.rules(state, request, opts));
    if (request.has('slowburn')) r.push(...Slow.rules(state, opts));
    if (request.has('world')) r.push(...World.rules(state, opts));
    if (request.has('marks')) r.push(...Marks.rules(state, opts));
    if (request.has('location')) r.push(...Loc.rules(state, opts));
    if (request.has('diary')) r.push(...Extras.diaryRules(opts, prevDiary));
    if (request.has('phone')) r.push(...Extras.phoneRules(opts, { separate }));
    if (request.has('cards')) r.push(...Extras.cardRules(opts, { separate }));
    r.push(`- Keys that are not needed (or did not change, where allowed) may be omitted. All text values in ${opts.language}.`);
    return r;
}

/**
 * Инструкция для модели.
 * @param {object} p
 * @param {object|null} p.state     состояние ДО этого ответа
 * @param {Set<string>} p.request   какие модули нужны в блоке
 * @param {object} p.opts
 * @param {boolean} [p.separate]    отдельный запрос (только блок) или вставка в обычный ответ
 * @param {object} [p.prevDiary]
 */
export function buildInstruction({ state, request, opts, separate = false, prevDiary = null, atStart = false }) {
    const onlyCards = request.size === 1 && request.has('cards');
    if (!request.size) return '';
    const lines = [];
    if (separate) {
        const payload = onlyCards ? `the <${CARD_TAG}> card if needed (otherwise an empty reply)` : `the <${TAG}> block${request.has('cards') ? ` and the <${CARD_TAG}> card if needed` : ''}`;
        lines.push(`You are a silent story-state tracker for a roleplay. Read the latest part of the story and reply with ONLY ${payload} — no story text, no comments, no placement markers. Track events that ALREADY happened in the latest reply; never add phone use, objects, dialogue or other story actions.`);
    } else if (onlyCards) {
        lines.push(`[MegaInfo · visual artifacts]\nWrite the story normally. If a card is needed, append its <${CARD_TAG}> payload at the very END of the reply; the system hides the payload and displays the card at its placement marker in the story.`);
    } else if (atStart) {
        lines.push(`[MegaInfo · status tracker]\nStart your reply with the <${TAG}> block describing the state at the END of this reply, then write the story.`);
    } else {
        lines.push(`[MegaInfo · status tracker]\nWrite the story first. Then, at the very END of your reply, append the <${TAG}> block${request.has('cards') ? ` (and the <${CARD_TAG}> card, if needed)` : ''}. Write nothing after it.`);
    }
    if (!onlyCards) lines.push(`The <${TAG}> block holds ONE valid JSON object (double quotes, no comments, no markdown). The system parses and hides it, so never mention it in the story.`);

    const st = stateLines(state, opts);
    lines.push('');
    if (!state && !onlyCards) {
        lines.push('CURRENT STATE: none yet — this is the first block. Treat every person as new and pick a plausible date, time and location from the story.');
        if (st.length) lines.push(...st);
    } else if (st.length) {
        lines.push('CURRENT STATE (calculated by the system — trust it, do not recalculate):', ...st);
    }
    const sch = mergeSchema(state, request, opts);
    if (Object.keys(sch).length) {
        lines.push('', 'FORMAT:', `<${TAG}>`, JSON.stringify(sch), `</${TAG}>`);
    }
    if (request.has('cards')) lines.push(`<${CARD_TAG}><div>…</div></${CARD_TAG}>  ← optional, see rules`);
    lines.push('', 'RULES:', ...mergeRules(state, request, opts, prevDiary, separate));
    return lines.join('\n');
}

// ---------------------------------------------------------------- разбор ответа

/**
 * Достаёт блоки из текста ответа.
 * @returns {{ json: string|null, card: string|null, text: string, found: boolean }}
 */
export function extractBlocks(text) {
    const raw = String(text ?? '');
    const j = findTagBlock(raw, TAG);
    const c = findTagBlock(raw, CARD_TAG);
    const found = !!(j || c);
    if (!j) {
        // Тега нет — возможно, регулярка срезала теги или модель написала голый ```json в конце ответа.
        const bare = findBareJson(raw);
        if (bare) {
            const rest = c ? stripTagBlocks(raw.slice(0, bare.start), OUR_TAGS) : raw.slice(0, bare.start).trim();
            return { json: bare.json, jsonClosed: true, card: c ? c.inner : null, text: rest.replace(/\n{3,}/g, '\n\n').trim(), found: true, bare: true };
        }
    }
    return {
        json: j ? j.inner : null,
        jsonClosed: j ? j.closed : false,
        card: c ? c.inner : null,
        text: found ? stripTagBlocks(raw, OUR_TAGS) : raw,
        found,
    };
}

/**
 * Ищет JSON-объект с полями MegaInfo в самом конце текста (без тега).
 * @returns {{ json: string, start: number } | null}
 */
export function findBareJson(text) {
    const tail = text.replace(/\s*```\s*$/, '');
    if (!tail.trimEnd().endsWith('}')) return null;
    const from = Math.max(0, tail.length - 20000);
    for (let i = tail.indexOf('{', from); i !== -1; i = tail.indexOf('{', i + 1)) {
        const candidate = tail.slice(i).trim();
        let data;
        try { data = JSON.parse(candidate); } catch { try { data = parseLooseJson(candidate); } catch { continue; } }
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
        const hits = DATA_KEYS.filter((k) => data[k] !== undefined).length;
        if (hits < 2) continue;
        let start = i;
        const fence = text.lastIndexOf('```', i);
        if (fence !== -1 && /^```(?:json)?\s*$/.test(text.slice(fence, i))) start = fence;
        return { json: candidate, start };
    }
    return null;
}

export function parseJsonBlock(inner) {
    return parseLooseJson(inner);
}

const DATA_KEYS = ['date', 'time', 'location', 'people', 'world', 'slowburn', 'marks', 'place', 'diary', 'phone', 'money'];

export function looksValid(data) {
    return !!data && typeof data === 'object' && DATA_KEYS.some((k) => data[k] !== undefined);
}

/** Сбрасывает «одноразовые» поля, когда состояние переносится на новое сообщение. */
export function carryOver(base) {
    const next = deepClone(base ?? { v: 2, people: {}, scene: [] });
    next.v = 2;
    next.people ??= {};
    next.scene ??= [];
    next.elapsed = 0;
    next.tx = [];
    for (const p of Object.values(next.people)) {
        p.diff = {};
        p.affDiff = 0;
    }
    if (next.world) Object.assign(next.world, { twist: '', tensionDiff: 0, progressDiff: 0 });
    if (next.slow) next.slow.diff = 0;
    delete next.issues;
    return next;
}

/**
 * Применяет ответ модели.
 * @param {object} p
 * @param {object|null} p.base     состояние, к которому применяем (предыдущее или текущее сообщение)
 * @param {boolean} p.fresh        true — base взято с прошлого сообщения (переносим), false — дополняем это же сообщение
 * @param {object} p.data          разобранный JSON
 * @param {Set<string>} p.request  какие модули ожидались
 * @param {object} p.opts
 */
export function applyData({ base, fresh = true, data, request, opts }) {
    const next = fresh ? carryOver(base) : deepClone(base ?? { v: 2, people: {}, scene: [] });
    next.people ??= {};
    next.scene ??= [];
    next.issues = [];

    if (needScene(request)) {
        People.applyScene(next, base, data, opts);
        if (People.needPeople(request, opts)) People.applyPeople(next, base, data, request, opts);
        People.finishPeople(next);
    }
    if (request.has('slowburn') && opts.on.slowburn) Slow.apply(next, base, data, opts);
    if (request.has('world') && opts.on.world) World.apply(next, base, data, opts);
    if (request.has('marks') && opts.on.marks) Marks.apply(next, base, data, opts);

    const place = request.has('location') ? Loc.extractPlace(data, next) : null;
    const diary = request.has('diary') ? Extras.parseDiary(data, next) : null;
    const phone = request.has('phone') ? Extras.parsePhone(data) : null;
    const issues = next.issues;
    delete next.issues;
    return { state: next, place, diary, phone, issues };
}

export { Extras, Loc, Marks, People, Slow, World };
