// Сцена (дата, время, погода, место) и люди: потребности, деньги, профиль, одежда, мысли, симпатия.
// Модель сообщает СОБЫТИЯ (поели, потратили, отношение потеплело), а числа считает код.

import { STAT_DEFS } from '../settings.js';
import { trackingFor, trackingRules } from '../tracking.js';
import { eventReason, recordChange } from './changes.js';
import {
    clamp, formatMoney, formatStamp, normName, parseDateTime, str, toNumber, weekday,
} from '../util.js';

const MAX_DECAY_MINUTES = 7 * 24 * 60;
/** Если на той же дате время «откатилось» на столько или больше, это следующий день. */
const NEXT_DAY_GAP_MINUTES = 6 * 60;
export const DEFAULT_STAT = { food: 70, hygiene: 80, energy: 70, arousal: 10 };

/** Подписи для модели: ключ и короткое пояснение. */
const STAT_NAMES = { food: 'food', hygiene: 'hygiene', energy: 'energy', arousal: 'arousal (sexual)' };
const WARNINGS = {
    food: 'сильный голод: рассеянность, урчание живота, поиск еды',
    hygiene: 'гигиена ниже 25: запах, несвежая кожа или одежда заметны вблизи',
    energy: 'сильная усталость: зевота, замедленные реакции, клонит в сон',
    arousal: 'высокое сексуальное возбуждение: сдержанные телесные реакции; желание не равно действию или согласию',
};

/** Порог «почти нет денег» для распространённых валют. Неизвестная валюта — без предупреждения. */
const LOW_MONEY = [
    [/^(?:₽|руб|rub|р\.?$)/i, 1000],
    [/^(?:₴|грн|uah)/i, 300],
    [/^(?:₸|тг|kzt)/i, 5000],
    [/^(?:br|byn|бел)/i, 30],
    [/^(?:\$|usd|€|eur|£|gbp|chf|cad|aud)/i, 20],
    [/^(?:¥|円|jpy|yen|иен)/i, 2000],
    [/^(?:₩|krw|вон)/i, 20000],
    [/^(?:zł|pln|зл)/i, 80],
    [/^(?:кредит|credit|cr\b)/i, 50],
    [/^(?:зол|gold|gp\b|g\b)/i, 3],
    [/^(?:сер|silver|sp\b)/i, 30],
    [/^(?:мед|copper|cp\b)/i, 300],
];

export function lowMoneyThreshold(opts) {
    const manual = Number(opts.s.modules.sims.lowMoney);
    if (Number.isFinite(manual) && manual > 0) return manual;
    const currency = String(opts.currency ?? '').trim();
    if (!currency) return null;
    return LOW_MONEY.find(([re]) => re.test(currency))?.[1] ?? null;
}

const ROLE_ORDER = { char: 0, user: 1, npc: 2 };

export function sortPeople(list) {
    return [...list].sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3));
}

/** Люди, которые сейчас в сцене, в порядке: персонаж, пользователь, NPC. */
export function scenePeople(state) {
    if (!state?.people) return [];
    return sortPeople((state.scene ?? []).map((id) => state.people[id]).filter(Boolean));
}

const simsFull = (opts) => opts.on.sims && opts.s.modules.sims.variant !== 'lite';
const withStats = (opts) => simsFull(opts) && opts.stats.length > 0;
const withEmotions = (opts) => simsFull(opts) && opts.s.modules.sims.excitement !== false;
export const withReasons = (opts) => opts.s.modules.sims.reasons !== false;
const userThoughts = (opts) => opts.s.modules.sims.userThoughts === true
    && (!opts.on.relations || opts.s.modules.relations.thoughts !== false);
/** Участники группового чата: все они — главные персонажи. */
const groupNames = (opts) => (Array.isArray(opts.group) ? opts.group : []).filter(Boolean);
const isMain = (p, opts) => p.role === 'user' || (p.role === 'char'
    && (!groupNames(opts).length || groupNames(opts).some((n) => normName(n) === normName(p.name))));

// ---------------------------------------------------------------- дни рождения

/** Настоящая календарная дата; год можно не указывать — возраст не выдумывается. */
export function birthdayParts(value) {
    const text = String(value ?? '').trim();
    let day, month, year;
    const local = text.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/);
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (local) [, day, month, year] = local;
    else if (iso) [, year, month, day] = iso;
    else return null;
    day = Number(day); month = Number(month);
    const checkYear = year ? Number(year) : 2000;
    const date = new Date(Date.UTC(checkYear, month - 1, day));
    if (date.getUTCFullYear() !== checkYear || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { day, month, year: year ? checkYear : null };
}

