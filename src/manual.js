// Ручные правки «Пульса»: валидируем поля и сохраняем их с текущим свайпом.
import { getData, getMessage, setData } from './store.js';
import { birthdayParts } from './core/people.js';

const STATS = new Set(['food', 'hygiene', 'energy', 'arousal']);
const TEXT = new Set(['mood', 'outfit', 'thought', 'profile.birthday', 'profile.zodiac', 'profile.mbti']);
export const PULSE_FIELDS = Object.freeze({
    food: 'Сытость', hygiene: 'Гигиена', energy: 'Бодрость', arousal: 'Страсть',
    excitement: 'Воодушевление', money: 'Деньги', mood: 'Настроение', outfit: 'Одежда', thought: 'Мысли',
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

// ---------------------------------------------------------------- редактор всего блока

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const ROLES = ['char', 'user', 'npc'];

/**
 * Проверяет JSON из редактора блока. Числа приводятся к допустимым границам,
 * явные ошибки структуры возвращаются списком — сохранять такое состояние нельзя.
 * @returns {{ state: object|null, errors: string[] }}
 */
export function validateState(value) {
    const errors = [];
    if (!isObject(value)) return { state: null, errors: ['Нужен объект в фигурных скобках { … }, как в исходном блоке.'] };
    const state = structuredClone(value);
    for (const key of ['date', 'time', 'weather', 'location']) {
        if (state[key] !== undefined && state[key] !== null && typeof state[key] !== 'string') errors.push(`«${key}» должно быть текстом в кавычках.`);
    }
    if (typeof state.date === 'string' && state.date && !/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(state.date.trim())) errors.push('Дата — в виде ДД.ММ.ГГГГ.');
    if (typeof state.time === 'string' && state.time && !/^\d{1,2}[:.]\d{2}$/.test(state.time.trim())) errors.push('Время — в виде ЧЧ:ММ.');

    if (!isObject(state.people)) {
        errors.push('«people» должен быть объектом: { "id": { "name": …, "role": … } }.');
    } else {
        for (const [id, p] of Object.entries(state.people)) {
            const where = `people → «${id}»`;
            if (!isObject(p)) { errors.push(`${where}: нужен объект.`); continue; }
            if (p.id === undefined) p.id = id;
            if (p.id !== id) errors.push(`${where}: поле id («${p.id}») должно совпадать с ключом.`);
            if (typeof p.name !== 'string' || !p.name.trim()) errors.push(`${where}: нет имени (name).`);
            if (!ROLES.includes(p.role)) errors.push(`${where}: role — "char", "user" или "npc".`);
            if (p.stats !== undefined && p.stats !== null) {
                if (!isObject(p.stats)) errors.push(`${where}: stats должен быть объектом чисел.`);
                else for (const [k, v] of Object.entries(p.stats)) {
                    const n = Number(v);
                    if (!Number.isFinite(n)) errors.push(`${where}: stats.${k} — не число.`);
                    else p.stats[k] = Math.min(100, Math.max(0, n));
                }
            }
            for (const [key, min, max] of [['excitement', 0, 100], ['aff', -100, 100]]) {
                if (p[key] === undefined || p[key] === null) continue;
                const n = Number(p[key]);
                if (!Number.isFinite(n)) errors.push(`${where}: ${key} — не число.`);
                else p[key] = Math.min(max, Math.max(min, n));
            }
            if (p.money !== undefined && p.money !== null) {
                const n = Number(p.money);
                if (!Number.isFinite(n)) errors.push(`${where}: money — число без пробелов и валюты.`);
                else p.money = n;
            }
            for (const key of ['mood', 'outfit', 'thought', 'rel']) {
                if (p[key] !== undefined && p[key] !== null && typeof p[key] !== 'string') errors.push(`${where}: ${key} должно быть текстом.`);
            }
            if (p.profile !== undefined && !isObject(p.profile)) errors.push(`${where}: profile должен быть объектом.`);
        }
    }
    if (state.scene !== undefined) {
        if (!Array.isArray(state.scene)) errors.push('«scene» — список id: ["id1", "id2"].');
        else if (isObject(state.people)) {
            const unknown = state.scene.filter((id) => !Object.hasOwn(state.people, id));
            if (unknown.length) errors.push(`В scene есть неизвестные id: ${unknown.join(', ')}.`);
        }
    }
    if (state.marks !== undefined && (!Array.isArray(state.marks) || state.marks.some((m) => !isObject(m) || !m.id || !m.kind))) {
        errors.push('«marks» — список следов, у каждого есть id и kind.');
    }
    if (state.pockets !== undefined) {
        if (!isObject(state.pockets)) errors.push('«pockets» — объект { "id человека": [вещи] }.');
        else for (const [who, items] of Object.entries(state.pockets)) {
            if (!Array.isArray(items) || items.some((i) => !isObject(i) || !i.id || typeof i.name !== 'string')) errors.push(`pockets → «${who}»: список вещей, у каждой есть id и name.`);
        }
    }
    if (state.world !== undefined && state.world !== null && !isObject(state.world)) errors.push('«world» должен быть объектом.');
    if (state.slow !== undefined && state.slow !== null) {
        if (!isObject(state.slow) || !Number.isFinite(Number(state.slow.points))) errors.push('«slow» — объект с числом points.');
        else state.slow.points = Math.min(100, Math.max(0, Number(state.slow.points)));
    }
    return { state: errors.length ? null : state, errors };
}
