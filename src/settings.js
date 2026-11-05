// Настройки расширения: значения по умолчанию, доступ, переопределения для отдельного чата.

export const MODULE = 'megainfo';
export const VERSION = '0.2.0';

/** Статы sims. decay — изменение за 2 часа времени в ролевой. */
export const STAT_DEFS = {
    food: { label: 'Сытость', icon: 'fa-utensils', decay: -10, critLow: 15 },
    hygiene: { label: 'Гигиена', icon: 'fa-droplet', decay: -5, critLow: 15 },
    energy: { label: 'Бодрость', icon: 'fa-bolt', decay: -15, critLow: 15 },
    arousal: { label: 'Возбуждение', icon: 'fa-fire', decay: 10, critHigh: 85 },
};

/** Порядок и подписи модулей (используется в настройках, быстром меню и вкладках). */
export const MODULE_LIST = [
    { key: 'sims', label: 'Sims', icon: 'fa-heart-pulse' },
    { key: 'relations', label: 'Отношения', icon: 'fa-people-arrows' },
    { key: 'slowburn', label: 'Слоуберн', icon: 'fa-hourglass-half' },
    { key: 'world', label: 'Мир и сюжет', icon: 'fa-earth-europe' },
    { key: 'location', label: 'Локация', icon: 'fa-map-location-dot' },
    { key: 'marks', label: 'Следы на теле', icon: 'fa-band-aid' },
    { key: 'diary', label: 'Дневник', icon: 'fa-book-open' },
    { key: 'phone', label: 'Телефон', icon: 'fa-mobile-screen' },
    { key: 'cards', label: 'HTML-карточки', icon: 'fa-wand-magic-sparkles' },
];

