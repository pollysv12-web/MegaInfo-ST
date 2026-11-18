// Причины изменений относятся к одному ответу: код не выдумывает событие, которое модель не объяснила.
import { str } from '../util.js';

const precise = (n) => Math.round(n * 10000) / 10000;
/** Другие ключи, под которыми модели иногда присылают ту же причину. */
const ALIASES = { aff: ['aff', 'affinity', 'rel', 'relation', 'relations', 'симпатия', 'отношение'] };

export function eventReason(entry, field) {
    const reasons = entry?.reasons;
    const keys = ALIASES[field] ?? [field];
    let value = '';
    if (reasons && typeof reasons === 'object') value = keys.map((k) => reasons[k]).find((v) => typeof v === 'string' && v.trim()) ?? '';
    if (!value && typeof entry?.[`${field}_reason`] === 'string') value = entry[`${field}_reason`];
    return str(value, 240) || 'Изменение в сцене (модель не уточнила причину)';
}

/** Сохраняет фактическое изменение после ограничений, включая дробный спад. */
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
