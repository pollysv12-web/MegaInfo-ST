import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.js';
import {
    buildContext, buildInstruction, extractBlocks, INLINE_MARKERS, stripPlacementMarkers,
} from '../src/core/engine.js';

function makeOpts() {
    const s = structuredClone(DEFAULTS);
    return {
        s,
        on: Object.fromEntries(Object.keys(s.modules).map((key) => [key, true])),
        stats: ['food', 'hygiene', 'energy', 'arousal'],
        decay: { food: -10, hygiene: -5, energy: -15, arousal: -10 },
        charName: 'Кристофер', userName: 'Миша', pronoun: 'he',
        language: 'Russian', places: {}, phones: 'auto',
    };
}

test('visual payload extraction preserves both exact narrative insertion points', () => {
    const story = `Он достал телефон.\n\n${INLINE_MARKERS.phone}\n\nЗатем показал билет.\n\n${INLINE_MARKERS.card}\n\nИ пошёл дальше.`;
    const raw = story + '\n<megainfo>{"date":"01.01.2026","phone":{"items":[{"text":"Привет"}]}}</megainfo>'
        + '<megainfo_html><div>Билет</div></megainfo_html>';
    const result = extractBlocks(raw);
    assert.equal(result.text, story);
    assert.equal(result.card, '<div>Билет</div>');
    assert.equal(JSON.parse(result.json).phone.items[0].text, 'Привет');
    assert.ok(result.text.indexOf(INLINE_MARKERS.phone) < result.text.indexOf('Затем'));
    assert.ok(result.text.indexOf(INLINE_MARKERS.card) < result.text.indexOf('И пошёл'));
});

test('bare JSON fallback also retains the insertion marker in the story', () => {
    const result = extractBlocks('Он прочитал сообщение.\n[[mi:phone]]\n\n```json\n{"date":"01.01.2026","time":"12:00","phone":{"items":[{"text":"Жду"}]}}\n```');
    assert.equal(result.bare, true);
    assert.equal(result.text, 'Он прочитал сообщение.\n[[mi:phone]]');
    assert.equal(result.jsonClosed, true);
});

test('prompt cleaning removes only reserved phone/card markers and retains story text', () => {
    assert.equal(stripPlacementMarkers('До\n\n[[mi:phone]]\n\nПосле [[MI:CARD]] конца.'), 'До\n\nПосле  конца.');
    assert.equal(stripPlacementMarkers('Слева [[ mi : phone ]] справа.'), 'Слева  справа.');
    assert.equal(stripPlacementMarkers('[[mi:other]] [[обычный текст]]'), '[[mi:other]] [[обычный текст]]');
    assert.equal(stripPlacementMarkers(null), null);
    assert.equal(stripPlacementMarkers(''), '');
});

test('normal reply instructions place phone/card markers inside the narrative only', () => {
    const opts = makeOpts();
    const instruction = buildInstruction({ state: null, request: new Set(['sims', 'phone', 'cards']), opts });
    assert.match(instruction, /\[\[mi:phone\]\]/);
    assert.match(instruction, /\[\[mi:card\]\]/);
    assert.match(instruction, /immediately after the moment/);
    assert.match(instruction, /never put it inside the JSON/);
    assert.match(instruction, /do not duplicate a phone display/);
    const phoneOnly = buildInstruction({ state: null, request: new Set(['phone']), opts });
    assert.match(phoneOnly, /\[\[mi:phone\]\]/);
    assert.doesNotMatch(phoneOnly, /\[\[mi:card\]\]/);
});

test('separate requests never ask for placement markers or new story actions', () => {
    const opts = makeOpts();
    opts.s.modules.cards.when = 'every';
    const instruction = buildInstruction({ state: null, request: new Set(['sims', 'phone', 'cards']), opts, separate: true });
    assert.doesNotMatch(instruction, /\[\[mi:(?:phone|card)\]\]/);
    assert.match(instruction, /events that ALREADY happened/);
    assert.match(instruction, /no placement markers/);
    assert.match(instruction, /Do not invent a new artifact/);
    assert.match(instruction, /in the latest story reply someone/);
    assert.doesNotMatch(instruction, /ALWAYS add one HTML card/);
});

test('cards-only instructions do not require an unrelated JSON block', () => {
    const opts = makeOpts();
    const normal = buildInstruction({ state: null, request: new Set(['cards']), opts });
    const separate = buildInstruction({ state: null, request: new Set(['cards']), opts, separate: true });
    assert.match(normal, /visual artifacts/);
    assert.match(normal, /\[\[mi:card\]\]/);
    assert.doesNotMatch(normal, /<megainfo>/);
    assert.match(separate, /ONLY the <megainfo_html> card if needed/);
    assert.doesNotMatch(separate, /<megainfo>/);
});

test('diary is supplied as data and displayed by the interface without story duplication', () => {
    const instruction = buildInstruction({ state: null, request: new Set(['diary']), opts: makeOpts() });
    assert.match(instruction, /Put the diary only in the JSON data/);
    assert.match(instruction, /directly above or below the reply/);
    assert.doesNotMatch(instruction, /\[\[mi:diary\]\]/);
});

test('slowburn and bodily needs remain in reminders when their updates are not requested', () => {
    const opts = makeOpts();
    const state = {
        date: '01.01.2026', time: '12:00', location: 'Дом',
        people: { christopher: { id: 'christopher', name: 'Кристофер', role: 'char', stats: { food: 10, hygiene: 80, energy: 70, arousal: 10 } } },
        scene: ['christopher'], slow: { points: 24, moments: [] },
    };
    const reminder = buildContext(state, opts);
    const instruction = buildInstruction({ state, request: new Set(['phone']), opts });
    for (const text of [reminder, instruction]) {
        assert.match(text, /SLOWBURN/);
        assert.match(text, /сытость 10/);
        assert.match(text, /голод/);
    }
});
