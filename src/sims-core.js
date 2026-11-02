// Логика sims без привязки к интерфейсу: инструкция для модели и пересчёт состояния.
// Главная идея: модель сообщает СОБЫТИЯ (что поели, сколько потратили, который час),
// а все числа считает код. Поэтому статы не скачут, а деньги сходятся.

import { STAT_DEFS } from './settings.js';
import {
    clamp, deepClone, formatMoney, normName, parseDateTime, str, toNumber, weekday,
} from './util.js';

export const SIMS_TAG = 'sims';
const MAX_DECAY_MINUTES = 7 * 24 * 60;
const DEFAULT_STAT = { food: 70, hygiene: 80, energy: 70, arousal: 10 };

/**
 * @typedef {Object} SimsOptions
 * @property {string[]} stats       активные статы
 * @property {Object<string, number>} decay  изменение за 2 часа по каждому стату
 * @property {number} npcMax
 * @property {'short'|'full'} npcDetail
 * @property {string} charName
 * @property {string} userName
 * @property {string} currency
 */

// ---------------------------------------------------------------- инструкция

const STAT_NAMES_RU = {
    food: 'сытость', hygiene: 'гигиена', energy: 'бодрость', arousal: 'возбуждение',
};

const WARNINGS = {
    food: 'сильный голод',
    hygiene: 'давно не мылся(-ась), нужен душ',
    energy: 'на исходе сил, клонит в сон',
    arousal: 'сильное возбуждение, сложно думать о другом',
};

function personStateLine(p, opts) {
    const parts = [];
    if (p.stats) {
        const statText = opts.stats
            .filter((k) => p.stats[k] !== undefined)
            .map((k) => `${STAT_NAMES_RU[k]} ${Math.round(p.stats[k])}`)
            .join(', ');
        if (statText) parts.push(statText);
    }
    if (p.money !== undefined && p.money !== null) parts.push(`деньги ${formatMoney(p.money, opts.currency)}`);
    if (p.mood && p.role !== 'user') parts.push(`настроение: ${p.mood}`);
    if (p.outfit) parts.push(`одежда: ${p.outfit}`);
    return `- ${p.name} [${p.role}]: ${parts.join(' · ') || '—'}`;
}

export function collectWarnings(state, opts) {
    const out = [];
    for (const p of Object.values(state?.people ?? {})) {
        if (!p.stats || !(state.scene ?? []).includes(p.id)) continue;
        for (const k of opts.stats) {
            const def = STAT_DEFS[k];
            const v = p.stats[k];
            if (v === undefined) continue;
            if ((def.critLow !== undefined && v < def.critLow) || (def.critHigh !== undefined && v > def.critHigh)) {
                out.push({ id: p.id, name: p.name, stat: k, value: v, text: WARNINGS[k] });
            }
        }
        if (p.money !== undefined && p.money !== null && toNumber(p.money) < 1000) {
            out.push({ id: p.id, name: p.name, stat: 'money', value: p.money, text: 'почти нет денег' });
        }
    }
    return out;
}

export function formatState(state, opts) {
    if (!state) {
        return 'CURRENT STATE: none yet — this is the first block. Mark every person as new, and pick a plausible date, time and location from the story.';
    }
    const lines = [];
    lines.push('CURRENT STATE (calculated by the system — trust it, do not recalculate):');
    const wd = weekday(state.date, state.time);
    lines.push([`${wd ? wd + ' ' : ''}${state.date ?? ''} ${state.time ?? ''}`.trim(), state.weather, state.location].filter(Boolean).join(' · '));

    const people = Object.values(state.people ?? {});
    const scene = new Set(state.scene ?? []);
    const shown = people.filter((p) => p.role === 'char' || p.role === 'user' || scene.has(p.id));
    const order = { char: 0, user: 1, npc: 2 };
    shown.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));
    for (const p of shown) lines.push(personStateLine(p, opts));

    const absent = people.filter((p) => !shown.includes(p)).map((p) => p.name);
    if (absent.length) lines.push(`Known NPCs not in the scene: ${absent.join(', ')}.`);

    const warnings = collectWarnings(state, opts);
    if (warnings.length) {
        lines.push('Warnings (reflect them naturally in behaviour, without melodrama): '
            + warnings.map((w) => `${w.name} — ${w.text}`).join('; ') + '.');
    }
    return lines.join('\n');
}

