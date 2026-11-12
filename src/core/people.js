// Сцена (дата, время, погода, место) + люди: статы sims, деньги, профиль, одежда, мысли, симпатия.
// Главная идея: модель сообщает СОБЫТИЯ (что поели, сколько потратили, насколько потеплело отношение),
// а все числа считает код. Поэтому статы не скачут, деньги сходятся, симпатия меняется плавно.

import { STAT_DEFS } from '../settings.js';
import { trackingFor, trackingRules } from '../tracking.js';
import { eventReason, recordChange } from './changes.js';
import {
    clamp, deepClone, formatMoney, normName, parseDateTime, str, toNumber, weekday,
} from '../util.js';

const MAX_DECAY_MINUTES = 7 * 24 * 60;
export const DEFAULT_STAT = { food: 70, hygiene: 80, energy: 70, arousal: 10 };

const STAT_NAMES = { food: 'сытость', hygiene: 'гигиена', energy: 'бодрость', arousal: 'страсть (сексуальное возбуждение)' };
const WARNINGS = {
    food: 'сильный голод: рассеянность, урчание живота или поиск еды могут быть заметны',
    hygiene: 'гигиена ниже 25: запах, несвежая кожа или одежда могут быть заметны вблизи',
    energy: 'сильная усталость: зевота, замедленные реакции, клонит в сон',
    arousal: 'высокое сексуальное возбуждение: возможны сдержанные телесные реакции, но желание не равно действию или согласию',
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
const withEmotions = (opts) => simsFull(opts) && opts.s.modules.sims.excitement !== false;
const userThoughts = (opts) => opts.s.modules.sims.userThoughts === true
    && (!opts.on.relations || opts.s.modules.relations.thoughts !== false);

/** A real calendar date; a missing year is intentional, so no age is invented. */
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

/** The same person keeps the same fallback birthday through reloads and swipes. */
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
        lines.push(`TODAY is ${p.name}'s birthday in the story. Close friends or family may already know and acknowledge it naturally; strangers know only if told. Respect the scene and each character's personality; no compulsory party, gifts, or omniscient announcements.`);
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
    if (simsFull(opts) && tracking.fields.money && opts.s.modules.sims.showMoney && p.money !== undefined && p.money !== null) {
        parts.push(`деньги ${formatMoney(p.money, opts.s.modules.sims.currency)}`);
    }
    if (opts.on.relations && tracking.fields.relations && p.role !== 'user' && typeof p.aff === 'number') {
        parts.push(`affinity→${opts.userName}: ${Math.round(p.aff)}${p.rel ? ` (${p.rel})` : ''}`);
    }
    if (tracking.fields.mood && p.mood && p.role !== 'user') parts.push(`настроение: ${p.mood}`);
    if (withEmotions(opts) && tracking.fields.stats && Number.isFinite(p.excitement)) parts.push(`возбуждение (эмоциональное, НЕ сексуальное): ${Math.round(p.excitement)}`);
    if (simsFull(opts) && tracking.fields.profile && opts.s.modules.sims.birthdays !== false && birthdayParts(p.profile?.birthday)) {
        parts.push(`день рождения: ${p.profile.birthday}${p.profile.birthdayGenerated ? ' (автоматическая дата; канон может уточнить)' : ''}`);
    }
    if (tracking.fields.outfit && p.outfit) parts.push(`одежда: ${p.outfit}`);
    return `- ${p.name} [${p.role}]: ${parts.join(' · ') || '—'}`;
}

