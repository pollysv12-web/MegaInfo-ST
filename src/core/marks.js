// Следы на теле: синяки, засосы, порезы, укусы, ожоги, шрамы, татуировки…
// Модель только сообщает, что появился новый след. Заживление считает код по времени ролевой,
// поэтому синяк не исчезает за одно сообщение и не висит вечно.

import { asArray, normName, str, toNumber, clamp, makeStamp, minutesBetween } from '../util.js';
import { findPersonByName } from './people.js';

const DAY = 24 * 60;

/** Сколько дней заживает след средней тяжести. 0 = не проходит сам. */
export const KINDS = {
    hickey: { label: 'засос', icon: 'fa-heart', days: 6, ru: ['засос', 'засосы', 'hickey', 'love bite'] },
    bruise: { label: 'синяк', icon: 'fa-circle', days: 10, ru: ['синяк', 'гематома', 'ушиб', 'bruise'] },
    scratch: { label: 'царапина', icon: 'fa-grip-lines', days: 4, ru: ['царапина', 'царапины', 'scratch'] },
    abrasion: { label: 'ссадина', icon: 'fa-burst', days: 7, ru: ['ссадина', 'abrasion', 'scrape'] },
    bite: { label: 'укус', icon: 'fa-tooth', days: 7, ru: ['укус', 'след зубов', 'bite'] },
    cut: { label: 'порез', icon: 'fa-slash', days: 10, ru: ['порез', 'cut'] },
    burn: { label: 'ожог', icon: 'fa-fire-flame-curved', days: 14, ru: ['ожог', 'burn'] },
    rope: { label: 'след от верёвки', icon: 'fa-link', days: 2, ru: ['след от верёвки', 'след от наручников', 'rope', 'restraint'] },
    wound: { label: 'рана', icon: 'fa-kit-medical', days: 21, ru: ['рана', 'ранение', 'wound', 'stab', 'gunshot'] },
    fracture: { label: 'перелом', icon: 'fa-bone', days: 49, ru: ['перелом', 'трещина', 'fracture', 'broken'] },
    sprain: { label: 'растяжение', icon: 'fa-person-walking', days: 12, ru: ['растяжение', 'вывих', 'sprain'] },
    scar: { label: 'шрам', icon: 'fa-wave-square', days: 0, ru: ['шрам', 'рубец', 'scar'] },
    tattoo: { label: 'татуировка', icon: 'fa-feather', days: 0, ru: ['татуировка', 'тату', 'tattoo'] },
    piercing: { label: 'пирсинг', icon: 'fa-ring', days: 0, ru: ['пирсинг', 'piercing'] },
    mark: { label: 'метка', icon: 'fa-star-of-life', days: 0, ru: ['метка', 'клеймо', 'печать', 'mark', 'brand', 'sigil'] },
    other: { label: 'след', icon: 'fa-circle-dot', days: 7, ru: [] },
};

const SEVERITY_FACTOR = { 1: 0.6, 2: 1, 3: 1.7 };
const SPEED_FACTOR = { fast: 0.5, realistic: 1, slow: 1.5 };

export function normalizeKind(kind) {
    const k = normName(kind);
    if (KINDS[k]) return k;
    for (const [key, def] of Object.entries(KINDS)) {
        if (def.ru.some((w) => k.includes(normName(w)))) return key;
    }
    return 'other';
}

/** Длительность заживления в минутах (0 = навсегда). */
export function healMinutes(mark, opts) {
    const def = KINDS[mark.kind] ?? KINDS.other;
    if (!def.days) return 0;
    const sev = SEVERITY_FACTOR[mark.sev] ?? 1;
    const speed = SPEED_FACTOR[opts.s.modules.marks.healing] ?? 1;
    return def.days * DAY * sev * speed;
}

