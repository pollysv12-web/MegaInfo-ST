import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, STAT_DEFS, getSettings } from '../src/settings.js';
import { PRESETS, applyPreset } from '../src/presets.js';
import { setTrackingOverride, trackingFor, trackingRules } from '../src/tracking.js';

test('v3 settings migrate without reinterpreting passion or resetting user preferences', () => {
    const old = globalThis.SillyTavern;
    const settings = { schemaVersion: 3, theme: 'noir', customCss: 'custom', profileId: 'private-profile', modules: { sims: { npcDetail: 'full', stats: { arousal: { decay: 0, on: false } } }, diary: { mode: 'separate' } } };
    let saves = 0;
    globalThis.SillyTavern = { getContext: () => ({ extensionSettings: { megainfo: settings }, saveSettingsDebounced: () => saves++ }) };
    try {
        const s = getSettings();
        assert.equal(s.schemaVersion, 4);
        assert.equal(STAT_DEFS.arousal.label, 'Страсть');
        assert.equal(s.modules.sims.stats.arousal.decay, 0);
        assert.equal(s.modules.sims.stats.arousal.on, false);
        assert.equal(s.modules.diary.mode, 'separate');
        assert.equal(s.tracking.roles.npc, 'full');
        assert.equal(s.profileId, 'private-profile');
        assert.equal(s.customCss, 'custom');
        assert.equal(s.theme, 'noir');
        assert.equal(s.display.pulse.profile, 'collapse');
        assert.equal(s.modules.pocket.maxItems, 5);
        getSettings();
        assert.equal(saves, 1, 'schema migration saves once');
    } finally {
        if (old === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = old;
    }
});

test('presets change gameplay explicitly and preserve connection, appearance and individual tracking', () => {
    const s = structuredClone(DEFAULTS);
    Object.assign(s, { profileId: 'chosen-profile', maxTokens: 7000, theme: 'custom', customCss: '.mine{}', custom: { accent: '#aabbcc' } });
    s.tracking.pinnedNpc = 'Кира';
    s.tracking.overrides['кира'] = { fields: { money: false } };
    const preserved = structuredClone({ profileId: s.profileId, maxTokens: s.maxTokens, theme: s.theme, customCss: s.customCss, custom: s.custom, tracking: s.tracking });
    assert.equal(applyPreset(s, 'slow-romance'), true);
    assert.equal(s.modules.slowburn.enabled, true);
    assert.equal(s.modules.slowburn.speed, 'glacial');
    assert.equal(s.modules.slowburn.strict, true);
    assert.equal(applyPreset(s, 'passion'), true);
    assert.equal(s.modules.slowburn.speed, 'fast');
    assert.equal(s.modules.slowburn.strict, false);
    assert.equal(s.modules.sims.stats.arousal.decay, -10, 'fast romance does not add passive sexual growth');
    assert.deepEqual({ profileId: s.profileId, maxTokens: s.maxTokens, theme: s.theme, customCss: s.customCss, custom: s.custom, tracking: s.tracking }, preserved);
    assert.equal(PRESETS.length, 6);
    assert.equal(new Set(PRESETS.map(p => p.id)).size, 6);
});

test('switching presets resets gameplay choices from the previous preset, unknown id changes nothing', () => {
    const s = structuredClone(DEFAULTS);
    applyPreset(s, 'essentials');
    assert.equal(s.modules.sims.variant, 'lite');
    assert.equal(s.modules.diary.enabled, false);
    applyPreset(s, 'everyday');
    assert.equal(s.modules.sims.variant, 'full');
    assert.equal(s.modules.diary.enabled, true);
    assert.equal(s.modules.world.enabled, false);
    const before = structuredClone(s);
    assert.equal(applyPreset(s, 'not-a-preset'), false);
    assert.deepEqual(s, before);
});

test('tracking keeps bot and user detailed, NPCs brief and a pinned NPC detailed', () => {
    const s = structuredClone(DEFAULTS);
    assert.equal(trackingFor({ role: 'char', name: 'Алекс' }, s).fields.stats, true);
    assert.equal(trackingFor({ role: 'user', name: 'Миша' }, s).fields.pocket, true);
    assert.deepEqual(trackingFor({ role: 'npc', name: 'Кира' }, s), {
        detail: 'short', fields: { stats: false, mood: true, outfit: true, thought: false, money: false, profile: false, relations: true, pocket: false },
    });
    s.tracking.pinnedNpc = 'КИРА';
    assert.equal(trackingFor({ role: 'npc', name: 'Кира' }, s).fields.stats, true);
    assert.equal(trackingFor({ role: 'npc', name: 'Кира' }, s).fields.pocket, true);
});

test('individual tracking fields override defaults while off prevents every update', () => {
    const s = structuredClone(DEFAULTS);
    setTrackingOverride(s, '  Кира ', { fields: { stats: true, outfit: false } });
    let policy = trackingFor({ role: 'npc', name: 'КИРА' }, s);
    assert.equal(policy.detail, 'short');
    assert.equal(policy.fields.stats, true);
    assert.equal(policy.fields.outfit, false);
    setTrackingOverride(s, 'Кира', { detail: 'off', fields: { stats: true } });
    policy = trackingFor({ role: 'npc', name: 'Кира' }, s);
    assert.equal(policy.detail, 'off');
    assert.equal(Object.values(policy.fields).some(Boolean), false);
    setTrackingOverride(s, 'Кира', null);
    assert.equal(trackingFor({ role: 'npc', name: 'Кира' }, s).fields.mood, true);
    assert.equal(trackingFor({ role: 'npc', name: 'Кира' }, s).fields.stats, false);
});

test('tracking prompt describes the actual roles, pinned person and field overrides', () => {
    const s = structuredClone(DEFAULTS);
    s.tracking.roles.user = 'off';
    s.tracking.pinnedNpc = 'Кира';
    setTrackingOverride(s, 'Кира', { fields: { money: false } });
    const text = trackingRules(s).join('\n');
    assert.match(text, /Tracking for user: off/);
    assert.match(text, /Important pinned NPC: Кира/);
    assert.match(text, /absent person present/);
    assert.match(text, /Tracking override for кира: full/);
    assert.doesNotMatch(text.split('Tracking override for кира:')[1], /money/);
});

test('bot and user named overrides inherit their role in prompt preferences', () => {
    const s = structuredClone(DEFAULTS);
    setTrackingOverride(s, 'Алекс', { fields: { outfit: false } });
    setTrackingOverride(s, 'Миша', { role: 'user', fields: { thought: false } });
    const text = trackingRules(s, { charName: 'Алекс' }).join('\n');
    assert.match(text, /Tracking override for алекс: full; fields to update: stats, mood, thought, money/);
    assert.match(text, /Tracking override for миша: full/);
});
