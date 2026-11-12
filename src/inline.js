// Блоки внутри текста ответа. Меняем только DOM: исходный текст и данные свайпа сохраняются отдельно.
import { renderPhone, mountCard } from './render.js';

const MARKER = /\[\[\s*mi\s*:\s*(phone|card)\s*\]\]/gi;

function makeHost(kind, data, opts) {
    if (!opts.on[kind === 'card' ? 'cards' : 'phone']) return null;
    if (kind === 'phone' && (opts.phones === 'no' || !data?.phone?.length)) return null;
    if (kind === 'card' && !data?.card) return null;
    const host = document.createElement('span');
    host.className = 'mi-host mi-inline';
    host.dataset.miInline = kind;
    host.dataset.miTheme = opts.s.theme;
    host.dataset.miFont = opts.s.font;
    host.dataset.miContrast = opts.s.display?.contrast || 'normal';
    if (kind === 'phone') host.innerHTML = renderPhone(data.phone, opts, data.state);
    else {
        const card = document.createElement('span');
        card.className = 'mi-card-host';
        card.dataset.miCard = '1';
        host.append(card);
        mountCard(card, data.card);
    }
    return host;
}

/** Создаём постоянные точки вставки, чтобы перерисовки не теряли положение в тексте. */
function findSlots(textEl) {
    const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (node.parentElement.closest('.mi-host, .mi-slot, code, pre, script, style')) return NodeFilter.FILTER_REJECT;
            MARKER.lastIndex = 0;
            return MARKER.test(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
        const fragment = document.createDocumentFragment();
        let offset = 0;
        MARKER.lastIndex = 0;
        for (const match of node.data.matchAll(MARKER)) {
            fragment.append(document.createTextNode(node.data.slice(offset, match.index)));
            const slot = document.createElement('span');
            slot.className = 'mi-slot';
            slot.dataset.miSlot = match[1].toLowerCase();
            fragment.append(slot);
            offset = match.index + match[0].length;
        }
        fragment.append(document.createTextNode(node.data.slice(offset)));
        node.replaceWith(fragment);
    }
    return [...textEl.querySelectorAll('.mi-slot')];
}

export function renderInline(textEl, data, opts) {
    if (!textEl) return;
    textEl.querySelectorAll('.mi-inline').forEach((el) => el.remove());
    const slots = findSlots(textEl);
    const used = new Set();
    for (const slot of slots) {
        const kind = slot.dataset.miSlot;
        if (used.has(kind) || !opts.s.enabled) continue;
        const host = makeHost(kind, data, opts);
        if (host) {
            slot.append(host);
            used.add(kind);
        }
    }
    if (!opts.s.enabled) return;
    // Старые ответы и отдельные запросы могут не содержать маркера. Привязываем блок к подходящему абзацу.
    for (const kind of ['phone', 'card']) {
        if (used.has(kind)) continue;
        const host = makeHost(kind, data, opts);
        if (!host) continue;
        const pattern = kind === 'phone'
            ? /телефон|смартфон|сообщени|уведомлени|экран|прочита|написа|phone|texted|notification/i
            : /записк|документ|карточк|письм|чек\b|билет|плакат|объявлени|receipt|letter|document/i;
        const paragraph = [...textEl.children].find((el) => el.tagName === 'P' && pattern.test(el.textContent) && !el.querySelector('.mi-slot, .mi-host'));
        if (paragraph) paragraph.after(host);
        else textEl.append(host);
    }
}
