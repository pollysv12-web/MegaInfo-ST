// Ручные правки «Пульса»: валидируем поля и сохраняем их с текущим свайпом.
import { getData, getMessage, setData } from './store.js';
import { birthdayParts } from './core/people.js';

const STATS = new Set(['food', 'hygiene', 'energy', 'arousal']);
const TEXT = new Set(['mood', 'outfit', 'thought', 'profile.birthday', 'profile.zodiac', 'profile.mbti']);
export const PULSE_FIELDS = Object.freeze({
    food: 'Сытость', hygiene: 'Гигиена', energy: 'Бодрость', arousal: 'Страсть',
    excitement: 'Возбуждение', money: 'Деньги', mood: 'Настроение', outfit: 'Одежда', thought: 'Мысли',
    'profile.birthday': 'День рождения', 'profile.zodiac': 'Знак зодиака', 'profile.mbti': 'MBTI',
});

export function pulseValue(person, field) {
    if (STATS.has(field)) return person?.stats?.[field];
    if (field.startsWith('profile.') && Object.hasOwn(PULSE_FIELDS, field)) return person?.profile?.[field.slice(8)];
    return Object.hasOwn(PULSE_FIELDS, field) ? person?.[field] : undefined;
}

export function normalizePulseValue(field, value) {
    if (!Object.hasOwn(PULSE_FIELDS, field)) throw new Error('Это поле нельзя изменить');
    if (!TEXT.has(field)) {
        const text = String(value ?? '').trim().replace(',', '.');
        const n = Number(text);
        if (!text || !Number.isFinite(n)) throw new Error('Введите число');
        return field === 'money' ? Math.round(n * 100) / 100 : Math.min(100, Math.max(0, n));
    }
    const text = String(value ?? '').trim().slice(0, field === 'thought' ? 2000 : 500);
    if (field === 'profile.birthday' && text && !birthdayParts(text)) throw new Error('Дата: ДД.ММ или ДД.ММ.ГГГГ');
    return text;
}

/** Чистая функция; не меняет прежние состояния и соседние свайпы. */
export function patchPulse(state, personId, field, value) {
    const normalized = normalizePulseValue(field, value);
    if (!state?.people || !Object.hasOwn(state.people, personId) || ['__proto__', 'constructor', 'prototype'].includes(personId)) throw new Error('Персонаж не найден в этом ответе');
    const next = structuredClone(state);
    const person = next.people[personId];
    const before = pulseValue(person, field);
    if (STATS.has(field)) {
        person.stats ??= {};
        person.stats[field] = normalized;
        person.diff ??= {};
        person.diff[field] = Number.isFinite(before) ? normalized - before : 0;
    } else if (field.startsWith('profile.')) {
        person.profile ??= {};
        person.profile[field.slice(8)] = normalized;
        if (field === 'profile.birthday') delete person.profile.birthdayGenerated;
    } else person[field] = normalized;
    person.changes ??= {};
    person.changes[field] = [{ kind: 'manual', from: before ?? null, to: normalized,
        delta: typeof normalized === 'number' && Number.isFinite(before) ? normalized - before : null,
        reason: 'Исправлено вручную' }];
    if (field === 'excitement') person.excitementDiff = Number.isFinite(before) ? normalized - before : 0;
    return next;
}

/** Запоздавший отдельный запрос не должен затирать явную правку этого ответа. */
export function reapplyPulseEdits(message, state) {
    let result = state;
    for (const [personId, fields] of Object.entries(getData(message)?.manualPulse ?? {})) {
        for (const [field, value] of Object.entries(fields)) {
            if (result?.people?.[personId] && Object.hasOwn(PULSE_FIELDS, field)) result = patchPulse(result, personId, field, value);
        }
    }
    return result;
}

export function editPulseField(messageId, personId, field, value) {
    const message = getMessage(messageId);
    const data = getData(message);
    const normalized = normalizePulseValue(field, value);
    const next = patchPulse(data?.state, personId, field, normalized);
    const edits = structuredClone(data.manualPulse ?? {});
    edits[personId] ??= {};
    edits[personId][field] = normalized;
    setData(message, 'manualPulse', edits);
    setData(message, 'state', next);
    return true;
}