export function buildInstruction(state, opts, { separate = false } = {}) {
    const C = opts.charName || 'Character';
    const U = opts.userName || 'User';
    const statKeys = opts.stats;
    const zero = Object.fromEntries(statKeys.map((k) => [k, 0]));
    const newStats = Object.fromEntries(statKeys.map((k) => [k, DEFAULT_STAT[k]]));
    const hasStats = statKeys.length > 0;
    const npcFull = opts.npcDetail === 'full';

    const example = {
        date: 'DD.MM.YYYY', time: 'HH:MM', weather: 'пасмурно, +8°', location: 'Кофейня у дома',
        people: [
            { name: C, role: 'char', mood: '…', outfit: '…', thought: '…', ...(hasStats ? { d: zero } : {}) },
            { name: U, role: 'user', outfit: '…', ...(hasStats ? { d: zero } : {}) },
        ],
        money: [{ who: C, amount: -450, note: 'кофе' }],
    };
    if (opts.npcMax > 0) {
        example.people.push(npcFull
            ? { name: 'Имя NPC', role: 'npc', mood: '…', outfit: '…', thought: '…', ...(hasStats ? { d: zero } : {}) }
            : { name: 'Имя NPC', role: 'npc', mood: '…', outfit: '…' });
    }

    const rules = [];
    rules.push('- date/time: the in-story moment at the END of this reply. Time only moves forward and matches events (a conversation ≈ minutes, sleep ≈ hours). Day of week is computed by the system.');
    rules.push('- weather: short. location: short place name.');
    rules.push(`- people: everyone physically present in the scene: ${C} first, then ${U}, then ${opts.npcMax > 0 ? `at most ${opts.npcMax} most important NPC(s)` : 'NO NPCs'}. Skip people who are absent.`);
    if (hasStats) {
        rules.push(`- Stats are 0–100: ${statKeys.map((k) => `${k} = ${STAT_NAMES_RU[k]}`).join(', ')}.`);
        rules.push('- d: change caused ONLY by events of this reply (e.g. full meal food +40…+60, snack +15, workout energy −20 and hygiene −20, kissing arousal +10…+30). Omit or 0 if nothing happened. Passive change over time is applied automatically by the system — never include it.');
        rules.push('- set: absolute value, ONLY for full resets: woke up after a full night of sleep → {"energy":90}; shower/bath → {"hygiene":100}; orgasm → {"arousal":0}. Example: {"name":"…","role":"char","set":{"hygiene":100}}.');
    }
    rules.push('- mood: 1–3 words. outfit: short but concrete. thought: one sentence of hidden inner monologue in first person, never said aloud.');
    rules.push(`- ${U}: only outfit${hasStats ? ' and d/set' : ''}. Never invent ${U}'s mood or thoughts.`);
    if (!npcFull && opts.npcMax > 0) rules.push('- NPC: only name, role, mood, outfit.');
    rules.push('- money: only actual spending (negative) or income (positive) in this reply, realistic prices. [] if none. Never output balances — the system keeps them.');
    rules.push(`- A person NOT listed in CURRENT STATE gets "new": {${hasStats ? `"stats":${JSON.stringify(newStats)},` : ''}"money":15000,"birthday":"DD.MM.YYYY","zodiac":"…","mbti":"INTJ"} with values that fit them. Never send "new" for people already in the state.`);
    rules.push('- All text values in Russian.');

    const head = separate
        ? 'You are a silent status tracker for a roleplay. Read the latest part of the story and reply with ONLY a <sims> block — no other text.'
        : '[MegaInfo · status tracker]\nAfter the story text, at the very END of your reply, append a <sims> block. Write nothing after it.';

    return [
        head,
        'The block holds ONE valid JSON object (no comments, no markdown). Code parses and hides it, so never mention it in the story.',
        '',
        formatState(state, opts),
        '',
        'FORMAT:',
        `<${SIMS_TAG}>`,
        JSON.stringify(example),
        `</${SIMS_TAG}>`,
        '',
        'RULES:',
        ...rules,
    ].join('\n');
}

