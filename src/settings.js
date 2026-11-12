// Настройки расширения: значения по умолчанию, доступ, переопределения для отдельного чата.

export const MODULE = 'megainfo';
export const VERSION = '0.3.2';

const SETTINGS_VERSION = 4;

/** Статы sims. decay — изменение за 2 часа времени в ролевой. */
export const STAT_DEFS = {
    food: { label: 'Сытость', icon: 'fa-utensils', decay: -10, critLow: 20 },
    hygiene: { label: 'Гигиена', icon: 'fa-droplet', decay: -5, critLow: 25 },
    energy: { label: 'Бодрость', icon: 'fa-bolt', decay: -15, critLow: 15 },
    arousal: { label: 'Страсть', icon: 'fa-fire', decay: -10, critHigh: 85 },
};

/** Порядок и подписи модулей (используется в настройках, быстром меню и вкладках). */
export const MODULE_LIST = [
    { key: 'sims', label: 'Пульс', icon: 'fa-heart-pulse' },
    { key: 'relations', label: 'Связи', icon: 'fa-people-arrows' },
    { key: 'slowburn', label: 'Slow burn', icon: 'fa-hourglass-half' },
    { key: 'world', label: 'Сюжет', icon: 'fa-earth-europe' },
    { key: 'location', label: 'Места', icon: 'fa-map-location-dot' },
    { key: 'marks', label: 'Следы', icon: 'fa-band-aid' },
    { key: 'diary', label: 'Заметки', icon: 'fa-book-open' },
    { key: 'phone', label: 'На связи', icon: 'fa-mobile-screen' },
    { key: 'cards', label: 'Детали', icon: 'fa-wand-magic-sparkles' },
    { key: 'pocket', label: 'Кармашек', icon: 'fa-briefcase' },
];

export const DEFAULTS = {
    schemaVersion: SETTINGS_VERSION,
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
    display: {
        fontSize: 100,
        contrast: 'normal',
        tabOrder: ['chars', 'npc', 'rel', 'slow', 'world', 'place', 'body', 'pocket'],
        pulse: { stats: 'show', mood: 'show', excitement: 'show', outfit: 'show', thought: 'show', money: 'show', profile: 'collapse' },
        editControls: true,
    },
    tracking: {
        roles: { char: 'full', user: 'full', npc: 'short' },
        pinnedNpc: '',
        overrides: {},
    },

    // ---- как получать блоки
    mode: 'auto',             // inline | separate | auto
    separateKind: 'light',    // light (последние сообщения) | full (весь контекст и пресет)
    profileId: '',            // профиль подключения для отдельного запроса ('' = текущий)
    contextMessages: 6,
    maxTokens: 2500,
    depth: 0,
    injectRole: 'user',       // system | user — от чьего имени вставлять инструкцию
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
            birthdays: true,      // учитывать д/р в сцене, недостающие даты назначаются один раз
            userThoughts: false,  // разрешить модели писать внутренние мысли {{user}}
            excitement: true,     // эмоциональное возбуждение; не сексуальная страсть
            currency: '₽',
            stats: {
                food: { on: true, decay: -10 },
                hygiene: { on: true, decay: -5 },
                energy: { on: true, decay: -15 },
                arousal: { on: true, decay: -10 },
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
            influence: 'medium',  // light | medium | strong — влияние стадии на поведение
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
            threads: true,
            threadLimit: 6,
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
            trackPermanent: false, // новые тату/пирсинг; исходные особенности не добавляются
            notice: 'subtle',     // subtle | normal | dramatic
        },
        diary: {
            enabled: true,
            mode: 'inline',       // separate | inline — вместе с ответом, без ожидания второго запроса
            placement: 'bottom',  // top | bottom — отдельная запись до/после текста ответа
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
        pocket: {
            enabled: true,
            every: 1,
            auto: true,
            maxItems: 5,
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
    if (!s.tracking?.roles?.npc && s.modules?.sims?.npcDetail) {
        s.tracking ??= {};
        s.tracking.roles ??= {};
        s.tracking.roles.npc = s.modules.sims.npcDetail === 'full' ? 'full' : 'short';
    }
    if ((Number(s.schemaVersion) || 0) < 3) {
        // В 0.2 возбуждение росло само (+10/2 ч). Один раз меняем только
        // положительную скорость; выбранные пользователем 0 и спад сохраняем.
        const arousal = s.modules?.sims?.stats?.arousal;
        if (arousal && Number(arousal.decay) > 0) arousal.decay = -10;
    }
    // Version 4 adds display/tracking/pocket defaults without reinterpreting
    // saved sexual arousal values or resetting existing custom settings.
    if ((Number(s.schemaVersion) || 0) < SETTINGS_VERSION) s.schemaVersion = SETTINGS_VERSION;
    return s;
}

export function getSettings() {
    const c = SillyTavern.getContext();
    const { extensionSettings } = c;
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = {};
    const beforeVersion = extensionSettings[MODULE].schemaVersion;
    migrate(extensionSettings[MODULE]);
    const settings = mergeDefaults(extensionSettings[MODULE], structuredClone(DEFAULTS));
    if (settings.schemaVersion !== beforeVersion) c.saveSettingsDebounced?.();
    return settings;
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
