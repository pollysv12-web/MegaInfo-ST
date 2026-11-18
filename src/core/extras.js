// Дневник, телефон и HTML-карточки — блоки «на одно сообщение»: они не переносятся в следующие ответы.

import { asArray, prose, str } from '../util.js';

// ---------------------------------------------------------------- дневник

export const DIARY_WORDS = { short: '60–100', medium: '150–220', long: '280–380', huge: '450–650' };
const DIARY_DETAIL = {
    light: 'Simple and light: the main feeling of the moment.',
    normal: 'Concrete: what happened, how it felt, what they hide.',
    deep: 'Deep and layered: sensory details, contradictions, memories, fears, desires, plans; no generic phrases.',
};

export const PRONOUN = {
    he: { about: 'О нём', en: 'he/him (male)' },
    she: { about: 'О ней', en: 'she/her (female)' },
    they: { about: 'О них', en: 'they/them' },
};

export function diaryAboutTitle(pronoun) {
    return (PRONOUN[pronoun] ?? PRONOUN.they).about;
}

export function diarySchema(opts) {
    const cfg = opts.s.modules.diary;
    const d = { date: 'DD.MM.YYYY HH:MM', title: '…', entry: '…' };
    if (cfg.aboutUser) d.about_user = '…';
    if (cfg.npcs) d.npcs = [{ name: '…', entry: '…' }];
    if (cfg.gossip) d.gossip = '…';
    return { diary: d };
}

export function diaryRules(opts, prevDiary) {
    const cfg = opts.s.modules.diary;
    const C = opts.charName || 'Character';
    const U = opts.userName || 'User';
    const pron = PRONOUN[opts.pronoun] ?? PRONOUN.they;
    const r = [];
    r.push(`- diary: ${C}'s private first-person diary about what JUST happened — raw and honest, fragments, things never said aloud; never retell older events or the previous entry. entry: ${DIARY_WORDS[cfg.length] ?? DIARY_WORDS.medium} words. ${DIARY_DETAIL[cfg.detail] ?? DIARY_DETAIL.normal}${cfg.secrets ? ' Include a secret, fear or hidden desire.' : ''} Paragraphs split by \\n\\n. title: 2–5 words.`);
    if (cfg.aboutUser) r.push(`- diary.about_user: ${C}'s notes about ${U} (${pron.en}: use matching pronouns and grammatical gender) — observations, changing feelings, suspicions; about half the entry.`);
    if (cfg.npcs) r.push('- diary.npcs: 1–2 short first-person entries of NPCs from the scene (hidden thoughts, plans), [] if none.');
    if (cfg.gossip) r.push('- diary.gossip: 1–3 sentences of what people around are whispering.');
    r.push('- Put the diary only in the JSON data; the system shows it directly above or below the reply.');
    if (prevDiary?.entry) r.push(`  Previous entry began: «${prevDiary.entry.slice(0, 160).replace(/\s+/g, ' ')}…»`);
    return r;
}

export function parseDiary(data, state) {
    const d = data?.diary;
    if (!d || typeof d !== 'object') return null;
    const entry = prose(d.entry ?? d.text ?? d.thoughts, 12000);
    if (!entry) return null;
    return {
        date: str(d.date, 30) || `${state?.date ?? ''} ${state?.time ?? ''}`.trim(),
        title: str(d.title, 80),
        entry,
        aboutUser: prose(d.about_user ?? d.aboutUser ?? d.notes, 6000),
        npcs: asArray(d.npcs).filter((n) => n && typeof n === 'object' && prose(n.entry ?? n.text))
            .map((n) => ({ name: str(n.name, 60), entry: prose(n.entry ?? n.text, 3000) })).slice(0, 4),
        gossip: prose(d.gossip, 2000),
    };
}

// ---------------------------------------------------------------- телефон

export function phoneSchema() {
    return {
        phone: {
            app: 'telegram',
            kind: 'chat',
            title: '…',
            items: [{ from: '…', dir: 'in', text: '…', time: 'HH:MM' }],
        },
    };
}

