// Сцена (дата, время, погода, место) + люди: статы sims, деньги, профиль, одежда, мысли, симпатия.
// Главная идея: модель сообщает СОБЫТИЯ (что поели, сколько потратили, насколько потеплело отношение),
// а все числа считает код. Поэтому статы не скачут, деньги сходятся, симпатия меняется плавно.

import { STAT_DEFS } from '../settings.js';
import {
    clamp, deepClone, formatMoney, normName, parseDateTime, str, toNumber, weekday,
} from '../util.js';

const MAX_DECAY_MINUTES = 7 * 24 * 60;
export const DEFAULT_STAT = { food: 70, hygiene: 80, energy: 70, arousal: 10 };

const STAT_NAMES = { food: 'сытость', hygiene: 'гигиена', energy: 'бодрость', arousal: 'возбуждение' };
const WARNINGS = {
    food: 'сильный голод',
    hygiene: 'давно не мылся(-ась), нужен душ',
    energy: 'на исходе сил, клонит в сон',
    arousal: 'сильное возбуждение, сложно думать о другом',
};

const ROLE_ORDER = { char: 0, user: 1, npc: 2 };

export function sortPeople(list) {
    return [...list].sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3));
}

/** Люди, которые сейчас в сцене, в порядке: персонаж, юзер, NPC. */
export function scenePeople(state) {
    if (!state?.people) return [];
    return sortPeople((state.scene ?? []).map((id) => state.people[id]).filter(Boolean));
}

const simsFull = (opts) => opts.on.sims && opts.s.modules.sims.variant !== 'lite';
const withStats = (opts) => simsFull(opts) && opts.stats.length > 0;

// ---------------------------------------------------------------- состояние для модели

function personLine(p, opts) {
    const parts = [];
    if (withStats(opts) && p.stats) {
        const t = opts.stats.filter((k) => p.stats[k] !== undefined).map((k) => `${STAT_NAMES[k]} ${Math.round(p.stats[k])}`).join(', ');
        if (t) parts.push(t);
    }
    if (simsFull(opts) && opts.s.modules.sims.showMoney && p.money !== undefined && p.money !== null) {
        parts.push(`деньги ${formatMoney(p.money, opts.s.modules.sims.currency)}`);
    }
    if (opts.on.relations && p.role !== 'user' && typeof p.aff === 'number') {
        parts.push(`affinity→${opts.userName}: ${Math.round(p.aff)}${p.rel ? ` (${p.rel})` : ''}`);
    }
    if (p.mood && p.role !== 'user') parts.push(`настроение: ${p.mood}`);
    if (p.outfit) parts.push(`одежда: ${p.outfit}`);
    return `- ${p.name} [${p.role}]: ${parts.join(' · ') || '—'}`;
}

export function collectWarnings(state, opts) {
    const out = [];
    if (!withStats(opts)) return out;
    for (const p of scenePeople(state)) {
        if (!p.stats) continue;
        for (const k of opts.stats) {
            const def = STAT_DEFS[k];
            const v = p.stats[k];
            if (v === undefined) continue;
            if ((def.critLow !== undefined && v < def.critLow) || (def.critHigh !== undefined && v > def.critHigh)) {
                out.push({ id: p.id, name: p.name, stat: k, value: v, text: WARNINGS[k] });
            }
        }
        if (opts.s.modules.sims.showMoney && p.money !== undefined && p.money !== null && toNumber(p.money) < 1000) {
            out.push({ id: p.id, name: p.name, stat: 'money', value: p.money, text: 'почти нет денег' });
        }
    }
    return out;
}

export function sceneLine(state) {
    if (!state) return '';
    const wd = weekday(state.date, state.time);
    return [`${wd ? wd + ' ' : ''}${state.date ?? ''} ${state.time ?? ''}`.trim(), state.weather, state.location].filter(Boolean).join(' · ');
}

