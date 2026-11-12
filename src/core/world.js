// Мир: напряжение (с твистом на 100%), сюжет и прогресс, расписание персонажей, слухи.
// Всё хранится в коде и меняется маленькими шагами, поэтому ничего не «скачет».

import { asArray, clamp, formatStamp, normName, parseDateTime, parseStamp, str, toNumber } from '../util.js';
import { collectionId } from './pocket.js';

export const threadLimit = (opts) => Math.round(clamp(Number(opts.s.modules.world?.threadLimit) || 6, 1, 12));
const threadText = (value) => {
    const text = str(value, 220);
    return /^(?:…|\.{3})$/.test(text) ? '' : text;
};
const endings = (value) => [...new Set(asArray(value).map((text) => str(text, 140)).filter(Boolean))].slice(0, 3);

export function stateLines(state, opts) {
    const w = state?.world;
    const cfg = opts.s.modules.world;
    const lines = [];
    if (!w) return lines;
    if (cfg.plot && w.plot) lines.push(`Plot: ${w.plot} — progress ${Math.round(w.progress ?? 0)}%.`);
    if (cfg.tension) {
        lines.push(`Tension: ${Math.round(w.tension ?? 0)}%.${cfg.twists && (w.tension ?? 0) >= 100
            ? ' ⚠ Tension is at 100%: in THIS reply deliver a MAJOR TWIST (betrayal, revealed secret, sudden arrival, accident, global event…) that fits the story, and describe it in world.twist.'
            : ''}`);
    }
    if (cfg.schedule && w.schedule?.length) {
        lines.push('Upcoming schedule (characters follow it: they leave or switch activity when the time comes):');
        for (const e of w.schedule.slice(0, 5)) lines.push(`  ${e.at.split(' ')[1] ?? ''} ${e.who ? e.who + ' — ' : ''}${e.what}`);
    }
    if (cfg.rumors && w.rumors?.length) {
        lines.push('Active rumors (NPCs may bring them up in dialogue, they spread and evolve):');
        for (const r of w.rumors) lines.push(`  [${r.id}] ${r.text}`);
    }
    if (cfg.threads !== false && w.threads?.length) {
        lines.push('Open story threads (remember commitments; possible endings are ideas, NOT events that already happened):');
        for (const t of w.threads.slice(0, threadLimit(opts))) {
            lines.push(`  [${t.id}] ${t.text}${t.endings?.length ? ' — possible outcomes: ' + t.endings.join(' / ') : ''}`);
        }
    }
    return lines;
}

export function schema(state, opts) {
    const cfg = opts.s.modules.world;
    const w = {};
    if (cfg.tension) w.pace = 'slow';
    if (cfg.tension && cfg.twists) w.twist = '';
    if (cfg.plot) Object.assign(w, { plot: '…', plot_d: 1 });
    if (cfg.schedule) w.schedule = [{ who: '…', time: 'HH:MM', what: '…' }];
    if (cfg.rumors) Object.assign(w, { rumor_add: [], rumor_drop: [] });
    if (cfg.threads !== false) Object.assign(w, { thread_add: [], thread_drop: [], thread_update: [] });
    return { world: w };
}

export function rules(state, opts) {
    const cfg = opts.s.modules.world;
    const w = state?.world;
    const r = [];
    if (cfg.tension) r.push('- world.pace: "active" if the plot moved forward in this reply (action, discoveries, conflict), "slow" for a calm everyday/talk scene. The system computes tension from it.');
    if (cfg.tension && cfg.twists) r.push('- world.twist: "" normally. Only when tension is 100% (or you really delivered a major twist): one sentence describing the twist.');
    if (cfg.plot) r.push(`- world.plot: current plot state in 1–3 words (Романтика, Расследование, Бытовуха…)${w?.plot ? ', keep "' + w.plot + '" unless it clearly changed' : ''}. plot_d: progress made in this reply, 0…5.`);
    if (cfg.schedule) r.push('- world.schedule: 2–4 upcoming activities of characters in story time [{who,time,what}]. Send it ONLY when the plan changed or fewer than 2 future entries are left; otherwise omit the key — the system keeps the old one.');
    if (cfg.rumors) {
        const n = Number(cfg.rumorCount) || 4;
        r.push(`- world.rumor_add: new rumors/gossip that appeared in the world (0–1 per reply; up to ${n} active total, add if fewer). rumor_drop: ids of rumors that were resolved or forgotten, e.g. ["r2"]. Usually both [].`);
    }
    if (cfg.threads !== false) {
        r.push(`- world.thread_add: [{"text":"an unresolved promise, planned meeting, unanswered question or event already established in the story","endings":["possible way to resolve it"]}]. Track only meaningful open threads, up to ${threadLimit(opts)} total; normally add zero or one. Never invent a promise or a completed event to fill the list.`);
        r.push('- world.thread_drop: ["existing thread id"] only when it actually resolved in the story. world.thread_update: [{"id":"existing thread id","text":"updated wording","endings":["optional possible outcome"]}] when facts changed. Possible endings are suggestions, never a prescribed outcome, and must not be narrated as already completed. Omitted keys preserve the open threads.');
    }
    return r;
}

