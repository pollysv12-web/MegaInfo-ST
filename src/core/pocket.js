// Кармашек хранит лишь значимые предметы при человеке, а не полный инвентарь.
// Модель сообщает приобретение, передачу или потерю; пропущенный ключ ничего не очищает.

import { asArray, clamp, deepClone, normName, str } from '../util.js';
import { trackingFor } from '../tracking.js';

const PLACEHOLDER = /^(?:…|\.{3}|предмет|имя предмета|item)$/i;
export const pocketLimit = (opts) => Math.round(clamp(Number(opts.s.modules.pocket?.maxItems) || 5, 1, 20));
const config = (opts) => opts.s.modules.pocket ?? {};
const stamp = (state) => [state.date, state.time].filter(Boolean).join(' ');

/** Содержимое плюс момент получения: новая вещь отличается от прежней удалённой с тем же именем. */
export function collectionId(prefix, ...parts) {
    let hash = 2166136261;
    for (const ch of parts.join('|')) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0;
    return `${prefix}${hash.toString(36)}`;
}

/** Только точные имена: два NPC с одинаковым именем не должны меняться вещами. */
function owner(state, who, opts) {
    const raw = String(who ?? '').trim();
    const normalized = normName(raw);
    if (!normalized) return null;
    const people = Object.values(state.people ?? {});
    let role;
    if (/^(?:user|юзер|\{\{user\}\})$/i.test(raw) || normalized === normName(opts.userName)) role = 'user';
    else if (/^(?:char|бот|\{\{char\}\})$/i.test(raw) || normalized === normName(opts.charName)) role = 'char';
    // «char» — текущий персонаж: в групповом чате их несколько, поэтому ищем по имени.
    const target = role === 'char' && /^(?:char|бот|\{\{char\}\})$/i.test(raw) ? normName(opts.charName) : normalized;
    const found = role === 'user' ? people.find((p) => p.role === 'user')
        : people.find((p) => p.role !== 'user' && (p.id === raw || normName(p.name) === target));
    if (found) {
        const tracking = trackingFor(found, opts.s);
        return tracking.detail !== 'off' && tracking.fields.pocket ? found : null;
    }
    // Без Пульса кармашек всё равно знает главных героев; неизвестных NPC не придумывает.
    if (!role) return null;
    const name = str(role === 'user' ? opts.userName : opts.charName, 60);
    if (!name) return null;
    const tracking = trackingFor({ name, role }, opts.s);
    if (tracking.detail === 'off' || !tracking.fields.pocket) return null;
    const id = role === 'user' ? 'user' : normName(name);
    if (Object.hasOwn(state.people, id)) return state.people[id];
    const person = { id, name, role, stats: null, money: null, profile: {}, mood: '', outfit: '', thought: '', diff: {}, affDiff: 0, excitement: 0 };
    state.people[id] = person;
    if (!state.scene.includes(id)) state.scene.push(id);
    return person;
}

export function stateLines(state, opts) {
    const lines = [];
    for (const [who, items] of Object.entries(state?.pockets ?? {})) {
        const name = state.people?.[who]?.name;
        if (!name || !Array.isArray(items) || !items.length) continue;
        const tracking = trackingFor(state.people[who], opts.s);
        if (tracking.detail === 'off' || !tracking.fields.pocket) continue;
        lines.push(`Pocket of ${name} (significant possessions currently carried, not everything they own): ${items.slice(0, pocketLimit(opts)).map((x) => `[${x.id}] ${x.name}${x.note ? ' — ' + x.note : ''}`).join('; ')}.`);
    }
    return lines;
}

export function schema(_state, opts) {
    return config(opts).auto === false ? {} : { pocket: { add: [], drop: [], update: [] } };
}

export function rules(_state, opts) {
    if (config(opts).auto === false) return ['- Pockets are managed by the user. Do not change anyone’s possessions.'];
    return [
        `- pocket: up to ${pocketLimit(opts)} SIGNIFICANT items each tracked person carries right now (keys, a gift, letter, clue, weapon, keepsake, document). Never fill a quota, never list clothes or everyday trifles; zero is fine.`,
        '- pocket.add [{"who":"exact name","name":"item","note":"why it matters"}]: an important item established by the character or story, or just picked up/received. Not objects merely seen nearby.',
        '- pocket.drop [{"who":"exact name","id":"item id"}]: the item is no longer on them — put down and left, handed over, lost, used up, taken away. pocket.update [{"who","id","name?","note?"}]: its state changed. Transfer = drop + add.',
    ];
}

export function apply(next, base, data, opts) {
    next.people ??= {};
    next.scene ??= [];
    const existing = next.pockets ?? base?.pockets;
    const pockets = existing && typeof existing === 'object' && !Array.isArray(existing) ? deepClone(existing) : {};
    const limit = pocketLimit(opts);
    for (const key of Object.keys(pockets)) {
        if (!Array.isArray(pockets[key])) { delete pockets[key]; continue; }
        pockets[key] = pockets[key].filter((item) => item && typeof item === 'object' && str(item.name, 80)).slice(0, limit);
    }
    next.pockets = pockets;
    if (config(opts).auto === false) return;
    const d = data?.pocket;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    for (const change of asArray(d.drop).slice(0, 40)) {
        if (!change || typeof change !== 'object') continue;
        const p = owner(next, change.who, opts);
        if (!p) continue;
        const id = str(change.id, 100);
        if (id) pockets[p.id] = (pockets[p.id] ?? []).filter((item) => item.id !== id);
    }
    for (const change of asArray(d.update).slice(0, 40)) {
        if (!change || typeof change !== 'object') continue;
        const p = owner(next, change.who, opts);
        const item = p && (pockets[p.id] ?? []).find((x) => x.id === str(change.id, 100));
        if (!item) continue;
        const name = str(change.name, 80);
        if (name && !PLACEHOLDER.test(name)) item.name = name;
        if (typeof change.note === 'string') item.note = str(change.note, 220);
    }
    for (const change of asArray(d.add).slice(0, 40)) {
        if (!change || typeof change !== 'object') continue;
        const p = owner(next, change.who, opts);
        const name = str(change.name, 80);
        if (!p || !name || PLACEHOLDER.test(name)) continue;
        pockets[p.id] ??= [];
        const items = pockets[p.id];
        if (items.some((item) => normName(item.name) === normName(name)) || items.length >= limit) continue;
        const at = stamp(next);
        items.push({ id: collectionId('p', p.id, normName(name), at), name, note: str(change.note, 220), at });
    }
}