export function stateLines(state, opts) {
    if (!state) return [];
    const lines = [];
    const head = sceneLine(state);
    if (head) lines.push(`Сейчас: ${head}`);
    if (!(simsFull(opts) || opts.on.relations)) return lines;

    const people = Object.values(state.people ?? {});
    const scene = new Set(state.scene ?? []);
    const shown = sortPeople(people.filter((p) => p.role === 'char' || p.role === 'user' || scene.has(p.id)));
    for (const p of shown) lines.push(personLine(p, opts));
    const absent = people.filter((p) => !shown.includes(p)).map((p) => p.name);
    if (absent.length) lines.push(`Known NPCs not in the scene: ${absent.slice(-12).join(', ')}.`);

    const warnings = collectWarnings(state, opts);
    if (warnings.length) {
        lines.push('Warnings (reflect them naturally in behaviour, without melodrama): '
            + warnings.map((w) => `${w.name} — ${w.text}`).join('; ') + '.');
    }
    return lines;
}

// ---------------------------------------------------------------- инструкция

/** Нужны ли в запросе люди (sims full или отношения). */
export function needPeople(request, opts) {
    return (request.has('sims') && simsFull(opts)) || request.has('relations');
}

export function schema(state, request, opts) {
    const C = opts.charName || 'Character';
    const U = opts.userName || 'User';
    const out = { date: 'DD.MM.YYYY', time: 'HH:MM', weather: '…', location: '…' };
    if (!needPeople(request, opts)) return out;

    const full = request.has('sims') && simsFull(opts);
    const stats = full && withStats(opts);
    const rel = request.has('relations');
    const zero = Object.fromEntries(opts.stats.map((k) => [k, 0]));
    const char = { name: C, role: 'char' };
    if (full) Object.assign(char, { mood: '…' });
    char.outfit = '…';
    if (full || (rel && opts.s.modules.relations.thoughts)) char.thought = '…';
    if (stats) char.d = zero;
    if (rel) Object.assign(char, { aff: 0, rel: '…' });

    const user = { name: U, role: 'user', outfit: '…' };
    if (stats) user.d = zero;
    out.people = [char, user];

    const npcMax = Number(opts.s.modules.sims.npcMax) || 0;
    if (npcMax > 0) {
        const npc = { name: 'Имя NPC', role: 'npc', outfit: '…' };
        if (full) npc.mood = '…';
        if (full && opts.s.modules.sims.npcDetail === 'full') {
            npc.thought = '…';
            if (stats) npc.d = zero;
        } else if (rel && opts.s.modules.relations.npc && opts.s.modules.relations.thoughts) {
            npc.thought = '…';
        }
        if (rel && opts.s.modules.relations.npc) Object.assign(npc, { aff: 0, rel: '…' });
        out.people.push(npc);
    }
    if (full && opts.s.modules.sims.showMoney) out.money = [{ who: C, amount: -450, note: 'кофе' }];
    return out;
}