/** Ближайшее наступление времени HH:MM начиная с момента now. */
function nextOccurrence(now, time) {
    const t = String(time ?? '').match(/(\d{1,2})[:.](\d{2})/);
    if (!now || !t) return null;
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(t[1]), Number(t[2])));
    if (dt.getTime() < now.getTime() - 5 * 60000) dt.setUTCDate(dt.getUTCDate() + 1);
    return dt;
}

export function apply(next, base, data, opts) {
    const cfg = opts.s.modules.world;
    const prev = base?.world ?? {};
    const w = {
        tension: prev.tension ?? 0,
        tensionDiff: 0,
        twist: '',
        lastTwist: prev.lastTwist ?? '',
        plot: prev.plot ?? '',
        progress: prev.progress ?? 0,
        progressDiff: 0,
        schedule: [...(prev.schedule ?? [])],
        rumors: [...(prev.rumors ?? [])],
        rumorSeq: prev.rumorSeq ?? 0,
        threads: structuredClone(Array.isArray(prev.threads) ? prev.threads : []),
    };
    const d = data?.world && typeof data.world === 'object' ? data.world : {};

    if (cfg.tension) {
        const twist = str(d.twist, 300);
        if (twist && cfg.twists) {
            w.twist = twist;
            w.lastTwist = twist;
            w.tensionDiff = -w.tension;
            w.tension = 0;
        } else {
            const pace = String(d.pace ?? '').toLowerCase();
            const inc = pace.startsWith('act') ? Number(cfg.tensionActive) || 1 : Number(cfg.tensionSlow) || 3;
            const was = w.tension;
            w.tension = clamp(w.tension + inc, 0, 100);
            w.tensionDiff = w.tension - was;
        }
    }

    if (cfg.plot) {
        const plot = str(d.plot, 40);
        const delta = clamp(toNumber(d.plot_d, 0), 0, 5);
        if (plot && normName(plot) !== normName(w.plot)) {
            w.plot = plot;
            w.progress = delta;
            w.progressDiff = delta;
        } else {
            const was = w.progress;
            w.progress = clamp(w.progress + delta, 0, 100);
            w.progressDiff = w.progress - was;
        }
    }

    const now = parseDateTime(next.date, next.time);
    if (cfg.schedule) {
        if (Array.isArray(d.schedule) && d.schedule.length) {
            w.schedule = d.schedule
                .filter((e) => e && typeof e === 'object' && str(e.what, 140))
                .map((e) => {
                    const at = nextOccurrence(now, e.time);
                    return { who: str(e.who, 60), what: str(e.what, 140), at: at ? formatStamp(at) : `${next.date} ${str(e.time, 5)}` };
                })
                .slice(0, 6);
        }
        if (now) w.schedule = w.schedule.filter((e) => { const at = parseStamp(e.at); return !at || at.getTime() >= now.getTime(); });
        w.schedule.sort((a, b) => (parseStamp(a.at)?.getTime() ?? 0) - (parseStamp(b.at)?.getTime() ?? 0));
    }

    if (cfg.rumors) {
        const drop = new Set(asArray(d.rumor_drop).map((x) => String(x).trim().toLowerCase()));
        if (drop.size) w.rumors = w.rumors.filter((r) => !drop.has(r.id.toLowerCase()));
        for (const text of asArray(d.rumor_add).slice(0, 2)) {
            const t = str(typeof text === 'object' ? text?.text : text, 220);
            if (!t || w.rumors.some((r) => normName(r.text) === normName(t))) continue;
            w.rumors.push({ id: `r${++w.rumorSeq}`, text: t, date: next.date || '' });
        }
        const n = Number(cfg.rumorCount) || 4;
        if (w.rumors.length > n) w.rumors = w.rumors.slice(-n);
    }
    if (cfg.threads !== false) {
        const limit = threadLimit(opts);
        const drop = new Set(asArray(d.thread_drop).map((id) => String(id).trim()));
        w.threads = w.threads.filter((t) => t && typeof t === 'object' && threadText(t.text) && !drop.has(t.id)).slice(0, limit);
        for (const change of asArray(d.thread_update).slice(0, 12)) {
            if (!change || typeof change !== 'object') continue;
            const t = w.threads.find((item) => item.id === str(change.id, 100));
            if (!t) continue;
            const text = threadText(change.text);
            if (text) t.text = text;
            if (Array.isArray(change.endings)) t.endings = endings(change.endings);
        }
        for (const change of asArray(d.thread_add).slice(0, 12)) {
            const text = threadText(typeof change === 'string' ? change : change?.text);
            if (!text || w.threads.some((t) => normName(t.text) === normName(text)) || w.threads.length >= limit) continue;
            const at = [next.date, next.time].filter(Boolean).join(' ');
            w.threads.push({ id: collectionId('t', normName(text), at), text, endings: endings(change?.endings), date: next.date || '', at });
        }
    }
    next.world = w;
}
