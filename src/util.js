// Общие мелкие помощники. Ничего не знают о таверне.

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
        const cleaned = value.replace(/[\s ]/g, '').replace(',', '.').replace(/[^\d.+-]/g, '');
        const n = parseFloat(cleaned);
        if (Number.isFinite(n)) return n;
    }
    return fallback;
}

export function str(value, max = 300) {
    if (value === null || value === undefined) return '';
    const s = String(value).trim();
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

/**
 * Находит блок <tag>...</tag> в тексте. Последний, если их несколько.
 * Понимает и незакрытый блок в самом конце (если ответ оборвался).
 * @returns {{ inner: string, start: number, end: number } | null}
 */
export function findTagBlock(text, tag) {
    if (!text) return null;
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)(?:</${tag}\\s*>|$)`, 'gi');
    let match;
    let last = null;
    while ((match = re.exec(text)) !== null) {
        last = { inner: match[1], start: match.index, end: match.index + match[0].length };
        if (match[0].length === 0) re.lastIndex++;
    }
    return last;
}

/** Удаляет все блоки <tag>...</tag> (и незакрытый хвост) из текста. */
export function stripTagBlocks(text, tags) {
    if (!text) return text;
    let out = text;
    for (const tag of tags) {
        out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi'), '');
        out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'i'), '');
        // экранированный вариант, если что-то уже прогнало текст через HTML-экранирование
        out = out.replace(new RegExp(`&lt;${tag}&gt;[\\s\\S]*?&lt;/${tag}&gt;`, 'gi'), '');
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Достаёт JSON-объект из текста модели и терпимо его разбирает:
 * убирает ```json-обёртки, комментарии, висячие запятые, «умные» кавычки вокруг ключей.
 */
export function parseLooseJson(text) {
    if (!text) throw new Error('пустой блок');
    let s = String(text).replace(/```(?:json)?/gi, '').trim();
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first === -1 || last <= first) throw new Error('в блоке нет JSON-объекта');
    s = s.slice(first, last + 1);

    const attempts = [
        (x) => x,
        (x) => x.replace(/,\s*([}\]])/g, '$1'),
        (x) => x
            .replace(/\/\/[^\n"]*$/gm, '')
            .replace(/[“”„]/g, '"')
            .replace(/,\s*([}\]])/g, '$1'),
    ];
    let lastError = null;
    for (const fix of attempts) {
        try {
            const obj = JSON.parse(fix(s));
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
        } catch (e) {
            lastError = e;
        }
    }
    throw new Error('битый JSON: ' + (lastError?.message || 'неизвестная ошибка'));
}

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

export function weekday(date, time) {
    const dt = parseDateTime(date, time);
    return dt ? WEEKDAYS[dt.getUTCDay()] : '';
}

export function formatMoney(value, currency) {
    if (value === null || value === undefined || value === '') return '';
    const n = Math.round(toNumber(value, NaN));
    if (!Number.isFinite(n)) return String(value);
    const abs = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (n < 0 ? '−' : '') + abs + (currency ? ' ' + currency : '');
}

export function formatSigned(n) {
    const r = Math.round(n);
    if (!r) return '';
    return (r > 0 ? '+' : '−') + Math.abs(r);
}

export function formatDuration(minutes) {
    const m = Math.round(minutes);
    if (m <= 0) return '';
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (h < 48) return rest ? `${h} ч ${rest} мин` : `${h} ч`;
    const d = Math.floor(h / 24);
    return `${d} дн ${h % 24} ч`;
}

export function deepClone(obj) {
    return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
}