export function rules(state, request, opts) {
    const C = opts.charName || 'Character';
    const U = opts.userName || 'User';
    const r = [];
    r.push('- date/time: the in-story moment at the END of this reply. Time only moves forward and matches events (a conversation ≈ minutes, sleep ≈ hours). Day of week is computed by the system.');
    r.push('- weather: short. location: short place name; reuse EXACTLY the same name while the scene stays there.');
    if (!needPeople(request, opts)) return r;

    const full = request.has('sims') && simsFull(opts);
    const stats = full && withStats(opts);
    const rel = request.has('relations');
    const npcMax = Number(opts.s.modules.sims.npcMax) || 0;
    r.push(`- people: everyone physically present in the scene: ${C} first, then ${U}, then ${npcMax > 0 ? `at most ${npcMax} most important NPC(s)` : 'NO NPCs'}. Skip people who are absent.`);
    if (stats) {
        r.push(`- Stats are 0–100: ${opts.stats.map((k) => `${k} = ${STAT_NAMES[k]}`).join(', ')}.`);
        r.push('- d: change caused ONLY by events of this reply (full meal food +40…+60, snack +15, workout energy −20 and hygiene −20, kissing arousal +10…+30). 0 if nothing happened. Passive change over time is applied by the system — never include it.');
        r.push('- set: absolute value ONLY for full resets: woke up after a full night of sleep → {"energy":90}; shower/bath → {"hygiene":100}; orgasm → {"arousal":0}. Example: {"name":"…","role":"char","set":{"hygiene":100}}.');
    }
    if (full) r.push('- mood: 1–3 words. outfit: short but concrete (what is visible).');
    else r.push('- outfit: short but concrete (what is visible).');
    if (full || (rel && opts.s.modules.relations.thoughts)) {
        r.push(`- thought: one sentence of hidden inner monologue in first person — secret motives, real reaction to ${U}. Never said aloud.`);
    }
    r.push(`- ${U}: only outfit${stats ? ' and d/set' : ''}. Never invent ${U}'s mood, thoughts or feelings.`);
    if (rel) {
        const step = Number(opts.s.modules.relations.maxStep) || 5;
        r.push(`- aff: CHANGE of this person's feelings toward ${U} caused by THIS reply. Usually 0; small things ±1…3; only strong events up to ±${step}. Never output the total — the system keeps it.`);
        r.push(`- rel: short name of their relationship with ${U} (e.g. «незнакомец», «коллега», «соперник», «друг», «влюблён(а)»). Repeat the current one unless it really changed.`);
        if (!opts.s.modules.relations.npc) r.push('- NPC: no aff/rel.');
    }
    if (full && opts.s.modules.sims.npcDetail !== 'full' && npcMax > 0) r.push('- NPC: no stats.');
    if (full && opts.s.modules.sims.showMoney) {
        r.push('- money: only actual spending (negative) or income (positive) in this reply, realistic prices. [] if none. Never output balances — the system keeps them.');
    }
    const newFields = [];
    if (stats) newFields.push(`"stats":${JSON.stringify(Object.fromEntries(opts.stats.map((k) => [k, DEFAULT_STAT[k]])))}`);
    if (full && opts.s.modules.sims.showMoney) newFields.push('"money":15000');
    if (full && opts.s.modules.sims.showProfile) newFields.push('"birthday":"DD.MM.YYYY","zodiac":"…","mbti":"INTJ — короткое описание"');
    if (rel) newFields.push('"aff":0');
    if (newFields.length) {
        r.push(`- A person NOT listed in the current state gets "new": {${newFields.join(',')}} with values that fit them${rel ? ' (aff = starting attitude to ' + U + ', −100…100)' : ''}. Never send "new" for people already in the state.`);
    }
    return r;
}

// ---------------------------------------------------------------- пересчёт

function findPerson(people, name, role) {
    const list = Object.values(people);
    if (role === 'user') return list.find((p) => p.role === 'user') ?? null;
    const n = normName(name);
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

export function findPersonByName(state, name, opts) {
    if (!state?.people || !name) return null;
    const isUser = normName(name) === normName(opts.userName) || /^(user|юзер|\{\{user\}\})$/i.test(String(name).trim());
    return findPerson(state.people, name, isUser ? 'user' : 'char');
}

function makeId(people, name, role) {
    if (role === 'user') return 'user';
    const base = normName(name) || 'npc';
    let id = base;
    let i = 2;
    while (people[id]) id = `${base}_${i++}`;
    return id;
}

function readStats(obj, keys) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const k of keys) {
        if (obj[k] === undefined || obj[k] === null || obj[k] === '') continue;
        const v = toNumber(obj[k], NaN);
        if (Number.isFinite(v)) out[k] = v;
    }
    return out;
}

