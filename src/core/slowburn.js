// Шкала слоуберна: 10 стадий, очки 0–100. Модель сообщает только небольшой шаг (+1, +2, −1),
// код ограничивает скорость и не даёт перескочить больше одной стадии за игровой день.

import { clamp, str, toNumber } from '../util.js';

export const STAGES = [
    { at: 0, name: 'Незнакомцы', ru: 'вежливая дистанция, в лучшем случае лёгкое любопытство', now: 'polite distance, neutral curiosity at most', not: 'flirting, personal questions, touching' },
    { at: 6, name: 'Первое впечатление', ru: 'присматриваются друг к другу, запоминается какая-то деталь', now: 'noticing each other, sizing up, a memorable detail sticks', not: 'open interest, compliments with subtext' },
    { at: 14, name: 'Интерес', ru: 'любопытство, мелкие знаки внимания, украдкой брошенные взгляды', now: 'curiosity, small attentions, stolen glances, remembering little things', not: 'admitting attraction, deliberate touches' },
    { at: 24, name: 'Искра', ru: 'напряжённые моменты, подколки, влечение прячется за шутками', now: 'charged moments, teasing, awareness of attraction hidden behind banter', not: 'confessions, kisses, talking about feelings' },
    { at: 35, name: 'Отрицание', ru: 'отрицание чувств, отталкивание, вспышки ревности, мысли наедине', now: 'denial, pushing away, flickers of jealousy, overthinking alone', not: 'accepting the feelings, romantic gestures' },
    { at: 46, name: 'Притяжение', ru: 'ищут близости, случайные касания задерживаются, желание защитить', now: 'seeking proximity, accidental touches that linger, protectiveness', not: 'kissing, explicit flirting' },
    { at: 58, name: 'Уязвимость', ru: 'открываются, делятся секретами и страхами, появляется доверие', now: 'opening up, sharing secrets and fears, real trust forms', not: 'confession of love, kissing' },
    { at: 70, name: 'На грани', ru: 'почти-поцелуи, прерванные признания, невыносимое напряжение', now: 'almost-kiss moments, interrupted confessions, unbearable tension', not: 'actually completing the kiss or the confession (only almost)' },
    { at: 82, name: 'Признание', ru: 'возможны признание или первый поцелуй и их последствия', now: 'confession or a first kiss is now possible, dealing with consequences', not: 'rushing into sex or a full relationship' },
    { at: 92, name: 'Вместе', ru: 'сложившиеся отношения, близость растёт естественно', now: 'an established bond; intimacy can grow naturally', not: 'nothing is forbidden by the slowburn' },
];

export const SPEEDS = { glacial: 1, slow: 2, medium: 3, fast: 5 };

// Сила задаёт влияние на повествование, скорость — только предел изменения очков.
const INFLUENCE = {
    light: 'LIGHT: a quiet undertone when romance is relevant; plot and dialogue stay central.',
    medium: 'MEDIUM: let the stage show in dialogue, openness, distance and small choices — one fitting cue when relevant, not a checklist every reply.',
    strong: 'STRONG: the stage actively limits romantic dialogue, trust and choices; attraction grows through earned moments, hesitation instead of jumping ahead, while the plot still moves.',
};

const STAGE_GUIDANCE = [
    'Keep conversation situational; disclose little, respect personal space and offer practical help without romantic entitlement.',
    'Remember one concrete detail and ask a small situational question; curiosity is not immediate trust or desire.',
    'Seek an ordinary reason to talk again and notice habits. Keep personal disclosures modest; do not call curiosity love.',
    'Use subtext and character-specific humour; attraction can make a reply careful or a glance linger, without forcing contact.',
    'Let attraction and uncertainty coexist. Restraint may be quiet; do not manufacture cruelty, jealousy or an argument to demonstrate denial.',
    'Choose proximity or thoughtful practical care, while leaving room for a response. Desire does not imply readiness or consent.',
    'Let a specific small confidence or accepted help build trust. Vulnerability is voluntary and does not require a traumatic confession.',
    'A consequential pause or honest half-sentence can carry tension; avoid staging the same interrupted kiss over and over.',
    'An admission or first kiss becomes possible if the scene supports it and consent is clear. It is a possibility, not an obligation.',
    'Use familiarity, shared details, open communication and mutual care. An established relationship does not erase personality, boundaries or other goals.',
];

