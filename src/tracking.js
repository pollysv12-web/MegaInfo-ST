// One policy for what to request from the model and what to show for a person.
import { normName } from './util.js';

export const TRACKING_FIELDS = Object.freeze({
    stats: 'Состояние: потребности, возбуждение и страсть', mood: 'Настроение', outfit: 'Одежда',
    thought: 'Мысли', money: 'Деньги', profile: 'Профиль', relations: 'Отношения', pocket: 'Кармашек',
});
export const TRACKING_DETAILS = Object.freeze(['full', 'short', 'off']);

const defaults = (detail) => Object.fromEntries(Object.keys(TRACKING_FIELDS).map(k => [k,
    detail === 'full' || (detail === 'short' && ['mood', 'outfit', 'relations'].includes(k)),
]));

/** Per-name overrides never change the person's identity or persisted state. */
export function trackingFor(person, settings) {
    const cfg = settings?.tracking ?? {};
    const role = ['char', 'user', 'npc'].includes(person?.role) ? person.role : 'npc';
    const key = normName(person?.name ?? person?.id);
    const pinned = role === 'npc' && !!key && key === normName(cfg.pinnedNpc);
    const roleDetail = cfg.roles?.[role] ?? (role === 'npc' ? 'short' : 'full');
    const saved = Object.hasOwn(cfg.overrides ?? {}, key) ? cfg.overrides[key]
        : Object.hasOwn(cfg.overrides ?? {}, person?.id) ? cfg.overrides[person.id] : {};
    const override = saved && typeof saved === 'object' ? saved : {};
    const detail = TRACKING_DETAILS.includes(override.detail) ? override.detail
        : pinned ? 'full' : TRACKING_DETAILS.includes(roleDetail) ? roleDetail : 'short';
    const fields = defaults(detail);
    for (const field of Object.keys(fields)) {
        if (typeof override.fields?.[field] === 'boolean') fields[field] = override.fields[field];
        if (detail === 'off') fields[field] = false;
    }
    return { detail, fields };
}

export function trackingRules(settings, names = {}) {
    const cfg = settings?.tracking;
    if (!cfg) return [];
    const lines = ['- Track people according to these preferences; omitted fields keep their stored values. "short" means mood, outfit, and relationships only; "off" means do not request updates for that person. Never invent a person merely because they are tracked.'];
    for (const [role, label] of [['char', 'main bot'], ['user', 'user'], ['npc', 'other NPCs']]) {
        lines.push(`- Tracking for ${label}: ${trackingFor({ role }, settings).detail}.`);
    }
    if (String(cfg.pinnedNpc ?? '').trim()) lines.push(`- Important pinned NPC: ${String(cfg.pinnedNpc).slice(0, 100)}. Track fully when relevant to the scene; keep other NPCs brief. A pinned name does not make an absent person present.`);
    for (const [name, override] of Object.entries(cfg.overrides ?? {}).slice(0, 30)) {
        const role = name === normName(names.charName) ? 'char' : name === normName(names.userName) ? 'user'
            : ['char', 'user', 'npc'].includes(override?.role) ? override.role : 'npc';
        const policy = trackingFor({ name, role }, settings);
        lines.push(`- Tracking override for ${name}: ${policy.detail}; fields to update: ${Object.entries(policy.fields).filter(([, on]) => on).map(([field]) => field).join(', ') || 'none'}.`);
    }
    return lines;
}

export function setTrackingOverride(settings, name, override) {
    const key = normName(name);
    if (!key || key.length > 100) return false;
    settings.tracking ??= { roles: { char: 'full', user: 'full', npc: 'short' }, pinnedNpc: '', overrides: {} };
    settings.tracking.overrides ??= {};
    if (override === null) delete settings.tracking.overrides[key];
    else Object.defineProperty(settings.tracking.overrides, key, { value: structuredClone(override), writable: true, enumerable: true, configurable: true });
    return true;
}