/** Сцена: дата, время, погода, место + пассивный спад статов. */
export function applyScene(next, base, data, opts) {
    next.date = str(data.date, 20) || base?.date || '';
    next.time = str(data.time, 10) || base?.time || '';
    next.weather = str(data.weather, 80) || base?.weather || '';
    next.location = str(data.location, 120) || base?.location || '';

    const before = parseDateTime(base?.date, base?.time);
    const after = parseDateTime(next.date, next.time);
    let elapsed = 0;
    if (before && after) elapsed = Math.max(0, (after.getTime() - before.getTime()) / 60000);
    // время назад не идёт: если модель ошиблась, оставляем прежнее
    if (before && after && after.getTime() < before.getTime() - 60000) {
        next.date = base.date;
        next.time = base.time;
        next.issues.push('время ушло назад — оставлено прежнее');
    }
    next.elapsed = Math.round(elapsed);

    const decayMinutes = Math.min(elapsed, MAX_DECAY_MINUTES);
    for (const p of Object.values(next.people)) {
        p._old = p.stats ? { ...p.stats } : null;
        p._oldAff = typeof p.aff === 'number' ? p.aff : null;
        if (!p.stats || !withStats(opts)) continue;
        for (const k of opts.stats) {
            if (p.stats[k] === undefined) continue;
            const rate = opts.decay[k] ?? 0;
            p.stats[k] = clamp(p.stats[k] + rate * decayMinutes / 120, 0, 100);
        }
    }
}

