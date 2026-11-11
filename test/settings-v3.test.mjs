import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, VERSION, getChatOverrides, getSettings, moduleOn } from '../src/settings.js';

function inTavern(settings, run, chatMetadata = {}) {
    const previous = globalThis.SillyTavern;
    let saves = 0;
    const context = {
        extensionSettings: settings ? { megainfo: settings } : {},
        chatMetadata,
        saveSettingsDebounced() { saves++; },
    };
    globalThis.SillyTavern = { getContext: () => context };
    try {
        run(context, () => saves);
    } finally {
        if (previous === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = previous;
    }
}

test('обновление 0.2: пассивный рост исправляется и сохраняется один раз без сброса настроек', () => {
    inTavern({
        theme: 'noir',
        modules: {
            sims: { stats: { arousal: { on: true, decay: 10 } } },
            diary: { mode: 'separate', length: 'huge' },
        },
    }, (_, saveCount) => {
        const settings = getSettings();
        assert.equal(settings.modules.sims.stats.arousal.decay, -10);
        assert.equal(settings.modules.sims.stats.arousal.on, true);
        assert.equal(settings.theme, 'noir');
        assert.equal(settings.modules.diary.mode, 'separate');
        assert.equal(settings.modules.diary.length, 'huge');
        assert.equal(settings.schemaVersion, 3);
        assert.equal(saveCount(), 1);

        settings.modules.sims.stats.arousal.decay = -4;
        assert.equal(getSettings().modules.sims.stats.arousal.decay, -4);
        assert.equal(saveCount(), 1, 'чтение настроек не повторяет миграцию и запись');
    });
});

test('миграция сохраняет выбранный ноль и собственную скорость спада возбуждения', () => {
    for (const decay of [0, -3, -25]) {
        inTavern({ modules: { sims: { stats: { arousal: { decay } } } } }, (_, saveCount) => {
            assert.equal(getSettings().modules.sims.stats.arousal.decay, decay);
            getSettings();
            assert.equal(saveCount(), 1);
        });
    }
});

test('миграция 0.1 переносит настройки, исправляет рост и сохраняет выключенный стат', () => {
    inTavern({ sims: { currency: '$', stats: { arousal: { on: false, decay: 20 } } } }, (context) => {
        const settings = getSettings();
        assert.equal(settings.modules.sims.currency, '$');
        assert.equal(settings.modules.sims.stats.arousal.decay, -10);
        assert.equal(settings.modules.sims.stats.arousal.on, false);
        assert.equal(context.extensionSettings.megainfo.sims, undefined);
    });
});

test('новая установка пишет дневник вместе с ответом, существующий отдельный режим сохраняется', () => {
    inTavern(null, () => {
        const settings = getSettings();
        assert.equal(settings.modules.diary.mode, 'inline');
        assert.equal(settings.modules.diary.placement, 'bottom');
        assert.equal(settings.modules.sims.userThoughts, false);
    });
    inTavern({ modules: { diary: { mode: 'separate' } } }, () => {
        assert.equal(getSettings().modules.diary.mode, 'separate');
    });
});

test('настройки текущего чата не сбрасываются при миграции глобальных настроек', () => {
    const overrides = { modules: { sims: false, phone: true }, phones: 'yes', userPronoun: 'he' };
    const chatMetadata = { megainfo: { overrides: structuredClone(overrides), collapsed: true } };
    inTavern({ modules: { sims: { stats: { arousal: { decay: 10 } } } } }, () => {
        const settings = getSettings();
        assert.equal(moduleOn('sims', settings), false);
        assert.equal(moduleOn('phone', settings), true);
        assert.equal(settings.modules.sims.stats.arousal.decay, -10);
        assert.deepEqual(getChatOverrides(), overrides);
        assert.equal(chatMetadata.megainfo.collapsed, true);
    }, chatMetadata);
});

test('каждое поле настроек существует в DEFAULTS, версии манифеста и кода совпадают', () => {
    const html = readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
    const paths = [...html.matchAll(/data-mi-setting="([^"]+)"/g)].map((match) => match[1]);
    for (const path of paths) {
        const value = path.split('.').reduce((object, key) => object?.[key], DEFAULTS);
        assert.notEqual(value, undefined, `неизвестная настройка ${path}`);
    }
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.equal(manifest.version, VERSION);
});