export function stageIndex(points) {
    let idx = 0;
    for (let i = 0; i < STAGES.length; i++) if (points >= STAGES[i].at) idx = i;
    return idx;
}

/** С кем идёт Slow burn. В групповом чате без явной цели — первый участник группы, а не тот, кто сейчас говорит. */
export function targetName(opts) {
    const group = Array.isArray(opts.group) ? opts.group.filter(Boolean) : [];
    return opts.s.modules.slowburn.target || group[0] || opts.charName || 'Character';
}

export function stateLines(state, opts) {
    const sb = state?.slow;
    const U = opts.userName || 'User';
    const T = targetName(opts);
    const points = sb ? sb.points : 0;
    const i = stageIndex(points);
    const st = STAGES[i];
    const next = STAGES[i + 1];
    const influence = opts.s.modules.slowburn.influence ?? 'medium';
    const lines = [`SLOWBURN ${T} ↔ ${U}: stage ${i + 1}/${STAGES.length} «${st.name}» (${Math.round(points)}/100${next ? `, next «${next.name}» at ${next.at}` : ''}). Fits now: ${st.now}.`];
    lines.push(`  Influence ${INFLUENCE[influence] ?? INFLUENCE.medium}${influence !== 'light' ? ` ${STAGE_GUIDANCE[i]}` : ''}`);
    if (opts.s.modules.slowburn.strict && next) lines.push(`  NOT yet: ${st.not}. Keep ${T}'s own choices within this stage even if ${U} initiates; answer in character without rewriting ${U}'s action.`);
    if (influence === 'strong') lines.push(`  Sexual arousal alone never unlocks a stage; show limits through natural dialogue and choices, not OOC notes or forced quarrels.`);
    const agency = opts.s.modules.sims?.userThoughts === true
        ? `${U}'s inner narration only within the user's explicit permissions; never assume reciprocal attraction or consent.`
        : `Guide only ${T}; never decide ${U}'s feelings, thoughts, consent or actions.`;
    lines.push(`  ${agency} Never show the scale in dialogue; intensity is not progress.`);
    if (sb?.moments?.length) lines.push(`  Key moments: ${sb.moments.slice(-4).map((m) => m.text).join('; ')}.`);
    return lines;
}

export function schema() {
    return { slowburn: { d: 0, moment: '' } };
}

export function rules(state, opts) {
    const max = SPEEDS[opts.s.modules.slowburn.speed] ?? 2;
    const U = opts.userName || 'User';
    return [
        `- slowburn.d: how much THIS reply moved the romance between ${targetName(opts)} and ${U}: usually 0 or +1, a truly meaningful moment up to +${max}, a quarrel or betrayal −1…−${max}. Only a real change in trust or connection counts — not arousal, routine flirting or a new message. slowburn.moment: a short phrase for a key moment (first touch, almost kiss…), else "".`,
    ];
}

export function apply(next, base, data, opts) {
    const cfg = opts.s.modules.slowburn;
    const max = SPEEDS[cfg.speed] ?? 2;
    const prev = base?.slow ?? { points: 0, moments: [], stageUpDate: '' };
    const sb = { points: clamp(toNumber(prev.points, 0), 0, 100), moments: [...(prev.moments ?? [])], stageUpDate: prev.stageUpDate ?? '', diff: 0 };
    const d = clamp(toNumber(data?.slowburn?.d, 0), -max, max);
    const oldStage = stageIndex(sb.points);
    let points = clamp(sb.points + d, 0, 100);
    const newStage = stageIndex(points);
    if (newStage > oldStage) {
        if (newStage > oldStage + 1) points = STAGES[oldStage + 1].at; // через стадию не прыгаем
        if (cfg.dayLock && sb.stageUpDate && sb.stageUpDate === next.date) {
            points = Math.min(points, STAGES[oldStage + 1].at - 1);
        } else if (stageIndex(points) > oldStage) {
            sb.stageUpDate = next.date || sb.stageUpDate;
        }
    }
    sb.diff = Math.round((points - sb.points) * 10) / 10;
    sb.points = points;
    const moment = str(data?.slowburn?.moment, 140);
    if (moment && !sb.moments.some((m) => m.text === moment && m.date === (next.date || ''))) sb.moments.push({ text: moment, date: next.date || '' });
    if (sb.moments.length > 20) sb.moments = sb.moments.slice(-20);
    next.slow = sb;
}