/** Люди, их статы, деньги, симпатия. */
export function applyPeople(next, base, data, request, opts) {
    const full = request.has('sims') && simsFull(opts);
    const stats = full && withStats(opts);
    const rel = request.has('relations');
    const relNpc = rel && opts.s.modules.relations.npc;
    const step = Number(opts.s.modules.relations.maxStep) || 5;
    const npcMax = Number(opts.s.modules.sims.npcMax) || 0;
    const npcFull = opts.s.modules.sims.npcDetail === 'full';

    for (const p of Object.values(next.people)) {
        p.diff = {};
        p.affDiff = 0;
        if (full || (rel && opts.s.modules.relations.thoughts)) p.thought = '';
    }
    next.scene = [];
    next.tx = [];

    const entries = Array.isArray(data.people) ? data.people : [];
    let npcCount = 0;
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        let role = String(entry.role ?? '').toLowerCase();
        if (!['char', 'user', 'npc'].includes(role)) role = 'npc';
        const name = str(entry.name, 60) || (role === 'user' ? opts.userName : '');
        if (!name) continue;
        if (role !== 'user' && normName(name) === normName(opts.userName)) role = 'user';

        let person = findPerson(next.people, name, role);
        const isNew = entry.new && typeof entry.new === 'object' ? entry.new : {};
        let created = false;
        if (!person) {
            created = true;
            if (role === 'npc' && npcCount >= npcMax) continue;
            const id = makeId(next.people, role === 'user' ? opts.userName : name, role);
            const hasStats = role !== 'npc' || npcFull;
            const st = hasStats && withStats(opts)
                ? { ...Object.fromEntries(opts.stats.map((k) => [k, DEFAULT_STAT[k]])), ...readStats(isNew.stats, opts.stats) }
                : null;
            person = {
                id,
                name: role === 'user' ? (opts.userName || name) : name,
                role,
                stats: st ? Object.fromEntries(Object.entries(st).map(([k, v]) => [k, clamp(v, 0, 100)])) : null,
                money: isNew.money !== undefined ? toNumber(isNew.money, null) : null,
                profile: { birthday: str(isNew.birthday, 20), zodiac: str(isNew.zodiac, 20), mbti: str(isNew.mbti, 60) },
                mood: '', outfit: '', thought: '', diff: {}, affDiff: 0,
                _old: null, _oldAff: null,
            };
            if (role !== 'user' && (rel || isNew.aff !== undefined)) {
                const start = toNumber(isNew.aff ?? entry.aff_start, NaN);
                person.aff = Number.isFinite(start) ? clamp(start, -100, 100) : 0;
            }
            next.people[person.id] = person;
        } else {
            // Уже знакомый человек: профиль только дополняем, ничего не перезаписываем.
            person.profile ??= {};
            for (const f of ['birthday', 'zodiac', 'mbti']) {
                if (!person.profile[f] && isNew[f]) person.profile[f] = str(isNew[f], 60);
            }
            if ((person.money === null || person.money === undefined) && isNew.money !== undefined) {
                person.money = toNumber(isNew.money, null);
            }
            if (stats && !person.stats && (person.role !== 'npc' || npcFull)) {
                person.stats = Object.fromEntries(opts.stats.map((k) => [k, DEFAULT_STAT[k]]));
                Object.assign(person.stats, readStats(isNew.stats, opts.stats));
            }
            if (rel && person.role !== 'user' && typeof person.aff !== 'number') {
                const start = toNumber(isNew.aff, NaN);
                person.aff = Number.isFinite(start) ? clamp(start, -100, 100) : 0;
            }
        }
        if (person.role === 'npc') {
            if (npcCount >= npcMax) continue;
            npcCount++;
        }
        if (person.role === 'npc' && role === 'char') person.role = 'char';

        if (full && person.role !== 'user') person.mood = str(entry.mood, 60) || person.mood || '';
        person.outfit = str(entry.outfit, 200) || person.outfit || '';
        if (person.role !== 'user' && (full || (rel && opts.s.modules.relations.thoughts))) person.thought = str(entry.thought, 500);

        if (stats && person.stats) {
            for (const [k, v] of Object.entries(readStats(entry.set, opts.stats))) person.stats[k] = clamp(v, 0, 100);
            for (const [k, v] of Object.entries(readStats(entry.d ?? entry.delta, opts.stats))) {
                if (person.stats[k] === undefined) continue;
                person.stats[k] = clamp(person.stats[k] + clamp(v, -100, 100), 0, 100);
            }
        }
        if (rel && person.role !== 'user' && (person.role === 'char' || relNpc)) {
            if (typeof person.aff !== 'number') person.aff = 0;
            // у нового человека aff в "new" — стартовое значение, а не изменение
            if (!created) person.aff = clamp(person.aff + clamp(toNumber(entry.aff, 0), -step, step), -100, 100);
            const label = str(entry.rel, 40);
            if (label) person.rel = label;
        }
        if (!next.scene.includes(person.id)) next.scene.push(person.id);
    }

    // Если модель забыла кого-то из главных — оставляем их в сцене прошлого блока.
    for (const id of base?.scene ?? []) {
        const p = next.people[id];
        if (p && (p.role === 'char' || p.role === 'user') && !next.scene.includes(id)) next.scene.push(id);
    }

    // Деньги: только транзакции, баланс считает код
    if (full && opts.s.modules.sims.showMoney) {
        for (const tx of Array.isArray(data.money) ? data.money : []) {
            if (!tx || typeof tx !== 'object') continue;
            const amount = toNumber(tx.amount, NaN);
            if (!Number.isFinite(amount) || amount === 0) continue;
            const person = findPersonByName(next, str(tx.who, 60), opts);
            if (!person) continue;
            person.money = toNumber(person.money, 0) + amount;
            next.tx.push({ who: person.name, id: person.id, amount, note: str(tx.note, 80) });
        }
    }
}

/** Разница с прошлым блоком (для стрелочек +5 / −10), округление. */
export function finishPeople(next) {
    for (const p of Object.values(next.people ?? {})) {
        if (p.stats) {
            for (const k of Object.keys(p.stats)) {
                p.stats[k] = Math.round(p.stats[k]);
                if (p._old && p._old[k] !== undefined) p.diff[k] = p.stats[k] - Math.round(p._old[k]);
            }
        }
        if (typeof p.aff === 'number') {
            p.aff = Math.round(p.aff);
            p.affDiff = p._oldAff === null || p._oldAff === undefined ? 0 : p.aff - Math.round(p._oldAff);
        }
        delete p._old;
        delete p._oldAff;
    }
}

export { deepClone };
