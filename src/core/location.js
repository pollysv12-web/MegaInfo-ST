// Описание локации: пишется ОДИН раз, когда герои попадают в новое место, и хранится в чате.
// При возвращении в знакомое место описание берётся из памяти, модель его не переписывает.

import { normName, sameName, str } from '../util.js';

const DETAIL = {
    short: '1 sentence each',
    medium: '2–3 sentences each',
    long: '4–5 rich sentences each',
};

/** Ищет описание места по названию (точно или похоже). */
export function findPlace(places, name) {
    if (!places || !name) return null;
    const key = normName(name);
    if (places[key]) return places[key];
    return Object.values(places).find((p) => sameName(p.name, name)) ?? null;
}

export function stateLines(state, opts) {
    const lines = [];
    const names = Object.values(opts.places ?? {}).map((p) => p.name);
    const here = findPlace(opts.places, state?.location);
    if (here && opts.s.modules.location.remind) {
        lines.push(`Current place «${here.name}» (keep its look consistent): ${[here.look, here.details].filter(Boolean).join(' ').slice(0, 450)}`);
    }
    if (names.length) lines.push(`Already described places: ${names.slice(-25).join('; ')}.`);
    return lines;
}

export function schema() {
    return { place: { name: '…', look: '…', details: '…', mood: '…' } };
}

export function rules(state, opts) {
    const detail = DETAIL[opts.s.modules.location.detail] ?? DETAIL.medium;
    return [
        `- place: ONLY when at the END of this reply the scene is in a location that is NOT in "Already described places" (a new place). Then give {"name": exactly the same as "location", "look": what it looks like, "details": notable objects, layout and what can be done there, "mood": atmosphere, light, sounds, smells} — ${detail}. If the place is already described, OMIT "place" entirely.`,
    ];
}

/** Возвращает новое описание места (или null). */
export function extractPlace(data, state) {
    const p = data?.place;
    if (!p || typeof p !== 'object') return null;
    const name = str(p.name, 120) || state?.location;
    if (!name) return null;
    const look = str(p.look, 1200);
    const details = str(p.details ?? p.features, 1200);
    const mood = str(p.mood ?? p.atmosphere, 800);
    if (!look && !details && !mood) return null;
    return { name, look, details, mood };
}

/** Нужно ли описание места: локация есть, а описания для неё ещё нет. */
export function needsPlace(state, places) {
    return !!state?.location && !findPlace(places, state.location);
}