// ---------------------------------------------------------------- пересчёт

function findPerson(people, entry, role) {
    const list = Object.values(people);
    if (role === 'user') return list.find((p) => p.role === 'user') ?? null;
    const n = normName(entry.name);
    if (!n) return null;
    let found = list.find((p) => p.role !== 'user' && normName(p.name) === n);
    if (found) return found;
    found = list.find((p) => {
        if (p.role === 'user') return false;
        const pn = normName(p.name);
        if (pn.length < 3 || n.length < 3) return false;
        return pn.includes(n) || n.includes(pn) || pn.split(' ')[0] === n.split(' ')[0];
    });
    return found ?? null;
}

function makeId(people, name, role) {
    if (role === 'user') return 'user';
    const base = normName(name) || 'npc';
    let id = base;
    let i = 2;
    while (people[id]) id = `${base}_${i++}`;
    return id;
}

function readStats(obj, opts) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const k of opts.stats) {
        if (obj[k] === undefined || obj[k] === null || obj[k] === '') continue;
        out[k] = toNumber(obj[k], NaN);
        if (!Number.isFinite(out[k])) delete out[k];
    }
    return out;
}

/**
 * Применяет ответ модели к предыдущему состоянию.
 * @param {object|null} prev  предыдущее состояние (или null)
 * @param {object} data       разобранный JSON модели
 * @param {SimsOptions} opts
 * @returns {object} новое состояние
 */