export function phoneRules(opts, { separate = false } = {}) {
    const exists = opts.phones;
    const reply = separate ? 'the latest story reply' : 'THIS reply';
    const r = [];
    r.push(`- phone: ONLY if in ${reply} someone actually uses a phone on screen (texts, reads messages or notifications, scrolls a feed); otherwise omit it, never invent phone use.${exists === 'auto' ? ' Never in worlds without phones.' : ''} app: telegram/whatsapp/instagram/twitter/sms/tinder/other; kind: chat | post | notifications; title: chat or profile name.`);
    r.push(`- phone.items: chat — messages in order, dir "out" = sent by the phone owner, "in" = received, short and realistic (typos, slang, no emoji); post — one item with author, text, likes, comments; notifications — one item each. Texts in ${opts.language}.`);
    if (!separate) {
        r.push('- With phone data, put [[mi:phone]] on its own line INSIDE the story immediately after the moment the messages are read or sent, then continue. One marker per reply; never put it inside the JSON; omit it without phone data.');
    }
    return r;
}

export function parsePhone(data) {
    const list = asArray(data?.phone).filter((p) => p && typeof p === 'object');
    const out = list.map((p) => ({
        app: str(p.app, 30).toLowerCase() || 'sms',
        kind: str(p.kind ?? p.type, 20).toLowerCase() || 'chat',
        title: str(p.title ?? p.from ?? p.contact, 80),
        owner: str(p.owner, 60),
        items: asArray(p.items ?? p.messages).filter((m) => m && (typeof m === 'string' || typeof m === 'object')).map((m) => (typeof m === 'string'
            ? { from: '', dir: 'in', text: str(m, 600), time: '' }
            : {
                from: str(m.from ?? m.author, 60),
                dir: String(m.dir ?? '').toLowerCase().startsWith('o') ? 'out' : 'in',
                text: str(m.text ?? m.caption, 900),
                time: str(m.time, 10),
                likes: m.likes !== undefined ? str(m.likes, 12) : '',
                comments: m.comments !== undefined ? str(m.comments, 12) : '',
                image: str(m.image, 200),
            })).filter((m) => m.text || m.image).slice(0, 30),
    })).filter((p) => p.items.length);
    return out.length ? out : null;
}

// ---------------------------------------------------------------- HTML-карточки

export const CARD_TAG = 'megainfo_html';

export function cardRules(opts, { separate = false } = {}) {
    const when = opts.s.modules.cards.when === 'every' && !separate
        ? 'ALWAYS add one HTML card that fits the scene (an in-world document, screen, post, letter, note, sign, receipt, ticket, menu…).'
        : 'ONLY if the scene features an in-world document, screen, post, letter, note, sign, receipt, ticket, menu or similar artifact — recreate it as an HTML card. Otherwise do NOT add it.';
    const r = [
        `- HTML card: ${when}`,
        `  Put it at the END (after the JSON) inside <${CARD_TAG}>…</${CARD_TAG}>: one root <div> with inline styles or one <style>, no scripts, no markdown, max width 100%, readable on a phone. Text in ${opts.language}.`,
        '  Match the setting realistically: modern → real app UI, sci-fi → holographic, fantasy → parchment and ink, horror → VHS noise and stains, historical → period typography. Story-accurate names, times and numbers; Font Awesome icons or inline SVG instead of emoji.',
    ];
    if (!separate) {
        r.push('  Place [[mi:card]] on its own line INSIDE the story where the artifact is seen or handled, then continue; one marker, never inside the JSON or HTML; omit it without a card. Never add an unrelated artifact, and do not duplicate a phone display as a card.');
    } else {
        r.push('  Recreate only an artifact already present in the latest reply. Do not invent a new artifact or action to justify a card.');
    }
    return r;
}

export function parseCard(html, maxChars = 6000) {
    if (!html || typeof html !== 'string') return '';
    let h = html.replace(/```(?:html)?/gi, '').trim();
    if (!/<[a-z]/i.test(h)) return '';
    if (h.length > maxChars * 2) h = h.slice(0, maxChars * 2);
    return h;
}
