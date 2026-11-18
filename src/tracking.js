// Единая политика: что просить у модели и что показывать для каждого человека.
import { normName } from './util.js';

export const TRACKING_FIELDS = Object.freeze({
    stats: 'Состояние: потребности, возбуждение и страсть', mood: 'Настроение', outfit: 'Одежда',
    thought: 'Мысли', money: 'Деньги', profile: 'Профиль', relations: 'Отношения', pocket: 'Кармашек',
});
export const TRACKING_DETAILS = Object.freeze(['full', 'short', 'off']);

const defaults = (detail) => Object.fromEntries(Object.keys(TRACKING_FIELDS).map(k => [k,
    detail === 'full' || (detail === 'short' && ['mood', 'outfit', 'relations'].includes(k)),
]));

/** Настройки для отдельного имени не меняют личность человека и сохранённые данные. */
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
    const role = (r) => trackingFor({ role: r }, settings).detail;
    const lines = [`- Tracking: main bot ${role('char')}, user ${role('user')}, other NPCs ${role('npc')} ("short" = mood, outfit, relationship; "off" = do not update). Omitted fields keep stored values; tracking never invents a person.`];
    if (String(cfg.pinnedNpc ?? '').trim()) lines.push(`- Important pinned NPC: ${String(cfg.pinnedNpc).slice(0, 100)} — track fully when present; a pinned name does not make an absent person present.`);
    for (const [name, override] of Object.entries(cfg.overrides ?? {}).slice(0, 30)) {
        const r = name === normName(names.charName) ? 'char' : name === normName(names.userName) ? 'user'
            : ['char', 'user', 'npc'].includes(override?.role) ? override.role : 'npc';
        const policy = trackingFor({ name, role: r }, settings);
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
    else settings.tracking.overrides[key] = structuredClone(override);
    return true;
}