export function collectWarnings(state, opts) {
    const out = [];
    if (!withStats(opts)) return out;
    for (const p of scenePeople(state)) {
        const tracking = trackingFor(p, opts.s);
        if (!tracking.fields.stats) continue;
        if (!p.stats) continue;
        for (const k of opts.stats) {
            const def = STAT_DEFS[k] ?? {};
            const v = p.stats[k];
            if (v === undefined) continue;
            const low = k === 'hygiene' ? v < 25 : k === 'food' ? v <= 20 : k === 'energy' ? v <= 15 : def.critLow !== undefined && v < def.critLow;
            const high = k === 'arousal' ? v >= 85 : def.critHigh !== undefined && v >= def.critHigh;
            if (low || high) {
                const critical = (k === 'food' || k === 'energy') && v <= 0;
                const text = critical
                    ? `${WARNINGS[k]}; критическое истощение — возможны слабость, головокружение или обморок, если это обосновано длительностью и событиями сцены`
                    : WARNINGS[k];
                out.push({ id: p.id, name: p.name, stat: k, value: v, text, critical });
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
    const shown = sortPeople(people.filter((p) => trackingFor(p, opts.s).detail !== 'off' && (p.role === 'char' || p.role === 'user' || scene.has(p.id))));
    for (const p of shown) lines.push(personLine(p, opts));
    const absent = people.filter((p) => trackingFor(p, opts.s).detail !== 'off' && !shown.includes(p)).map((p) => p.name);
    if (absent.length) lines.push(`Known NPCs not in the scene: ${absent.slice(-12).join(', ')}.`);

    const warnings = collectWarnings(state, opts);
    if (warnings.length) {
        lines.push('Needs to reflect naturally in behaviour, without melodrama (these numbers are private state, not something other characters can read): '
            + warnings.map((w) => `${w.name} — ${w.text}`).join('; ') + '.');
        lines.push('Only observable signs can be noticed. Reactions must fit proximity and personality: a discreet offer, a glance, a pause, or no comment. No compulsory shaming, interrogation, panic, sexual action or consent. Low food/energy can cause faintness when plausible, not an automatic collapse from a percentage. Do not decide the user’s actions, thoughts, feelings or loss of consciousness unless their established roleplay permissions allow it. Ordinary excitement, joy, competitiveness or adrenaline are NOT sexual arousal; only sexual arousal at 85+ may subtly influence behaviour.');
    }
    if (simsFull(opts)) lines.push(...birthdayLines(state, opts));
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
    const emotions = full && withEmotions(opts);
    const rel = request.has('relations');
    const zero = Object.fromEntries(opts.stats.map((k) => [k, 0]));
    const char = { name: C, role: 'char' };
    if (full) Object.assign(char, { mood: '…' });
    char.outfit = '…';
    if (full || (rel && opts.s.modules.relations.thoughts)) char.thought = '…';
    if (stats || emotions) char.d = { ...(stats ? zero : {}), ...(emotions ? { excitement: 0 } : {}) };
    if (stats || emotions) char.reasons = Object.fromEntries(Object.keys(char.d).map(k => [k, '…']));
    if (rel) Object.assign(char, { aff: 0, rel: '…' });

    const user = { name: U, role: 'user', outfit: '…' };
    if (stats || emotions) user.d = { ...(stats ? zero : {}), ...(emotions ? { excitement: 0 } : {}) };
    if (stats || emotions) user.reasons = Object.fromEntries(Object.keys(user.d).map(k => [k, '…']));
    if ((full || rel) && userThoughts(opts)) user.thought = '…';
    out.people = [char, user];

    const npcMax = Number(opts.s.modules.sims.npcMax) || 0;
    if (npcMax > 0) {
        const npc = { name: 'Имя NPC', role: 'npc', outfit: '…' };
        if (full) npc.mood = '…';
        if (full && trackingFor(npc, opts.s).detail === 'full') {
            npc.thought = '…';
            if (stats || emotions) npc.d = { ...(stats ? zero : {}), ...(emotions ? { excitement: 0 } : {}) };
        } else if (rel && opts.s.modules.relations.npc && opts.s.modules.relations.thoughts) {
            npc.thought = '…';
        }
        if (rel && opts.s.modules.relations.npc) Object.assign(npc, { aff: 0, rel: '…' });
        out.people.push(npc);
    }
    out.people = out.people.filter((p) => {
        const tracking = trackingFor(p, opts.s);
        if (tracking.detail === 'off') return false;
        if (p.d) {
            if (!tracking.fields.stats) for (const key of opts.stats) { delete p.d[key]; if (p.reasons) delete p.reasons[key]; }
            if (!tracking.fields.stats) { delete p.d.excitement; if (p.reasons) delete p.reasons.excitement; }
            if (!Object.keys(p.d).length) delete p.d;
        }
        if (!tracking.fields.mood) delete p.mood;
        if (!tracking.fields.outfit) delete p.outfit;
        if (!tracking.fields.thought) delete p.thought;
        if (!tracking.fields.relations) { delete p.aff; delete p.rel; }
        return true;
    });
    if (full && opts.s.modules.sims.showMoney) out.money = [{ who: C, amount: -450, note: 'кофе' }];
    return out;
}

export function rules(state, request, opts) {
    const C = opts.charName || 'Character';
    const U = opts.userName || 'User';
    const r = [];
    r.push(...trackingRules(opts.s, opts));
    r.push('- date/time: the in-story moment at the END of this reply. Time only moves forward and matches events (a conversation ≈ minutes, sleep ≈ hours). Day of week is computed by the system.');
    r.push('- weather: short. location: short place name; reuse EXACTLY the same name while the scene stays there.');
    if (!needPeople(request, opts)) return r;

    const full = request.has('sims') && simsFull(opts);
    const stats = full && withStats(opts);
    const emotions = full && withEmotions(opts);
    const rel = request.has('relations');
    const npcMax = Number(opts.s.modules.sims.npcMax) || 0;
    r.push(`- people: everyone physically present in the scene: ${C} first, then ${U}, then ${npcMax > 0 ? `at most ${npcMax} most important NPC(s)` : 'NO NPCs'}. Skip people who are absent.`);
    if (stats) {
        r.push(`- Stats are 0–100: ${opts.stats.map((k) => `${k} = ${STAT_NAMES[k]}`).join(', ')}.`);
        r.push('- d: change caused ONLY by events of this reply (full meal food +40…+60, snack +15, workout energy −20 and hygiene −20). 0 if nothing happened. Passive change over time is applied by the system — never include it.');
        r.push('- reasons: for every nonzero d or set field, supply a brief factual reason under the same key, e.g. {"d":{"food":25},"reasons":{"food":"съел сэндвич"}}. Explain only events in this reply, never invent a cause. The system records passive time effects separately. Optional reasons.aff explains an attitude change.');
        r.push('- set: absolute value ONLY for full resets: woke up after a full night of sleep → {"energy":90}; shower/bath → {"hygiene":100}; orgasm → {"arousal":0}. Example: {"name":"…","role":"char","set":{"hygiene":100}}.');
        r.push('- arousal is SEXUAL arousal only (UI label «Страсть»). Ordinary joy, nervous energy, competition and adrenaline change the separate emotional field d.excitement (0 if none), never d.arousal. Actual sexual attraction/touch can raise arousal; loss of interest, discomfort, distraction or satisfaction can LOWER it. Never add arousal every scene by habit. The system passively lets it settle. Arousal below 85 does not steer behaviour; at 85+ express only context-appropriate subtle cues, never forced sexual behaviour or implied consent.');
        r.push('- Low needs have proportionate observable effects: hygiene below 25, food at 20 or less, energy at 15 or less. Other people react only to visible signs and in character, without repetitive announcements, disgust or melodrama. At zero food/energy, faintness or fainting is possible only if story circumstances support it; respect the user’s control over their character.');
    }
    if (emotions) r.push('- excitement (UI label «Возбуждение») is a separate 0–100 EMOTIONAL activation value, outside stats: joy, anticipation, nerves, азарт. Use d.excitement for event changes or set.excitement:0 when fully calmed; explain with reasons.excitement. It is NOT sexual attraction and does not require sexual behaviour. Sexual excitement remains only stats.arousal / «Страсть»; never move existing arousal numbers to excitement.');
    if (full) r.push('- mood: 1–3 words. outfit: short but concrete (what is visible).');
    else r.push('- outfit: short but concrete (what is visible).');
    r.push('- outfit is the COMPLETE currently worn visible outfit, updated even for partial changes: remove the jacket if taken off, retain the shirt/trousers, add the scarf if put on. Read the scene and the previous outfit; do not replace the whole outfit with just the changed item or keep removed garments. If fully undressed, say so explicitly. Clothing from wardrobe/image context is valid starting context, not a reason to ignore later changes in the story.');
    if (full || (rel && opts.s.modules.relations.thoughts)) {
        r.push(`- thought: one sentence of hidden inner monologue in first person — secret motives, real reaction to ${U}. Never said aloud.`);
    }
    if (userThoughts(opts)) {
        r.push(`- ${U}: outfit${stats ? ', d/set' : ''} and thought are allowed. The user explicitly enabled their inner monologue in the status block; keep it consistent with their persona and the scene. This permission applies to the private thought field only, not to inventing their spoken lines, actions or consent in the story.`);
    } else {
        r.push(`- ${U}: only outfit${stats ? ' and d/set' : ''}. Never invent ${U}'s mood, thoughts or feelings.`);
    }
    if (rel) {
        const step = Number(opts.s.modules.relations.maxStep) || 5;
        r.push(`- aff: CHANGE of this person's feelings toward ${U} caused by THIS reply. Usually 0; small things ±1…3; only strong events up to ±${step}. Never output the total — the system keeps it.`);
        r.push(`- rel: short name of their relationship with ${U} (e.g. «незнакомец», «коллега», «соперник», «друг», «влюблён(а)»). Repeat the current one unless it really changed.`);
        if (!opts.s.modules.relations.npc) r.push('- NPC: no aff/rel.');
    }
    if (full && npcMax > 0) r.push('- NPCs tracked as short: no stats, money, profile, or private thought. A pinned or individually fully tracked NPC may supply the configured fields.');
    if (full && opts.s.modules.sims.showMoney) {
        r.push('- money: only actual spending (negative) or income (positive) in this reply, realistic prices. [] if none. Never output balances — the system keeps them.');
    }
    const newFields = [];
    if (stats) newFields.push(`"stats":${JSON.stringify(Object.fromEntries(opts.stats.map((k) => [k, DEFAULT_STAT[k]])))}`);
    if (full && opts.s.modules.sims.showMoney) newFields.push('"money":15000');
    if (full && opts.s.modules.sims.showProfile) newFields.push('"birthday":"DD.MM or DD.MM.YYYY only if known from canon","zodiac":"…","mbti":"INTJ — короткое описание"');
    if (rel) newFields.push('"aff":0');
    if (newFields.length) {
        r.push(`- A person NOT listed in the current state gets "new": {${newFields.join(',')}} with values that fit them${rel ? ' (aff = starting attitude to ' + U + ', −100…100)' : ''}. Never send "new" for people already in the state.`);
    }
    if (full && opts.s.modules.sims.birthdays !== false) {
        r.push('- Preserve canonical birthdays from character/persona context. If unknown, omit birthday: the system assigns one stable day/month without inventing an age. An existing person whose date is marked automatic or missing MAY send a top-level birthday field (e.g. {"name":"…","role":"char","birthday":"02.06.1997"}) to replace that fallback ONLY with an explicitly known canonical date. Do not use new for this correction; never replace an established canonical birthday or invent a correction.');
        r.push('- Birthdays affect the story only on the matching in-story date: close people may remember naturally; strangers do not magically know. Merely seeing a profile date is not a reason to bring it up. On other dates, no forthcoming-birthday hints, countdowns, “your birthday is tomorrow” reminders or forced pre-celebration.');
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
                // Legacy positive rates must never create attraction from the passage of time.
                // Rest settles elevated arousal toward a quiet baseline without raising low values.
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
            p.excitement = clamp(p.excitement - 15 * decayMinutes / 120, 0, 100);
            recordChange(p, 'excitement', 'time', previous, p.excitement, `Эмоциональное возбуждение стихает за ${decayMinutes} мин игрового времени`);
        }
    }
}

/** Люди, их статы, деньги, симпатия. */
export function applyPeople(next, base, data, request, opts) {
    const full = request.has('sims') && simsFull(opts);
    const stats = full && withStats(opts);
    const emotions = full && withEmotions(opts);
    const rel = request.has('relations');
    const relNpc = rel && opts.s.modules.relations.npc;
    const step = Number(opts.s.modules.relations.maxStep) || 5;
    const npcMax = Number(opts.s.modules.sims.npcMax) || 0;

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

    let entries = Array.isArray(data.people) ? data.people : [];
    const pinnedName = normName(opts.s.tracking?.pinnedNpc);
    if (pinnedName && npcMax > 0) {
        // Reserve the existing NPC budget for a pinned person who is actually
        // present in this update. Reorder NPC slots only: bot/user entries keep
        // their positions, and an absent pin never manufactures a new person.
        const npcEntry = (entry) => {
            if (!entry || typeof entry !== 'object') return false;
            let role = String(entry.role ?? '').toLowerCase();
            if (!['char', 'user', 'npc'].includes(role)) role = 'npc';
            const name = str(entry.name, 60);
            if (role !== 'user' && normName(name) === normName(opts.userName)) return false;
            return (findPerson(next.people, name, role)?.role ?? role) === 'npc';
        };
        const isPinned = (entry) => normName(entry.name) === pinnedName
            || normName(findPerson(next.people, entry.name, 'npc')?.name) === pinnedName;
        const npcs = entries.filter(npcEntry);
        if (npcs.some(isPinned)) {
            const ordered = [...npcs.filter(isPinned), ...npcs.filter(entry => !isPinned(entry))];
            let index = 0;
            entries = entries.map(entry => npcEntry(entry) ? ordered[index++] : entry);
        }
    }
    let npcCount = 0;
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        let role = String(entry.role ?? '').toLowerCase();
        if (!['char', 'user', 'npc'].includes(role)) role = 'npc';
        const name = str(entry.name, 60) || (role === 'user' ? opts.userName : '');
        if (!name) continue;
        if (role !== 'user' && normName(name) === normName(opts.userName)) role = 'user';

        let person = findPerson(next.people, name, role);
        const tracking = trackingFor(person ?? { name, role }, opts.s);
        if (tracking.detail === 'off') continue;
        const trackStats = tracking.fields.stats;
        const trackEmotions = tracking.fields.stats;
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
                excitement: emotions && trackEmotions ? clamp(toNumber(isNew.excitement, 0), 0, 100) : 0,
                changes: {},
                _old: null, _oldAff: null,
            };
            for (const [k, v] of Object.entries(person.stats ?? {})) {
                recordChange(person, k, 'initial', null, v, isNew.stats?.[k] !== undefined ? 'Начальное значение от модели' : 'Начальное значение по умолчанию');
            }
            if (emotions && trackEmotions) recordChange(person, 'excitement', 'initial', null, person.excitement, isNew.excitement !== undefined ? 'Начальное эмоциональное возбуждение от модели' : 'Начальное эмоциональное возбуждение по умолчанию');
            if (person.money !== null) recordChange(person, 'money', 'initial', null, person.money, 'Начальный баланс от модели');
            if (tracking.fields.relations && role !== 'user' && (rel || isNew.aff !== undefined)) {
                const start = toNumber(isNew.aff ?? entry.aff_start, NaN);
                person.aff = Number.isFinite(start) ? clamp(start, -100, 100) : 0;
                recordChange(person, 'aff', 'initial', null, person.aff, 'Начальное отношение');
            }
            next.people[person.id] = person;
        } else {
            // Уже знакомый человек: профиль только дополняем, ничего не перезаписываем.
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
        if (emotions && trackEmotions && !Number.isFinite(person.excitement)) {
            person.excitement = 0;
            recordChange(person, 'excitement', 'initial', null, 0, 'Начальное эмоциональное возбуждение по умолчанию');
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
        if (emotions && trackEmotions) {
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
            // у нового человека aff в "new" — стартовое значение, а не изменение
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

    // Если модель забыла кого-то из главных — оставляем их в сцене прошлого блока.
    for (const id of base?.scene ?? []) {
        const p = next.people[id];
        if (p && trackingFor(p, opts.s).detail !== 'off' && (p.role === 'char' || p.role === 'user') && !next.scene.includes(id)) next.scene.push(id);
    }

    // Деньги: только транзакции, баланс считает код
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

/** Keep fractional decay between short turns; only the displayed arrows are integral. */
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

export { deepClone };
