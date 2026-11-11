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
    r.push(`- diary: ${C}'s private diary entry about the latest events, first person, raw and honest, as a REAL diary — fragments, “…” for broken thoughts, things never said aloud. Language: ${opts.language}.`);
    r.push(`- diary.entry: ${DIARY_WORDS[cfg.length] ?? DIARY_WORDS.medium} words. ${DIARY_DETAIL[cfg.detail] ?? DIARY_DETAIL.normal}${cfg.secrets ? ' Include a secret, fear or hidden desire.' : ''} Paragraphs separated by \\n\\n. title: 2–5 words.`);
    if (cfg.aboutUser) r.push(`- diary.about_user: ${C}'s private notes about ${U} — observations, changing feelings, suspicions, attraction or irritation. ${U} is ${pron.en}: use the correct pronouns and grammatical gender for ${U}. About half the length of entry.`);
    if (cfg.npcs) r.push('- diary.npcs: short first-person entries of 1–2 NPCs who were in the scene (their hidden thoughts, secrets, plans). [] if no NPCs.');
    if (cfg.gossip) r.push('- diary.gossip: what people around are whispering — gossip, rumors overheard, 1–3 sentences.');
    r.push('- Write a NEW entry about what just happened. Do not retell older events and do not repeat the previous entry.');
    r.push('- Put the diary only in the JSON data, not in the story. The system displays the entry directly above or below the reply according to the reader\'s setting; no diary placement marker is needed.');
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
    r.push(`- phone: ONLY if in ${reply} someone actually uses a phone on screen — texts, reads messages or notifications, scrolls social media, sees a post. If nobody touches a phone, OMIT "phone" completely. Never invent phone use just to fill the block.${exists === 'auto' ? ' If phones do not exist in this world (fantasy, historical…), never output it.' : ''}`);
    r.push('- phone.app: telegram/whatsapp/instagram/twitter/sms/tinder/other. kind: chat | post | notifications. title: chat or profile name.');
    r.push('- phone.items: for chat — messages in order, dir "out" = sent by the phone owner, "in" = received; short and realistic (typos, slang, no standard emoji — the system draws icons). For post — one item with author, text (caption), likes, comments. For notifications — one item per notification.');
    r.push(`- phone texts in ${opts.language}.`);
    if (!separate) {
        r.push('- When phone data is present, put [[mi:phone]] on its own line INSIDE the story, immediately after the moment a character reads or sends the shown messages. Continue the story after the marker when appropriate. Use one marker per reply, never put it inside the JSON, and omit it if there is no phone data. The system replaces it with the phone display; do not repeat the messages as an extra status block.');
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
        ? 'ALWAYS add one HTML card that fits the scene (an in-world document, screen, post, letter, note, sign, receipt, profile, newspaper, ticket, menu…).'
        : 'ONLY if the scene features an in-world document, screen, post, letter, note, sign, receipt, profile, newspaper, ticket, menu or similar artifact — recreate it as an HTML card. Otherwise do NOT add it.';
    const r = [
        `- HTML card: ${when}`,
        `  Put the HTML payload at the END (after the JSON block if present) inside <${CARD_TAG}>…</${CARD_TAG}>. One self-contained snippet: a root <div> with inline styles or one <style> block, no scripts, no markdown, no \`\`\`. Max width 100%, readable on a phone (add @media (max-width:760px)). Text in ${opts.language}.`,
        '  Make it look hyper-realistic and match the setting: modern → pixel-perfect app UI (real platform colors and spacing); sci-fi → holographic, glitch, scan lines; fantasy/medieval → parchment, wax seals, ink; horror → VHS noise, redactions, stains; historical → period typography. Mood colors: warm gold for happy, desaturated blue for sad, high-contrast red for tension, deep purple glow for intimate.',
        '  Realism: story-accurate timestamps and names, believable numbers, natural typos in casual messages. Use Font Awesome icons (<i class="fa-solid fa-…">) or inline SVG instead of emoji.',
    ];
    if (!separate) {
        r.push('  Place [[mi:card]] on its own line INSIDE the story exactly where the character sees, reads or handles that artifact, then continue the story. One marker per reply; never put it in the JSON or HTML payload. The system displays the card there. If no card is generated, omit the marker. Do not add an unrelated artifact merely to fill a slot, and do not duplicate a phone display as a second card.');
    } else {
        r.push('  Recreate only an artifact already present in the latest reply. Do not invent a new artifact or a new action to justify a card.');
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