/** Стадия следа на текущий момент. */
export function markStatus(mark, state, opts) {
    const total = healMinutes(mark, opts);
    const passed = Math.max(0, minutesBetween(mark.at, makeStamp(state?.date, state?.time)) ?? 0);
    if (!total) return { progress: 0, stage: mark.kind === 'scar' || mark.kind === 'tattoo' ? 'постоянный' : 'не проходит сам', permanent: true, passed, total };
    const progress = clamp(passed / total, 0, 1.01);
    let stage = 'свежий';
    if (progress >= 0.9) stage = 'почти незаметен';
    else if (progress >= 0.6) stage = 'бледнеет, заживает';
    else if (progress >= 0.25) stage = 'заметный';
    return { progress, stage, permanent: false, passed, total, left: Math.max(0, total - passed) };
}

const NOTICE_RULES = {
    subtle: 'People notice a visible mark only if it is obvious or they are close; minor marks (sev 1) at most get a glance or one casual remark — no drama, no interrogation, no fixation. Covered marks are invisible to others.',
    normal: 'People notice visible marks realistically: close friends or partners may ask once; strangers mostly ignore them. Covered marks are invisible to others.',
    dramatic: 'Visible marks draw attention and can trigger questions, gossip or jealousy, proportional to how striking they are. Covered marks are invisible to others.',
};

export function stateLines(state, opts) {
    const marks = state?.marks ?? [];
    if (!marks.length) return [];
    const lines = ['Marks on bodies (they heal over story time by themselves — keep them consistent, mention only when relevant):'];
    for (const m of marks.slice(-14)) {
        const st = markStatus(m, state, opts);
        const day = st.permanent ? st.stage : `${st.stage}, ~${Math.max(1, Math.round(st.left / DAY))} дн. до исчезновения`;
        lines.push(`  [${m.id}] ${m.who}: ${KINDS[m.kind]?.label ?? m.kind} — ${m.where}${m.note ? ` (${m.note})` : ''}; тяжесть ${m.sev}/3; ${day}.`);
    }
    lines.push(`  A mark is visible only where the current outfit does not cover that body part. ${NOTICE_RULES[opts.s.modules.marks.notice] ?? NOTICE_RULES.subtle}`);
    return lines;
}

export function schema() {
    return { marks: { add: [], heal: [] } };
}

export function rules(state, opts) {
    return [
        `- marks.add: ONLY new physical marks that appeared in THIS reply on anyone present: [{"who":"name","kind":"one of ${Object.keys(KINDS).join('/')}","where":"exact body spot","sev":1,"note":"cause, 2–4 words"}]. sev: 1 minor, 2 noticeable, 3 serious. Usually [].`,
        '- marks.heal: ids of marks removed early by treatment/magic/cover-up story event, e.g. ["m2"]. Usually []. Normal healing is computed by the system — never heal marks just because time passed.',
    ];
}

export function apply(next, base, data, opts) {
    let marks = [...(base?.marks ?? [])];
    let seq = base?.markSeq ?? 0;
    const d = data?.marks && typeof data.marks === 'object' ? data.marks : {};
    const heal = new Set(asArray(d.heal ?? d.remove).map((x) => String(x).trim().toLowerCase()));
    if (heal.size) marks = marks.filter((m) => !heal.has(m.id.toLowerCase()));

    const now = makeStamp(next.date, next.time);
    for (const a of asArray(d.add).slice(0, 6)) {
        if (!a || typeof a !== 'object') continue;
        const whoRaw = str(a.who, 60);
        const where = str(a.where, 80);
        if (!whoRaw || !where) continue;
        const person = findPersonByName(next, whoRaw, opts);
        const kind = normalizeKind(a.kind);
        const who = person?.name ?? whoRaw;
        // тот же след на том же месте второй раз не добавляем — освежаем его
        const same = marks.find((m) => m.kind === kind && normName(m.who) === normName(who) && normName(m.where) === normName(where));
        const sev = clamp(Math.round(toNumber(a.sev, 1)), 1, 3);
        if (same) {
            same.at = now || same.at;
            same.sev = Math.max(same.sev, sev);
            continue;
        }
        marks.push({ id: `m${++seq}`, who, whoId: person?.id ?? '', kind, where, sev, note: str(a.note, 60), at: now });
    }

    // зажившие убираем
    marks = marks.filter((m) => {
        const st = markStatus(m, next, opts);
        return st.permanent || st.progress < 1;
    });
    next.marks = marks;
    next.markSeq = seq;
}
