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
    gunshot: { label: 'пулевое ранение', icon: 'fa-kit-medical', days: 60, ru: ['пулевое', 'огнестрельное', 'gunshot', 'bullet wound'] },
    stab: { label: 'колотая рана', icon: 'fa-kit-medical', days: 35, ru: ['ножевая', 'ножевое', 'колотая', 'колотое', 'stab', 'knife wound'] },
    frostbite: { label: 'обморожение', icon: 'fa-snowflake', days: 28, ru: ['обморожение', 'frostbite'] },
    redness: { label: 'покраснение', icon: 'fa-circle', days: 0.25, ru: ['покраснение', 'раздражение', 'redness', 'irritation', 'flushed'] },
    paint: { label: 'краска на коже', icon: 'fa-palette', days: 1, ru: ['краска', 'окрашенная кожа', 'окрасилась кожа', 'окрашивание', 'paint', 'dye', 'stain'] },
    henna: { label: 'хна', icon: 'fa-feather', days: 14, ru: ['хна', 'хной', 'мехенди', 'henna', 'mehndi'] },
    tan: { label: 'загар', icon: 'fa-sun', days: 21, ru: ['загар', 'suntan', 'tan'] },
    rope: { label: 'след от верёвки', icon: 'fa-link', days: 2, ru: ['след от верёвки', 'след от наручников', 'rope', 'restraint'] },
    wound: { label: 'рана', icon: 'fa-kit-medical', days: 21, ru: ['рана', 'ранение', 'wound'] },
    fracture: { label: 'перелом', icon: 'fa-bone', days: 49, ru: ['перелом', 'трещина', 'fracture', 'broken'] },
    sprain: { label: 'растяжение', icon: 'fa-person-walking', days: 12, ru: ['растяжение', 'вывих', 'sprain'] },
    scar: { label: 'шрам', icon: 'fa-wave-square', days: 0, ru: ['шрам', 'рубец', 'scar'] },
    tattoo: { label: 'татуировка', icon: 'fa-feather', days: 28, retained: true, ru: ['татуировка', 'тату', 'tattoo'] },
    piercing: { label: 'пирсинг', icon: 'fa-ring', days: 90, retained: true, ru: ['пирсинг', 'прокол', 'piercing'] },
    mark: { label: 'метка', icon: 'fa-star-of-life', days: 0, ru: ['метка', 'клеймо', 'печать', 'mark', 'brand', 'sigil'] },
    other: { label: 'след', icon: 'fa-circle-dot', days: 7, ru: [] },
};

const SEVERITY_FACTOR = { 1: 0.6, 2: 1, 3: 1.7 };
const SPEED_FACTOR = { fast: 0.5, realistic: 1, slow: 1.5 };

const BODY_MODS = new Set(['tattoo', 'piercing']);
// Специфическое название проверяем до общих «рана», «ожог» или «тату».
const MATCH_ORDER = ['henna', 'gunshot', 'stab', 'frostbite', 'tan', 'paint', ...Object.keys(KINDS).filter((k) => !['henna', 'gunshot', 'stab', 'frostbite', 'tan', 'paint'].includes(k))];

/** Настройка относится к приобретённым тату/пирсингу, а не к следам травм. */
export function isTracked(mark, opts) {
    return !BODY_MODS.has(mark.kind) || opts.s.modules.marks.trackPermanent === true;
}

