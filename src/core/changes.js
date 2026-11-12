// Reasons belong to one calculated reply; do not infer an event the model did not explain.
import { str } from '../util.js';

const precise = (n) => Math.round(n * 10000) / 10000;

export function eventReason(entry, field) {
    const value = entry?.reasons?.[field];
    return (typeof value === 'string' ? str(value, 240) : '')
        || 'Изменение в сцене (модель не уточнила причину)';
}

/** Each number uses actual, clamped effects, including fractional passive decay. */
export function recordChange(person, field, kind, from, to, reason) {
    if (!Number.isFinite(to)) return;
    from = Number.isFinite(from) ? precise(from) : null;
    to = precise(to);
    const delta = from === null ? null : precise(to - from);
    if (delta === 0 && kind !== 'initial') return;
    person.changes ??= {};
    person.changes[field] ??= [];
    person.changes[field].push({ kind, from, to, delta, reason: str(reason, 240) });
}
