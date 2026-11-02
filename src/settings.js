// Настройки расширения: значения по умолчанию и доступ к сохранённым.

export const MODULE = 'megainfo';

/** Статы sims. decay — изменение за 2 часа времени в ролевой. */
export const STAT_DEFS = {
    food: { label: 'Сытость', icon: 'fa-utensils', decay: -10, critLow: 15 },
    hygiene: { label: 'Гигиена', icon: 'fa-droplet', decay: -5, critLow: 15 },
    energy: { label: 'Бодрость', icon: 'fa-bolt', decay: -15, critLow: 15 },
    arousal: { label: 'Возбуждение', icon: 'fa-fire', decay: 10, critHigh: 85 },
};

export const DEFAULTS = {
    enabled: true,
    style: 'glass',          // glass | minimal | solid
    placement: 'top',        // top | bottom — где рисовать блоки относительно текста
    showOnLast: 5,           // на скольких последних сообщениях показывать блоки (0 = на всех)
    hideWhileStreaming: true,

    sims: {
        enabled: true,
        mode: 'auto',        // inline | separate | auto
        profileId: '',       // профиль подключения для отдельного запроса ('' = текущий)
        contextMessages: 4,  // сколько последних сообщений чата видит отдельный запрос
        maxTokens: 700,      // лимит ответа отдельного запроса
        depth: 0,            // глубина вставки инструкции в чат
        view: 'bars',        // bars | chips
        collapsed: false,
        npcMax: 2,
        npcDetail: 'short',  // short | full
        showMoney: true,
        showProfile: true,
        currency: '₽',
        stats: {
            food: { on: true, decay: -10 },
            hygiene: { on: true, decay: -5 },
            energy: { on: true, decay: -15 },
            arousal: { on: true, decay: 10 },
        },
    },
};

function mergeDefaults(target, defaults) {
    for (const [key, value] of Object.entries(defaults)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (!target[key] || typeof target[key] !== 'object') target[key] = {};
            mergeDefaults(target[key], value);
        } else if (target[key] === undefined) {
            target[key] = value;
        }
    }
    return target;
}

export function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = {};
    return mergeDefaults(extensionSettings[MODULE], structuredClone(DEFAULTS));
}

export function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

/** Активные статы в порядке определения. */
export function activeStats(settings = getSettings()) {
    return Object.keys(STAT_DEFS).filter((k) => settings.sims.stats[k]?.on);
}