export function normalizeKind(kind) {
    const k = normName(kind);
    if (KINDS[k]) return k;
    for (const key of MATCH_ORDER) {
        if (KINDS[key].ru.some((w) => {
            const term = normName(w);
            // Короткое английское tan не должно совпадать со словом distant.
            return /^[a-z ]+$/.test(term) ? (` ${k} `).includes(` ${term} `) : k.includes(term);
        })) return key;
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
    if (!total) return { progress: 0, stage: mark.kind === 'scar' ? 'постоянный' : 'не проходит сам', permanent: true, passed, total };
    const progress = clamp(passed / total, 0, 1.01);
    const def = KINDS[mark.kind] ?? KINDS.other;
    if (def.retained && progress >= 1) {
        return { progress: 1, stage: mark.kind === 'tattoo' ? 'зажившая татуировка' : 'заживший прокол', permanent: true, passed, total, left: 0 };
    }
    let stage = 'свежий';
    if (['paint', 'henna', 'tan', 'redness'].includes(mark.kind)) {
        stage = progress >= 0.9 ? 'почти исчез' : progress >= 0.6 ? 'постепенно сходит' : progress >= 0.25 ? 'ещё заметен' : 'свежий';
    } else if (def.retained) {
        stage = progress >= 0.9 ? 'почти зажил' : progress >= 0.6 ? 'кожа восстанавливается' : progress >= 0.25 ? 'заживает' : 'свежий, чувствительная кожа';
    } else if (['gunshot', 'stab', 'fracture', 'sprain', 'frostbite', 'wound', 'burn'].includes(mark.kind)) {
        stage = progress >= 0.9 ? 'почти зажил' : progress >= 0.6 ? 'восстановление' : progress >= 0.25 ? 'заживает, требует осторожности' : 'свежая травма';
    } else if (progress >= 0.9) stage = 'почти незаметен';
    else if (progress >= 0.6) stage = 'бледнеет, заживает';
    else if (progress >= 0.25) stage = 'заметный';
    return { progress, stage, permanent: false, passed, total, left: Math.max(0, total - passed) };
}

const NOTICE_RULES = {
    subtle: 'Others notice only obvious marks up close; a minor one gets at most a glance or one casual remark.',
    normal: 'Close people may ask once about a visible mark; strangers mostly ignore it.',
    dramatic: 'Visible marks draw attention, questions, gossip or jealousy in proportion to how striking they are.',
};

export function stateLines(state, opts) {
    const marks = (state?.marks ?? []).filter((m) => isTracked(m, opts));
    if (!marks.length) return [];
    const lines = ['Marks on bodies (they heal by themselves over story time; mention only when relevant):'];
    for (const m of marks.slice(-14)) {
        const st = markStatus(m, state, opts);
        const remaining = st.left < DAY ? `~${Math.max(1, Math.ceil(st.left / 60))} h` : `~${Math.max(1, Math.ceil(st.left / DAY))} d`;
        const day = st.permanent ? st.stage : `${st.stage}, ${remaining} left`;
        lines.push(`  [${m.id}] ${m.who}: ${KINDS[m.kind]?.label ?? m.kind} — ${m.where}${m.note ? ` (${m.note})` : ''}; sev ${m.sev}/3; ${day}.`);
    }
    lines.push(`  A mark is visible only where the outfit does not cover it. ${NOTICE_RULES[opts.s.modules.marks.notice] ?? NOTICE_RULES.subtle} Serious injuries limit activity while healing.`);
    return lines;
}

export function schema() {
    return { marks: { add: [], heal: [] } };
}

export function rules(state, opts) {
    const permanent = opts.s.modules.marks.trackPermanent === true;
    const kinds = Object.keys(KINDS).filter((k) => permanent || !BODY_MODS.has(k)).join('/');
    return [
        `- marks.add: only NEW physical marks caused in THIS reply: [{"who":"name","kind":"${kinds}","where":"body spot","sev":1,"note":"cause"}] (sev 1 minor, 2 noticeable, 3 serious). Usually []. Never invent injuries, never add marks from a character description, no brief blushing. Same spot hurt again → add with "reinjured":true; otherwise never repeat a mark.`,
        '- marks.heal: ids cured early by an explicit story event (paint washed off, healing magic). Normal healing is computed by the system; bandages, makeup or clothes cure nothing.',
        permanent ? '- tattoo/piercing: only if acquired in THIS scene, with "acquired":true.' : '- Tattoos and piercings are not tracked.',
    ];
}

export function apply(next, base, data, opts) {
    let marks = (base?.marks ?? []).filter((m) => isTracked(m, opts)).map((m) => ({ ...m }));
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
        if (!isTracked({ kind }, opts)) continue;
        // Явно исходные особенности никогда не становятся новым событием.
        if (a.preexisting === true || a.initial === true || a.acquired === false || /^(initial|preexisting|background|character)$/i.test(String(a.origin ?? ''))) continue;
        if (BODY_MODS.has(kind) && a.acquired !== true) continue;
        const who = person?.name ?? whoRaw;
        // Повтор модели не должен делать синяк вечным или менять предыдущий свайп.
        const same = marks.find((m) => m.kind === kind && normName(m.who) === normName(who) && normName(m.where) === normName(where));
        const sev = clamp(Math.round(toNumber(a.sev, 1)), 1, 3);
        if (same) {
            if (a.reinjured === true) {
                same.at = now || same.at;
                same.sev = Math.max(same.sev, sev);
                same.note = str(a.note, 60) || same.note;
            }
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