/** Один и тот же человек получает одну и ту же запасную дату при перезагрузках и свайпах. */
export function generatedBirthday(person, opts) {
    const seed = `${normName(opts.charName)}|${person.role}|${normName(person.name)}`;
    let hash = 2166136261;
    for (const c of seed) hash = Math.imul(hash ^ c.codePointAt(0), 16777619) >>> 0;
    const date = new Date(Date.UTC(2001, 0, 1 + hash % 365));
    return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ensureBirthday(person, opts, supplied) {
    person.profile ??= {};
    const incoming = str(supplied, 20);
    if (birthdayParts(incoming) && (!birthdayParts(person.profile.birthday) || person.profile.birthdayGenerated)) {
        person.profile.birthday = incoming;
        delete person.profile.birthdayGenerated;
    }
    if (opts.s.modules.sims.birthdays !== false && (person.role === 'char' || person.role === 'user')
        && !birthdayParts(person.profile.birthday)) {
        person.profile.birthday = generatedBirthday(person, opts);
        person.profile.birthdayGenerated = true;
    }
}

export function birthdayLines(state, opts) {
    if (opts.s.modules.sims.birthdays === false) return [];
    const today = birthdayParts(state?.date);
    if (!today) return [];
    const lines = [];
    for (const p of Object.values(state.people ?? {})) {
        if (p.role !== 'char' && p.role !== 'user') continue;
        const tracking = trackingFor(p, opts.s);
        if (tracking.detail === 'off' || !tracking.fields.profile) continue;
        const b = birthdayParts(p.profile?.birthday);
        if (!b || b.day !== today.day || b.month !== today.month) continue;
        lines.push(`TODAY is ${p.name}'s birthday in the story. Close people may know and acknowledge it naturally; strangers know only if told. No compulsory party or gifts.`);
    }
    return lines;
}

// ---------------------------------------------------------------- состояние для модели

function personLine(p, opts) {
    const tracking = trackingFor(p, opts.s);
    const parts = [];
    if (withStats(opts) && p.stats && tracking.fields.stats) {
        const t = opts.stats.filter((k) => p.stats[k] !== undefined).map((k) => `${STAT_NAMES[k]} ${Math.round(p.stats[k])}`).join(', ');
        if (t) parts.push(t);
    }
    if (withEmotions(opts) && tracking.fields.stats && Number.isFinite(p.excitement)) parts.push(`excitement (emotional) ${Math.round(p.excitement)}`);
    if (simsFull(opts) && tracking.fields.money && opts.s.modules.sims.showMoney && p.money !== undefined && p.money !== null) {
        parts.push(`money ${formatMoney(p.money, opts.currency)}`);
    }
    if (opts.on.relations && tracking.fields.relations && p.role !== 'user' && typeof p.aff === 'number') {
        parts.push(`affinity→${opts.userName}: ${Math.round(p.aff)}${p.rel ? ` (${p.rel})` : ''}`);
    }
    if (tracking.fields.mood && p.mood && p.role !== 'user') parts.push(`mood: ${p.mood}`);
    if (simsFull(opts) && tracking.fields.profile && opts.s.modules.sims.birthdays !== false && p.profile?.birthdayGenerated) {
        parts.push('birthday auto');
    }
    if (tracking.fields.outfit && p.outfit) parts.push(`outfit: ${p.outfit}`);
    return `- ${p.name} [${p.role}]: ${parts.join(' · ') || '—'}`;
}

export function collectWarnings(state, opts) {
    const out = [];
    if (!withStats(opts)) return out;
    const lowMoney = lowMoneyThreshold(opts);
    for (const p of scenePeople(state)) {
        const tracking = trackingFor(p, opts.s);
        if (tracking.fields.stats && p.stats) {
            for (const k of opts.stats) {
                const def = STAT_DEFS[k] ?? {};
                const v = p.stats[k];
                if (v === undefined) continue;
                const low = k === 'hygiene' ? v < 25 : k === 'food' ? v <= 20 : k === 'energy' ? v <= 15 : def.critLow !== undefined && v < def.critLow;
                const high = k === 'arousal' ? v >= 85 : def.critHigh !== undefined && v >= def.critHigh;
                if (!low && !high) continue;
                const critical = (k === 'food' || k === 'energy') && v <= 0;
                const text = critical ? `${WARNINGS[k]}; истощение — возможны слабость, головокружение или обморок, если это обосновано сценой` : WARNINGS[k];
                out.push({ id: p.id, name: p.name, stat: k, value: v, text, critical });
            }
        }
        if (lowMoney !== null && tracking.fields.money && opts.s.modules.sims.showMoney
            && p.money !== undefined && p.money !== null && toNumber(p.money) < lowMoney) {
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
    if (head) lines.push(`Now: ${head}`);
    if (!(simsFull(opts) || opts.on.relations)) return lines;

    const people = Object.values(state.people ?? {});
    const scene = new Set(state.scene ?? []);
    const shown = sortPeople(people.filter((p) => trackingFor(p, opts.s).detail !== 'off' && (isMain(p, opts) || scene.has(p.id))));
    for (const p of shown) lines.push(personLine(p, opts));
    const absent = people.filter((p) => trackingFor(p, opts.s).detail !== 'off' && !shown.includes(p)).map((p) => p.name);
    if (absent.length) lines.push(`Known people not in the scene: ${absent.slice(-12).join(', ')}.`);

    const warnings = collectWarnings(state, opts);
    if (warnings.length) {
        lines.push(`Needs to show naturally (private numbers other characters cannot read): ${warnings.map((w) => `${w.name} — ${w.text}`).join('; ')}.`);
        lines.push('Only observable signs can be noticed; reactions fit proximity and personality (a glance, a discreet offer or nothing), without shaming, panic or melodrama. Zero food/energy may cause faintness when plausible, not an automatic collapse. Do not decide the user’s actions, feelings or loss of consciousness.');
    }
    if (simsFull(opts)) lines.push(...birthdayLines(state, opts));
    return lines;
}

// ---------------------------------------------------------------- инструкция

/** Нужны ли в запросе люди (полный Пульс или отношения). */
export function needPeople(request, opts) {
    return (request.has('sims') && simsFull(opts)) || request.has('relations');
}

/** Нужно ли попросить у модели валюту этого чата. */
const askCurrency = (request, opts) => request.has('sims') && simsFull(opts) && opts.s.modules.sims.showMoney && opts.currencyUnknown === true;

export function schema(state, request, opts) {
    const C = opts.charName || 'Character';
    const U = opts.userName || 'User';
    const out = { date: 'DD.MM.YYYY', time: 'HH:MM', weather: '…', location: '…' };
    if (!needPeople(request, opts)) return out;

    const full = request.has('sims') && simsFull(opts);
    const stats = full && withStats(opts);
    const emotions = full && withEmotions(opts);
    const rel = request.has('relations');
    const reasons = withReasons(opts);
    const deltas = () => ({
        ...(stats ? Object.fromEntries(opts.stats.map((k) => [k, 0])) : {}),
        ...(emotions ? { excitement: 0 } : {}),
    });
    // Пример причин: одна потребность и отношение — модель повторяет формат, не заполняя всё подряд.
    const reasonExample = (person) => {
        const keys = [...(person.d ? [Object.keys(person.d)[0]] : []), ...(typeof person.aff === 'number' ? ['aff'] : [])];
        if (reasons && keys.length) person.reasons = Object.fromEntries(keys.map((k) => [k, '…']));
    };

    const char = { name: C, role: 'char' };
    if (full) char.mood = '…';
    char.outfit = '…';
    if (full || (rel && opts.s.modules.relations.thoughts)) char.thought = '…';
    if (stats || emotions) char.d = deltas();
    if (rel) Object.assign(char, { aff: 0, rel: '…' });
    reasonExample(char);

    const user = { name: U, role: 'user', outfit: '…' };
    if (stats || emotions) user.d = deltas();
    if ((full || rel) && userThoughts(opts)) user.thought = '…';
    reasonExample(user);
    out.people = [char, user];

    const npcMax = Number(opts.s.modules.sims.npcMax) || 0;
    if (npcMax > 0) {
        const npc = { name: 'NPC name', role: 'npc', outfit: '…' };
        if (full) npc.mood = '…';
        if (full && trackingFor(npc, opts.s).detail === 'full') {
            npc.thought = '…';
            if (stats || emotions) npc.d = deltas();
        } else if (rel && opts.s.modules.relations.npc && opts.s.modules.relations.thoughts) {
            npc.thought = '…';
        }
        if (rel && opts.s.modules.relations.npc) Object.assign(npc, { aff: 0, rel: '…' });
        reasonExample(npc);
        out.people.push(npc);
    }
    out.people = out.people.filter((p) => {
        const tracking = trackingFor(p, opts.s);
        if (tracking.detail === 'off') return false;
        if (p.d && !tracking.fields.stats) delete p.d;
        if (!tracking.fields.mood) delete p.mood;
        if (!tracking.fields.outfit) delete p.outfit;
        if (!tracking.fields.thought) delete p.thought;
        if (!tracking.fields.relations) { delete p.aff; delete p.rel; }
        if (p.reasons) {
            for (const k of Object.keys(p.reasons)) if (k === 'aff' ? p.aff === undefined : !p.d) delete p.reasons[k];
            if (!Object.keys(p.reasons).length) delete p.reasons;
        }
        return true;
    });
    if (full && opts.s.modules.sims.showMoney) out.money = [{ who: C, amount: -450, note: 'кофе' }];
    if (askCurrency(request, opts)) out.currency = '…';
    return out;
}

export function rules(state, request, opts) {
    const C = opts.charName || 'Character';
    const U = opts.userName || 'User';
    const r = [];
    r.push(...trackingRules(opts.s, opts));
    r.push('- date/time: the story moment at the END of this reply; time only moves forward and fits events. A new day needs a new date. weather: short. location: short name, reuse the exact name while the scene stays there.');
    if (!needPeople(request, opts)) return r;

    const full = request.has('sims') && simsFull(opts);
    const stats = full && withStats(opts);
    const emotions = full && withEmotions(opts);
    const rel = request.has('relations');
    const npcMax = Number(opts.s.modules.sims.npcMax) || 0;
    const group = groupNames(opts);
    const main = group.length ? `the group characters (${group.join(', ')}) who are present, all with role "char"` : C;
    r.push(`- people: only those physically present — ${main}, then ${U}, then ${npcMax > 0 ? `up to ${npcMax} key NPC(s)` : 'no NPCs'}.`);
    if (stats) {
        r.push(`- d: change caused ONLY by events of this reply (meal food +40…60, snack +15, workout energy −20 and hygiene −20); passive change over time is applied by the system. set: absolute value only for full resets (full night's sleep {"energy":90}, shower {"hygiene":100}, orgasm {"arousal":0}).`);
        r.push('- arousal is SEXUAL arousal only (UI label «Страсть»): sexual attraction or touch raises it; discomfort, distraction or satisfaction lower it; never add it by habit. Under 85 it does not steer behaviour; at 85+ only subtle fitting cues, never implied consent.');
    }
    if (emotions) {
        r.push('- excitement (UI label «Воодушевление») is EMOTIONAL energy: joy, anticipation, nerves, азарт, adrenaline (d.excitement, or set.excitement:0 when calm). Ordinary joy or adrenaline is never d.arousal, and excitement implies nothing sexual; never move numbers between the two.');
    }
    if (withReasons(opts) && (stats || emotions || rel)) {
        r.push(`- reasons: for every nonzero d/set value${rel ? ' and every nonzero aff' : ''}, a brief factual cause from this reply under the same key, e.g. {"d":{"food":25},${rel ? '"aff":2,' : ''}"reasons":{"food":"съел сэндвич"${rel ? ',"aff":"она за него заступилась"' : ''}}}. Never invent a cause.`);
    }
    r.push(`- ${full ? 'mood: 1–3 words. ' : ''}outfit: the COMPLETE currently worn visible outfit — on partial changes keep what stays on, drop what came off, add what was put on; say so if undressed.`);
    if (full || (rel && opts.s.modules.relations.thoughts)) {
        r.push(`- thought: one hidden first-person sentence (real motive, true reaction to ${U}), never said aloud.`);
    }
    if (userThoughts(opts)) {
        r.push(`- ${U}: outfit${stats ? ', d/set' : ''} and thought. The user enabled their inner monologue: this covers the private thought field only, never their spoken lines, actions or consent.`);
    } else {
        r.push(`- ${U}: only outfit${stats ? ' and d/set' : ''}; never invent ${U}'s mood, thoughts or feelings.`);
    }
    if (rel) {
        const step = Number(opts.s.modules.relations.maxStep) || 5;
        r.push(`- aff: CHANGE in this person's feelings toward ${U} from THIS reply — usually 0, small ±1…3, strong events up to ±${step}; never the total. rel: short relationship label (незнакомец, коллега, друг, соперник…), repeat unless it changed.${opts.s.modules.relations.npc ? '' : ' NPCs: no aff/rel.'}`);
    }
    if (full && npcMax > 0) r.push('- NPCs on short tracking: no stats, money, profile or thought.');
    if (full && opts.s.modules.sims.showMoney) {
        r.push('- money: only actual spending (negative) or income (positive) in this reply, realistic prices; never balances.');
        if (askCurrency(request, opts)) r.push('- currency: the symbol or short name of the money used in this story (₽, $, €, ¥, зол.…).');
    }
    const newFields = [];
    if (stats) newFields.push(`"stats":${JSON.stringify(Object.fromEntries(opts.stats.map((k) => [k, DEFAULT_STAT[k]])))}`);
    if (full && opts.s.modules.sims.showMoney) newFields.push('"money":15000');
    if (full && opts.s.modules.sims.showProfile) newFields.push('"birthday":"DD.MM[.YYYY] only from canon","zodiac":"…","mbti":"INTJ — коротко"');
    if (rel) newFields.push('"aff":0');
    if (newFields.length) {
        r.push(`- A person NOT in the state gets "new": {${newFields.join(',')}} with fitting values${rel ? ` (aff = starting attitude to ${U}, −100…100)` : ''}. Never "new" for known people.`);
    }
    if (full && opts.s.modules.sims.birthdays !== false) {
        r.push('- birthday: keep canonical dates; if unknown omit it (the system picks a stable day). For a person marked "birthday auto" you may send a top-level "birthday" ONLY when canon states it.');
    }
    return r;
}

// ---------------------------------------------------------------- пересчёт

/** Совпадение по словам: «Кира» ⊂ «Бариста Кира», но «Анна Смирнова» ≠ «Анна Петрова». */
function tokensMatch(a, b) {
    const x = a.split(' ').filter(Boolean);
    const y = b.split(' ').filter(Boolean);
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    return short.length > 0 && short.every((t) => long.includes(t));
}

/**
 * Ищет человека по имени. Неоднозначное короткое имя («Анна» при двух Аннах) не угадывается.
 * @returns {{ person: object|null, ambiguous: boolean }}
 */
export function resolvePerson(people, name, role, scene = []) {
    const list = Object.values(people ?? {});
    if (role === 'user') return { person: list.find((p) => p.role === 'user') ?? null, ambiguous: false };
    const n = normName(name);
    if (!n) return { person: null, ambiguous: false };
    const others = list.filter((p) => p.role !== 'user');
    const inScene = new Set(scene);
    const pick = (found) => {
        if (found.length <= 1) return { person: found[0] ?? null, ambiguous: false };
        const here = found.filter((p) => inScene.has(p.id));
        return here.length === 1 ? { person: here[0], ambiguous: false } : { person: null, ambiguous: true };
    };
    const exact = others.filter((p) => normName(p.name) === n);
    if (exact.length) return pick(exact);
    return pick(others.filter((p) => tokensMatch(normName(p.name), n)));
}

function findPerson(people, name, role, scene) {
    return resolvePerson(people, name, role, scene).person;
}

export function findPersonByName(state, name, opts) {
    if (!state?.people || !name) return null;
    const isUser = normName(name) === normName(opts.userName) || /^(user|юзер|\{\{user\}\})$/i.test(String(name).trim());
    return findPerson(state.people, name, isUser ? 'user' : 'char', state.scene);
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

/** Сцена: дата, время, погода, место и пассивный спад потребностей. */
export function applyScene(next, base, data, opts) {
    next.date = str(data.date, 20) || base?.date || '';
    next.time = str(data.time, 10) || base?.time || '';
    next.weather = str(data.weather, 80) || base?.weather || '';
    next.location = str(data.location, 120) || base?.location || '';

    const before = parseDateTime(base?.date, base?.time);
    let after = parseDateTime(next.date, next.time);
    if (before && after && after.getTime() < before.getTime() - 60000) {
        const back = (before.getTime() - after.getTime()) / 60000;
        if (next.date === base.date && back >= NEXT_DAY_GAP_MINUTES) {
            // 23:30 → 00:15 без смены даты: модель забыла перелистнуть день.
            after = new Date(after.getTime() + 24 * 60 * 60000);
            next.date = formatStamp(after).split(' ')[0];
            next.issues.push('после полуночи дата не сменилась — поставлен следующий день');
        } else {
            next.date = base.date;
            next.time = base.time;
            after = before;
            next.issues.push('время ушло назад — оставлено прежнее');
        }
    }
    const elapsed = before && after ? Math.max(0, (after.getTime() - before.getTime()) / 60000) : 0;
    next.elapsed = Math.round(elapsed);

    const decayMinutes = Math.min(elapsed, MAX_DECAY_MINUTES);
    const excitementRate = Math.abs(toNumber(opts.s.modules.sims.excitementDecay, -15));
    for (const p of Object.values(next.people)) {
        p.changes = {};
        p._old = p.stats ? { ...p.stats } : null;
        p._oldAff = typeof p.aff === 'number' ? p.aff : null;
        p._oldExcitement = Number.isFinite(p.excitement) ? p.excitement : null;
        const tracking = trackingFor(p, opts.s);
        if (tracking.detail === 'off') continue;
        for (const k of tracking.fields.stats && p.stats && withStats(opts) ? opts.stats : []) {
            if (p.stats[k] === undefined) continue;
            const rate = toNumber(opts.decay[k], 0);
            const previous = p.stats[k];
            if (k === 'arousal') {
                // Время никогда не повышает страсть: высокое значение лишь утихает до спокойного уровня.
                p.stats[k] = clamp(Math.max(Math.min(p.stats[k], DEFAULT_STAT.arousal), p.stats[k] - Math.abs(rate) * decayMinutes / 120), 0, 100);
            } else {
                p.stats[k] = clamp(p.stats[k] + rate * decayMinutes / 120, 0, 100);
            }
            recordChange(p, k, 'time', previous, p.stats[k], k === 'arousal'
                ? `Страсть постепенно утихает за ${decayMinutes} мин игрового времени`
                : `Прошло ${decayMinutes} мин игрового времени; скорость ${rate} за 2 ч`);
        }
        if (withEmotions(opts) && tracking.fields.stats && Number.isFinite(p.excitement)) {
            const previous = p.excitement;
            p.excitement = clamp(p.excitement - excitementRate * decayMinutes / 120, 0, 100);
            recordChange(p, 'excitement', 'time', previous, p.excitement, `Эмоции стихают за ${decayMinutes} мин игрового времени`);
        }
    }
}

/** Люди, их потребности, деньги, симпатия. */
export function applyPeople(next, base, data, request, opts) {
    const full = request.has('sims') && simsFull(opts);
    const stats = full && withStats(opts);
    const emotions = full && withEmotions(opts);
    const rel = request.has('relations');
    const relNpc = rel && opts.s.modules.relations.npc;
    const step = Number(opts.s.modules.relations.maxStep) || 5;
    const npcMax = Number(opts.s.modules.sims.npcMax) || 0;
    const lastScene = base?.scene ?? [];
    const group = groupNames(opts).map(normName);

    for (const p of Object.values(next.people)) {
        p.diff = {};
        p.affDiff = 0;
        const tracking = trackingFor(p, opts.s);
        if ((p.role === 'user' && !userThoughts(opts))
            || (tracking.fields.thought && (full || (rel && opts.s.modules.relations.thoughts)))) p.thought = '';
        if (full && tracking.fields.profile) ensureBirthday(p, opts);
    }
    next.scene = [];
    next.tx = [];

    const roleOf = (entry) => {
        let role = String(entry.role ?? '').toLowerCase();
        if (!['char', 'user', 'npc'].includes(role)) role = 'npc';
        const name = normName(entry.name);
        if (role !== 'user' && name === normName(opts.userName)) role = 'user';
        if (role === 'npc' && group.includes(name)) role = 'char';
        return role;
    };

    let entries = Array.isArray(data.people) ? data.people : [];
    const pinnedName = normName(opts.s.tracking?.pinnedNpc);
    if (pinnedName && npcMax > 0) {
        // Закреплённый NPC, который есть в этом ответе, получает место в лимите NPC первым.
        const npcEntry = (entry) => {
            if (!entry || typeof entry !== 'object') return false;
            const role = roleOf(entry);
            if (role === 'user') return false;
            return (findPerson(next.people, str(entry.name, 60), role, lastScene)?.role ?? role) === 'npc';
        };
        const isPinned = (entry) => normName(entry.name) === pinnedName
            || normName(findPerson(next.people, entry.name, 'npc', lastScene)?.name) === pinnedName;
        const npcs = entries.filter(npcEntry);
        if (npcs.some(isPinned)) {
            const ordered = [...npcs.filter(isPinned), ...npcs.filter((entry) => !isPinned(entry))];
            let index = 0;
            entries = entries.map((entry) => (npcEntry(entry) ? ordered[index++] : entry));
        }
    }
    let npcCount = 0;
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const role = roleOf(entry);
        const name = str(entry.name, 60) || (role === 'user' ? opts.userName : '');
        if (!name) continue;

        const found = resolvePerson(next.people, name, role, lastScene);
        if (found.ambiguous) {
            next.issues.push(`имя «${name}» подходит нескольким людям — запись пропущена`);
            continue;
        }
        let person = found.person;
        const tracking = trackingFor(person ?? { name, role }, opts.s);
        if (tracking.detail === 'off') continue;
        const trackStats = tracking.fields.stats;
        const isNew = entry.new && typeof entry.new === 'object' ? entry.new : {};
        let created = false;
        if (!person) {
            created = true;
            if (role === 'npc' && npcCount >= npcMax) continue;
            const id = makeId(next.people, role === 'user' ? opts.userName : name, role);
            const st = trackStats && withStats(opts)
                ? { ...Object.fromEntries(opts.stats.map((k) => [k, DEFAULT_STAT[k]])), ...readStats(isNew.stats, opts.stats) }
                : null;
            person = {
                id,
                name: role === 'user' ? (opts.userName || name) : name,
                role,
                stats: st ? Object.fromEntries(Object.entries(st).map(([k, v]) => [k, clamp(v, 0, 100)])) : null,
                money: tracking.fields.money && isNew.money !== undefined ? toNumber(isNew.money, null) : null,
                profile: tracking.fields.profile ? { birthday: birthdayParts(isNew.birthday) ? str(isNew.birthday, 20) : '', zodiac: str(isNew.zodiac, 20), mbti: str(isNew.mbti, 60) } : {},
                mood: '', outfit: '', thought: '', diff: {}, affDiff: 0,
                excitement: emotions && trackStats ? clamp(toNumber(isNew.excitement, 0), 0, 100) : 0,
                changes: {},
                _old: null, _oldAff: null,
            };
            for (const [k, v] of Object.entries(person.stats ?? {})) {
                recordChange(person, k, 'initial', null, v, isNew.stats?.[k] !== undefined ? 'Начальное значение от модели' : 'Начальное значение по умолчанию');
            }
            if (emotions && trackStats) recordChange(person, 'excitement', 'initial', null, person.excitement, isNew.excitement !== undefined ? 'Начальное значение от модели' : 'Начальное значение по умолчанию');
            if (person.money !== null) recordChange(person, 'money', 'initial', null, person.money, 'Начальный баланс от модели');
            if (tracking.fields.relations && role !== 'user' && (rel || isNew.aff !== undefined)) {
                const start = toNumber(isNew.aff ?? entry.aff_start, NaN);
                person.aff = Number.isFinite(start) ? clamp(start, -100, 100) : 0;
                recordChange(person, 'aff', 'initial', null, person.aff, entry.reasons?.aff ? str(entry.reasons.aff, 240) : 'Начальное отношение');
            }
            next.people[person.id] = person;
        } else {
            // Знакомый человек: профиль только дополняем, ничего не перезаписываем.
            person.profile ??= {};
            for (const f of tracking.fields.profile ? ['zodiac', 'mbti'] : []) {
                if (!person.profile[f] && isNew[f]) person.profile[f] = str(isNew[f], 60);
            }
            if (tracking.fields.money && (person.money === null || person.money === undefined) && isNew.money !== undefined) {
                person.money = toNumber(isNew.money, null);
                recordChange(person, 'money', 'initial', null, person.money, 'Начальный баланс от модели');
            }
            if (stats && trackStats && !person.stats) {
                person.stats = Object.fromEntries(opts.stats.map((k) => [k, DEFAULT_STAT[k]]));
                Object.assign(person.stats, readStats(isNew.stats, opts.stats));
                for (const [k, v] of Object.entries(person.stats)) {
                    person.stats[k] = clamp(v, 0, 100);
                    recordChange(person, k, 'initial', null, person.stats[k], isNew.stats?.[k] !== undefined ? 'Начальное значение от модели' : 'Начальное значение по умолчанию');
                }
            }
            if (rel && tracking.fields.relations && person.role !== 'user' && typeof person.aff !== 'number') {
                const start = toNumber(isNew.aff, NaN);
                person.aff = Number.isFinite(start) ? clamp(start, -100, 100) : 0;
                recordChange(person, 'aff', 'initial', null, person.aff, 'Начальное отношение');
            }
        }
        if (person.role === 'npc') {
            if (npcCount >= npcMax) continue;
            npcCount++;
        }
        if (person.role === 'npc' && role === 'char') person.role = 'char';
        if (full && tracking.fields.profile) ensureBirthday(person, opts, isNew.birthday ?? entry.birthday);
        if (emotions && trackStats && !Number.isFinite(person.excitement)) {
            person.excitement = 0;
            recordChange(person, 'excitement', 'initial', null, 0, 'Начальное значение по умолчанию');
        }

        if (full && tracking.fields.mood && person.role !== 'user') person.mood = str(entry.mood, 60) || person.mood || '';
        if (tracking.fields.outfit) person.outfit = str(entry.outfit, 500) || person.outfit || '';
        if (tracking.fields.thought && person.role !== 'user' && (full || (rel && opts.s.modules.relations.thoughts))) person.thought = str(entry.thought, 500);
        if (tracking.fields.thought && person.role === 'user' && userThoughts(opts) && (full || rel)) person.thought = str(entry.thought, 500);

        if (stats && trackStats && person.stats) {
            for (const [k, v] of Object.entries(readStats(entry.set, opts.stats))) {
                const previous = person.stats[k];
                person.stats[k] = clamp(v, 0, 100);
                recordChange(person, k, 'event', previous, person.stats[k], eventReason(entry, k));
            }
            for (const [k, v] of Object.entries(readStats(entry.d ?? entry.delta, opts.stats))) {
                if (person.stats[k] === undefined) continue;
                const previous = person.stats[k];
                person.stats[k] = clamp(person.stats[k] + clamp(v, -100, 100), 0, 100);
                recordChange(person, k, 'event', previous, person.stats[k], eventReason(entry, k));
            }
        }
        if (emotions && trackStats) {
            const emotionSet = readStats(entry.set, ['excitement']);
            const emotionDelta = readStats(entry.d ?? entry.delta, ['excitement']);
            if (emotionSet.excitement !== undefined) {
                const previous = toNumber(person.excitement, 0);
                person.excitement = clamp(emotionSet.excitement, 0, 100);
                recordChange(person, 'excitement', 'event', previous, person.excitement, eventReason(entry, 'excitement'));
            }
            if (emotionDelta.excitement !== undefined) {
                const previous = toNumber(person.excitement, 0);
                person.excitement = clamp(previous + clamp(emotionDelta.excitement, -100, 100), 0, 100);
                recordChange(person, 'excitement', 'event', previous, person.excitement, eventReason(entry, 'excitement'));
            }
        }
        if (rel && tracking.fields.relations && person.role !== 'user' && (person.role === 'char' || relNpc)) {
            if (typeof person.aff !== 'number') person.aff = 0;
            // У нового человека aff в «new» — стартовое значение, а не изменение.
            if (!created) {
                const previous = person.aff;
                person.aff = clamp(person.aff + clamp(toNumber(entry.aff, 0), -step, step), -100, 100);
                recordChange(person, 'aff', 'event', previous, person.aff, eventReason(entry, 'aff'));
            }
            const label = str(entry.rel, 40);
            if (label) person.rel = label;
        }
        if (!next.scene.includes(person.id)) next.scene.push(person.id);
    }

    // Если модель забыла главных героев — оставляем их в сцене прошлого блока.
    for (const id of lastScene) {
        const p = next.people[id];
        if (p && trackingFor(p, opts.s).detail !== 'off' && isMain(p, opts) && !next.scene.includes(id)) {
            // В групповом чате отсутствующий участник действительно может уйти из сцены.
            if (group.length && p.role === 'char' && normName(p.name) !== normName(opts.charName)) continue;
            next.scene.push(id);
        }
    }

    // Деньги: только транзакции, баланс считает код.
    if (full && opts.s.modules.sims.showMoney) {
        for (const tx of Array.isArray(data.money) ? data.money : []) {
            if (!tx || typeof tx !== 'object') continue;
            const amount = toNumber(tx.amount, NaN);
            if (!Number.isFinite(amount) || amount === 0) continue;
            const person = findPersonByName(next, str(tx.who, 60), opts);
            if (!person) continue;
            const tracking = trackingFor(person, opts.s);
            if (tracking.detail === 'off' || !tracking.fields.money) continue;
            const previous = toNumber(person.money, 0);
            person.money = previous + amount;
            const note = str(tx.note, 80);
            recordChange(person, 'money', 'event', previous, person.money, note || 'Транзакция в сцене (модель не уточнила причину)');
            next.tx.push({ who: person.name, id: person.id, amount, note });
        }
    }
}

/** Дробный спад копится между короткими ответами; стрелки показывают целые изменения. */
export function finishPeople(next) {
    for (const p of Object.values(next.people ?? {})) {
        if (p.stats) {
            for (const k of Object.keys(p.stats)) {
                p.stats[k] = Math.round(p.stats[k] * 10000) / 10000;
                if (p._old && p._old[k] !== undefined) p.diff[k] = Math.round(p.stats[k]) - Math.round(p._old[k]);
            }
        }
        if (typeof p.aff === 'number') {
            p.aff = Math.round(p.aff);
            p.affDiff = p._oldAff === null || p._oldAff === undefined ? 0 : p.aff - Math.round(p._oldAff);
        }
        if (Number.isFinite(p.excitement)) {
            p.excitement = Math.round(p.excitement * 10000) / 10000;
            p.excitementDiff = p._oldExcitement === null || p._oldExcitement === undefined ? 0 : Math.round(p.excitement) - Math.round(p._oldExcitement);
        }
        delete p._old;
        delete p._oldAff;
        delete p._oldExcitement;
    }
}