export const DEFAULTS = {
    enabled: true,
    language: 'Russian',      // на каком языке модель пишет текст в блоках (Russian | English | Ukrainian)
    userPronoun: 'auto',      // auto | he | she | they

    // ---- вид
    theme: 'tavern',          // tavern | glass | noir | parchment | pastel | minimal | custom
    custom: { accent: '#c79bd8', bg: '#1d1a24', text: '#ebe7f0' },
    font: 'inherit',          // inherit | sans | serif | mono | rounded
    layout: 'tabs',           // tabs | stack
    placement: 'top',         // top | bottom
    showOnLast: 3,            // на скольких последних ответах показывать блоки (0 = на всех)
    collapsed: false,
    lastTab: '',
    hideWhileStreaming: true,
    customCss: '',

    // ---- как получать блоки
    mode: 'auto',             // inline | separate | auto
    separateKind: 'light',    // light (последние сообщения) | full (весь контекст и пресет)
    profileId: '',            // профиль подключения для отдельного запроса ('' = текущий)
    contextMessages: 6,
    maxTokens: 2500,
    depth: 0,
    remindState: true,        // напоминать модели текущее состояние в каждом запросе
    cleanTags: 'sims, diary, compass, phone, monolog, infoblock, status',
    stripHtmlDepth: 0,        // 0 = выкл; иначе вырезать любой HTML из сообщений глубже N
    debug: false,

    modules: {
        sims: {
            enabled: true,
            every: 1,
            variant: 'full',      // full | lite
            view: 'bars',         // bars | chips
            npcMax: 2,
            npcDetail: 'short',   // short | full
            npcTab: true,         // NPC отдельной вкладкой
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
        relations: {
            enabled: true,
            every: 1,
            maxStep: 5,           // максимальное изменение симпатии за один ответ
            npc: true,            // отслеживать и NPC
            thoughts: true,       // тайные мысли / мотивы
        },
        slowburn: {
            enabled: false,
            every: 1,
            speed: 'slow',        // glacial | slow | medium | fast
            dayLock: true,        // не больше одной новой стадии за игровой день
            strict: true,         // запрещать модели перескакивать стадии
            target: '',           // с кем слоуберн ('' = {{char}})
        },
        world: {
            enabled: false,
            every: 1,
            tension: true,
            tensionActive: 1,
            tensionSlow: 3,
            twists: true,
            plot: true,
            schedule: true,
            rumors: true,
            rumorCount: 4,
        },
        location: {
            enabled: true,
            detail: 'medium',     // short | medium | long
            remind: true,         // напоминать модели, как выглядит текущее место
        },
        marks: {
            enabled: true,
            every: 1,
            healing: 'realistic', // fast | realistic | slow
            notice: 'subtle',     // subtle | normal | dramatic
        },
        diary: {
            enabled: true,
            mode: 'separate',     // separate | inline
            frequency: 'every',   // every | n | day | manual
            every: 3,
            length: 'medium',     // short | medium | long | huge
            detail: 'normal',     // light | normal | deep
            aboutUser: true,
            npcs: true,
            gossip: false,
            secrets: true,
        },
        phone: {
            enabled: false,
            exists: 'auto',       // auto | yes | no — есть ли телефоны в этом мире
            style: 'ios',         // ios | telegram | glass | tavern
        },
        cards: {
            enabled: false,
            when: 'context',      // context | every
            maxChars: 6000,
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

/** Перенос настроек из v0.1 (там sims лежал на верхнем уровне). */
function migrate(s) {
    if (s.sims && typeof s.sims === 'object') {
        const old = s.sims;
        s.modules ??= {};
        s.modules.sims ??= {};
        for (const k of ['enabled', 'view', 'npcMax', 'npcDetail', 'showMoney', 'showProfile', 'currency', 'stats']) {
            if (old[k] !== undefined && s.modules.sims[k] === undefined) s.modules.sims[k] = old[k];
        }
        for (const k of ['mode', 'profileId', 'contextMessages', 'depth']) {
            if (old[k] !== undefined && s[k] === undefined) s[k] = old[k];
        }
        if (s.collapsed === undefined && old.collapsed !== undefined) s.collapsed = old.collapsed;
        delete s.sims;
    }
    if (s.language && /^(русском|English|українській)$/.test(s.language) && s.language !== 'English') {
        s.language = s.language === 'русском' ? 'Russian' : 'Ukrainian';
    }
    if (s.style && !s.theme) {
        s.theme = { glass: 'glass', minimal: 'minimal', solid: 'tavern' }[s.style] ?? 'tavern';
        delete s.style;
    }
    return s;
}

export function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = {};
    migrate(extensionSettings[MODULE]);
    return mergeDefaults(extensionSettings[MODULE], structuredClone(DEFAULTS));
}

export function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// ---------------------------------------------------------------- настройки этого чата

/** Переопределения для текущего чата: { modules: {key: bool}, phones: 'yes'|'no', userPronoun } */
export function getChatOverrides() {
    const meta = SillyTavern.getContext().chatMetadata;
    if (!meta) return {};
    meta[MODULE] ??= {};
    meta[MODULE].overrides ??= {};
    return meta[MODULE].overrides;
}

export function saveChatOverrides() {
    const c = SillyTavern.getContext();
    (c.saveMetadataDebounced ?? c.saveMetadata)?.();
}

/** Включён ли модуль с учётом настроек этого чата. */
export function moduleOn(key, s = getSettings()) {
    if (!s.enabled) return false;
    const ov = getChatOverrides().modules?.[key];
    const base = !!s.modules[key]?.enabled;
    const on = typeof ov === 'boolean' ? ov : base;
    if (!on) return false;
    if (key === 'phone' && phonesExist(s) === 'no') return false;
    return true;
}

export function phonesExist(s = getSettings()) {
    const ov = getChatOverrides().phones;
    return ov === 'yes' || ov === 'no' ? ov : s.modules.phone.exists;
}

/** Активные статы в порядке определения. */
export function activeStats(s = getSettings()) {
    return Object.keys(STAT_DEFS).filter((k) => s.modules.sims.stats[k]?.on);
}

const PRONOUN_WORDS = {
    he: /\b(he|him|his|male|man|boy|guy)\b|парень|мужчин|юнош|мальчик|\bон\b|мужск/i,
    she: /\b(she|her|female|woman|girl)\b|девушк|женщин|девочк|\bона\b|женск/i,
};

/** he | she | they — как называть {{user}} в дневнике и инструкциях. */
export function userPronoun(s = getSettings()) {
    const ov = getChatOverrides().userPronoun;
    const value = ov && ov !== 'inherit' ? ov : s.userPronoun;
    if (value && value !== 'auto') return value;
    try {
        const c = SillyTavern.getContext();
        const persona = String(c.powerUserSettings?.persona_description ?? '').slice(0, 1500);
        const he = (persona.match(new RegExp(PRONOUN_WORDS.he, 'gi')) ?? []).length;
        const she = (persona.match(new RegExp(PRONOUN_WORDS.she, 'gi')) ?? []).length;
        if (he > she) return 'he';
        if (she > he) return 'she';
    } catch { /* нет описания персоны */ }
    return 'they';
}
