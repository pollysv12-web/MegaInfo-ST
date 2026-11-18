// Игровые наборы. Подключение, темы, свой CSS и данные чатов они не трогают.
import { DEFAULTS } from './settings.js';

const enabled = (keys) => Object.fromEntries(Object.keys(DEFAULTS.modules).map(k => [k, { enabled: keys.includes(k) }]));
const preset = (id, name, description, keys, tune = {}) => ({ id, name, description, modules: enabled(keys), tune });

export const PRESETS = Object.freeze([
    preset('everyday', 'Повседневность', 'Пульс, близкие люди, места, заметки и важные вещи; без постоянного нагнетания сюжета.', ['sims', 'relations', 'location', 'diary', 'pocket', 'phone'], {
        diary: { frequency: 'n', every: 3, length: 'medium' }, pocket: { auto: true, maxItems: 5 },
    }),
    preset('slow-romance', 'Медленный роман', 'Осторожное сближение: медленный Slow burn, небольшие шаги симпатии и личные заметки.', ['sims', 'relations', 'slowburn', 'location', 'marks', 'diary', 'pocket'], {
        slowburn: { speed: 'glacial', influence: 'strong', strict: true, dayLock: true },
        relations: { maxStep: 3 }, diary: { frequency: 'every', length: 'long' }, pocket: { auto: true, maxItems: 5 },
    }),
    preset('intrigue', 'Интриги', 'Связи, слухи, обещания и сюжетные нити; значимые предметы сохраняются как подсказки.', ['sims', 'relations', 'world', 'location', 'diary', 'pocket', 'cards'], {
        world: { threads: true, threadLimit: 6, rumors: true, tension: true, tensionActive: 2, tensionSlow: 2 },
        diary: { frequency: 'n', every: 2, length: 'medium' }, pocket: { auto: true, maxItems: 5 },
    }),
    preset('essentials', 'Только самое нужное', 'Короткий Пульс: время и место. Без отношений, заметок, инвентаря и дополнительных запросов за ними.', ['sims'], {
        sims: { variant: 'lite' },
    }),
    preset('suspense', 'Саспенс', 'Сюжет, незакрытые события, травмы и улики. Напряжение растёт сдержанно, не каждый ответ — поворот.', ['sims', 'world', 'location', 'marks', 'pocket', 'cards'], {
        world: { threads: true, threadLimit: 6, tension: true, tensionActive: 2, tensionSlow: 4, twists: true, rumors: true },
        marks: { healing: 'realistic' }, pocket: { auto: true, maxItems: 5 },
    }),
    preset('passion', 'Быстрая страсть', 'Быстрый романтический темп без принуждения: влияние стадии мягче, страсть по-прежнему зависит от событий.', ['sims', 'relations', 'slowburn', 'location', 'marks', 'diary', 'pocket'], {
        slowburn: { speed: 'fast', influence: 'light', strict: false, dayLock: false },
        relations: { maxStep: 10 }, diary: { frequency: 'n', every: 2, length: 'medium' }, pocket: { auto: true, maxItems: 5 },
    }),
]);

/** Применяет выбранный набор; подключение и данные чатов не меняются. */
export function applyPreset(settings, id) {
    const p = PRESETS.find(p => p.id === id);
    if (!p) return false;
    settings.modules ??= {};
    for (const key of Object.keys(DEFAULTS.modules)) {
        settings.modules[key] ??= structuredClone(DEFAULTS.modules[key]);
        // Сбрасываем параметры, которыми управляют наборы, чтобы новый набор
        // не унаследовал темп или вариант Пульса от предыдущего.
        const resets = {
            sims: ['variant'], relations: ['maxStep'], slowburn: ['speed', 'influence', 'strict', 'dayLock'],
            world: ['threads', 'threadLimit', 'tension', 'tensionActive', 'tensionSlow', 'twists', 'rumors'],
            marks: ['healing'], diary: ['frequency', 'every', 'length'], pocket: ['auto', 'maxItems'],
        }[key] ?? [];
        for (const field of resets) settings.modules[key][field] = structuredClone(DEFAULTS.modules[key][field]);
        Object.assign(settings.modules[key], p.modules[key], structuredClone(p.tune[key] ?? {}));
    }
    settings.lastPreset = p.id;
    return true;
}