export function applyUpdate(prev, data, opts) {
    const state = {
        v: 1,
        date: str(data.date, 20) || prev?.date || '',
        time: str(data.time, 10) || prev?.time || '',
        weather: str(data.weather, 80) || prev?.weather || '',
        location: str(data.location, 120) || prev?.location || '',
        people: deepClone(prev?.people ?? {}),
        scene: [],
        tx: [],
        elapsed: 0,
    };

    // 1. Сколько прошло времени и пассивный спад статов
    const before = parseDateTime(prev?.date, prev?.time);
    const after = parseDateTime(state.date, state.time);
    let elapsed = 0;
    if (before && after) elapsed = Math.max(0, (after.getTime() - before.getTime()) / 60000);
    state.elapsed = Math.round(elapsed);
    const decayMinutes = Math.min(elapsed, MAX_DECAY_MINUTES);

    for (const p of Object.values(state.people)) {
        const old = { ...(p.stats ?? {}) };
        p.diff = {};
        p.thought = '';
        if (!p.stats) continue;
        for (const k of opts.stats) {
            if (p.stats[k] === undefined) continue;
            const rate = opts.decay[k] ?? 0;
            p.stats[k] = clamp(p.stats[k] + rate * decayMinutes / 120, 0, 100);
        }
        p._old = old;
    }

    // 2. Люди в сцене
    const entries = Array.isArray(data.people) ? data.people : [];
    let npcCount = 0;
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        let role = String(entry.role ?? '').toLowerCase();
        if (!['char', 'user', 'npc'].includes(role)) role = 'npc';
        const name = str(entry.name, 60) || (role === 'user' ? opts.userName : '');
        if (!name) continue;

        let person = findPerson(state.people, { name }, role);
        if (!person) {
            if (role === 'npc' && npcCount >= opts.npcMax) continue;
            const isNew = entry.new && typeof entry.new === 'object' ? entry.new : {};
            const id = makeId(state.people, name, role);
            const withStats = role !== 'npc' || opts.npcDetail === 'full';
            const stats = withStats ? { ...Object.fromEntries(opts.stats.map((k) => [k, DEFAULT_STAT[k]])), ...readStats(isNew.stats, opts) } : null;
            person = {
                id, name, role,
                stats: stats ? Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, clamp(v, 0, 100)])) : null,
                money: isNew.money !== undefined ? toNumber(isNew.money, null) : null,
                profile: {
                    birthday: str(isNew.birthday, 20),
                    zodiac: str(isNew.zodiac, 20),
                    mbti: str(isNew.mbti, 40),
                },
                mood: '', outfit: '', thought: '', diff: {},
                _old: null,
            };
            state.people[id] = person;
        } else if (entry.new && typeof entry.new === 'object') {
            // Уже знакомый человек: профиль только дополняем, ничего не перезаписываем.
            person.profile ??= {};
            for (const f of ['birthday', 'zodiac', 'mbti']) {
                if (!person.profile[f] && entry.new[f]) person.profile[f] = str(entry.new[f], 40);
            }
            if ((person.money === null || person.money === undefined) && entry.new.money !== undefined) {
                person.money = toNumber(entry.new.money, null);
            }
        }
        if (person.role === 'npc') {
            if (npcCount >= opts.npcMax) continue;
            npcCount++;
        }
        if (person.role !== 'user' && role === 'char') person.role = 'char';

        if (person.role !== 'user') person.mood = str(entry.mood, 60) || person.mood || '';
        person.outfit = str(entry.outfit, 160) || person.outfit || '';
        if (person.role !== 'user') person.thought = str(entry.thought, 400);

        if (person.stats) {
            const set = readStats(entry.set, opts);
            for (const [k, v] of Object.entries(set)) person.stats[k] = clamp(v, 0, 100);
            const d = readStats(entry.d ?? entry.delta, opts);
            for (const [k, v] of Object.entries(d)) {
                if (person.stats[k] === undefined) continue;
                person.stats[k] = clamp(person.stats[k] + clamp(v, -100, 100), 0, 100);
            }
        }
        if (!state.scene.includes(person.id)) state.scene.push(person.id);
    }

    // Если модель забыла кого-то из главных — оставляем их в сцене прошлого блока.
    for (const id of prev?.scene ?? []) {
        const p = state.people[id];
        if (p && (p.role === 'char' || p.role === 'user') && !state.scene.includes(id)) state.scene.push(id);
    }

    // 3. Деньги: только транзакции, баланс считает код
    const txs = Array.isArray(data.money) ? data.money : [];
    for (const tx of txs) {
        if (!tx || typeof tx !== 'object') continue;
        const amount = toNumber(tx.amount, NaN);
        if (!Number.isFinite(amount) || amount === 0) continue;
        const who = str(tx.who, 60);
        const isUser = normName(who) === normName(opts.userName);
        const person = findPerson(state.people, { name: who }, isUser ? 'user' : 'char');
        if (!person) continue;
        person.money = toNumber(person.money, 0) + amount;
        state.tx.push({ who: person.name, id: person.id, amount, note: str(tx.note, 80) });
    }

    // 4. Разница с прошлым блоком (для стрелочек +5 / −10)
    for (const p of Object.values(state.people)) {
        if (p.stats) {
            for (const k of Object.keys(p.stats)) {
                p.stats[k] = Math.round(p.stats[k]);
                if (p._old && p._old[k] !== undefined) p.diff[k] = p.stats[k] - Math.round(p._old[k]);
            }
        }
        delete p._old;
    }
    return state;
}

/** Проверка, что из ответа вообще получилось что-то осмысленное. */
export function looksValid(data) {
    return data && typeof data === 'object' && (data.date || data.time || Array.isArray(data.people));
}
