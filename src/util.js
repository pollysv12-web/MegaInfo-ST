// Общие мелкие помощники. Ничего не знают о таверне — поэтому их можно тестировать в node.

export function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

export function toNumber(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const cleaned = value.replace(/[\s  ]/g, '').replace(',', '.').replace(/[−–—]/g, '-').replace(/[^\d.+-]/g, '');
        const n = parseFloat(cleaned);
        if (Number.isFinite(n)) return n;
    }
    return fallback;
}

export function str(value, max = 300) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return '';
    const s = String(value).trim();
    if (PLACEHOLDER.test(s)) return '';
    return s.length > max ? s.slice(0, max).trim() + '…' : s;
}

/** Заглушки из примера формата, которые модель иногда возвращает как есть. */
const PLACEHOLDER = /^(…|\.\.\.|-|—|имя npc|npc name|name|n\/a|none|нет)$/i;

/** Текст с переносами строк (для дневника): сохраняет абзацы. */
export function prose(value, max = 8000) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) value = value.filter((x) => typeof x === 'string').join('\n\n');
    if (typeof value !== 'string') return '';
    const s = value.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    return s.length > max ? s.slice(0, max).trim() + '…' : s;
}

/** Нормализация имени для сравнения: регистр, ё, пунктуация. */
export function normName(name) {
    return String(name ?? '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^\p{L}\p{N} ]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Похожи ли два названия (имени, места): точное совпадение или одно содержит другое. */
export function sameName(a, b) {
    const x = normName(a);
    const y = normName(b);
    if (!x || !y) return false;
    if (x === y) return true;
    if (x.length < 4 || y.length < 4) return false;
    return x.includes(y) || y.includes(x);
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Находит блок <tag>...</tag> в тексте. Последний, если их несколько.
 * Понимает и незакрытый блок в самом конце (если ответ оборвался).
 * @returns {{ inner: string, start: number, end: number, closed: boolean } | null}
 */
export function findTagBlock(text, tag) {
    if (!text) return null;
    const t = escapeRe(tag);
    const re = new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)(</${t}\\s*>|$)`, 'gi');
    let match;
    let last = null;
    while ((match = re.exec(text)) !== null) {
        last = { inner: match[1], start: match.index, end: match.index + match[0].length, closed: !!match[2] };
        if (match[0].length === 0) re.lastIndex++;
    }
    return last;
}

/** Удаляет все блоки <tag>...</tag> (и незакрытый хвост) из текста. */
export function stripTagBlocks(text, tags) {
    if (!text || typeof text !== 'string') return text;
    let out = text;
    for (const raw of tags) {
        const tag = escapeRe(raw);
        if (!tag) continue;
        out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi'), '');
        out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'i'), '');
        // экранированный вариант, если что-то уже прогнало текст через HTML-экранирование
        out = out.replace(new RegExp(`&lt;${tag}\\b[\\s\\S]*?&lt;/${tag}&gt;`, 'gi'), '');
        // пустые обёртки ```...``` вокруг вырезанного блока
    }
    out = out.replace(/```(?:json|html)?\s*```/g, '');
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Вырезает любой HTML (теги с содержимым и одиночные теги). */
export function stripAnyHtml(text) {
    if (!text || typeof text !== 'string' || !/<[a-z]/i.test(text)) return text;
    let out = text;
    out = out.replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, '');
    for (let i = 0; i < 4; i++) {
        const before = out;
        out = out.replace(/<(div|details|table|section|article|aside|figure|svg|ul|ol)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
        if (out === before) break;
    }
    out = out.replace(/<\/?[a-z][a-z0-9-]*\b[^>]*>/gi, '');
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Чинит частые ошибки модели в JSON: настоящие переносы строк и табы внутри строк.
 */
function escapeControlInStrings(s) {
    let out = '';
    let inStr = false;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (escaped) { escaped = false; out += ch; continue; }
            if (ch === '\\') { escaped = true; out += ch; continue; }
            if (ch === '"') { inStr = false; out += ch; continue; }
            if (ch === '\n') { out += '\\n'; continue; }
            if (ch === '\r') continue;
            if (ch === '\t') { out += '\\t'; continue; }
            out += ch;
        } else {
            if (ch === '"') inStr = true;
            out += ch;
        }
    }
    return out;
}

/** Закрывает оборванный JSON (если ответ модели обрезался по длине). */
function closeTruncated(s) {
    const stack = [];
    let inStr = false;
    let escaped = false;
    for (const ch of s) {
        if (inStr) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
        else if (ch === '}' || ch === ']') stack.pop();
    }
    let out = s;
    if (inStr) out += '"';
    out = out.replace(/,\s*$/, '').replace(/:\s*$/, ':null');
    while (stack.length) out += stack.pop();
    return out;
}

/**
 * Достаёт JSON-объект из текста модели и терпимо его разбирает:
 * убирает ```json-обёртки, комментарии, висячие запятые, «умные» кавычки, переносы строк в строках,
 * дописывает закрывающие скобки, если ответ оборвался.
 */
export function parseLooseJson(text) {
    if (!text || !String(text).trim()) throw new Error('пустой блок');
    let s = String(text).replace(/```(?:json)?/gi, '').trim();
    const first = s.indexOf('{');
    if (first === -1) throw new Error('в блоке нет JSON-объекта');
    const last = s.lastIndexOf('}');
    const whole = last > first ? s.slice(first, last + 1) : s.slice(first);
    const tail = s.slice(first);

    const fixes = [
        (x) => x,
        (x) => escapeControlInStrings(x).replace(/,\s*([}\]])/g, '$1'),
        (x) => escapeControlInStrings(x
            .replace(/^\s*\/\/.*$/gm, '')
            .replace(/[“”„]/g, '"'))
            .replace(/,\s*([}\]])/g, '$1'),
    ];
    let lastError = null;
    for (const candidate of [whole, tail]) {
        for (const fix of fixes) {
            for (const finish of [(x) => x, closeTruncated]) {
                try {
                    const obj = JSON.parse(finish(fix(candidate)));
                    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
                } catch (e) {
                    lastError = e;
                }
            }
        }
    }
    throw new Error('битый JSON: ' + (lastError?.message || 'неизвестная ошибка'));
}

// ---------------------------------------------------------------- время в ролевой

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** "15.03.2025" + "14:30" -> Date (UTC, чтобы не зависеть от часового пояса). */
export function parseDateTime(date, time) {
    const d = String(date ?? '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!d) return null;
    let year = Number(d[3]);
    if (year < 100) year += 2000;
    const t = String(time ?? '').match(/(\d{1,2})[:.](\d{2})/);
    const hh = t ? Number(t[1]) : 12;
    const mm = t ? Number(t[2]) : 0;
    const ms = Date.UTC(year, Number(d[2]) - 1, Number(d[1]), hh, mm);
    return Number.isFinite(ms) ? new Date(ms) : null;
}

/** "15.03.2025 14:30" -> Date */
export function parseStamp(stamp) {
    const [date, time] = String(stamp ?? '').split(/\s+/);
    return parseDateTime(date, time);
}

export function makeStamp(date, time) {
    return `${date ?? ''} ${time ?? ''}`.trim();
}

export function formatStamp(dt) {
    if (!(dt instanceof Date)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(dt.getUTCDate())}.${p(dt.getUTCMonth() + 1)}.${dt.getUTCFullYear()} ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`;
}

/** Минуты между двумя моментами ролевой (или null). */
export function minutesBetween(a, b) {
    const x = a instanceof Date ? a : parseStamp(a);
    const y = b instanceof Date ? b : parseStamp(b);
    if (!x || !y) return null;
    return (y.getTime() - x.getTime()) / 60000;
}

export function weekday(date, time) {
    const dt = parseDateTime(date, time);
    return dt ? WEEKDAYS[dt.getUTCDay()] : '';
}

export function formatMoney(value, currency) {
    if (value === null || value === undefined || value === '') return '';
    const n = Math.round(toNumber(value, NaN));
    if (!Number.isFinite(n)) return String(value);
    const abs = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (n < 0 ? '−' : '') + abs + (currency ? ' ' + currency : '');
}

export function formatSigned(n) {
    const r = Math.round(n);
    if (!r) return '';
    return (r > 0 ? '+' : '−') + Math.abs(r);
}

export function formatDuration(minutes) {
    const m = Math.round(minutes);
    if (!Number.isFinite(m) || m <= 0) return '';
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (h < 48) return rest ? `${h} ч ${rest} мин` : `${h} ч`;
    const d = Math.floor(h / 24);
    return h % 24 ? `${d} дн ${h % 24} ч` : `${d} дн`;
}

export function deepClone(obj) {
    return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
}

export function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === '') return [];
    return [value];
}
