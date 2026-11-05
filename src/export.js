// Экспорт: все данные инфоблоков чата (JSON или читаемый текст) и дневник отдельно.

import { MODULE, VERSION, getSettings, userPronoun } from './settings.js';
import { getData, getPlaces } from './store.js';
import { Extras, Marks } from './core/engine.js';
import { formatMoney } from './util.js';

const ctx = () => SillyTavern.getContext();

function download(name, text, type = 'application/json') {
    const blob = new Blob([text], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function baseName() {
    const c = ctx();
    const id = String(c.getCurrentChatId?.() ?? 'chat').replace(/[\\/:*?"<>|]+/g, '_');
    return `megainfo_${id}`;
}

export function collect() {
    const c = ctx();
    const messages = [];
    (c.chat ?? []).forEach((m, id) => {
        const d = getData(m);
        if (!d) return;
        messages.push({ id, name: m.name, send_date: m.send_date, ...structuredClone(d) });
    });
    return {
        megainfo: VERSION,
        exported: new Date().toISOString(),
        chat: c.getCurrentChatId?.(),
        character: c.name2,
        user: c.name1,
        places: structuredClone(getPlaces()),
        overrides: structuredClone(c.chatMetadata?.[MODULE]?.overrides ?? {}),
        messages,
    };
}

export function exportJson() {
    const data = collect();
    if (!data.messages.length) {
        toastr.info('В этом чате пока нет инфоблоков.', 'MegaInfo');
        return;
    }
    download(`${baseName()}.json`, JSON.stringify(data, null, 2));
}

function diaryText(d, pronoun) {
    const out = [`## ${d.title || 'Запись'} — ${d.date}`, '', d.entry];
    if (d.aboutUser) out.push('', `### ${Extras.diaryAboutTitle(pronoun)}`, '', d.aboutUser);
    for (const n of d.npcs ?? []) out.push('', `### ${n.name}`, '', n.entry);
    if (d.gossip) out.push('', '### Шепчутся', '', d.gossip);
    return out.join('\n');
}

export function exportDiary() {
    const c = ctx();
    const pron = userPronoun();
    const parts = [];
    (c.chat ?? []).forEach((m) => {
        const d = getData(m)?.diary;
        if (d) parts.push(diaryText(d, pron));
    });
    if (!parts.length) {
        toastr.info('В этом чате пока нет записей дневника.', 'MegaInfo');
        return;
    }
    download(`${baseName()}_diary.md`, `# Дневник: ${c.name2}\n\n${parts.join('\n\n---\n\n')}\n`, 'text/markdown');
}

export function exportText() {
    const data = collect();
    if (!data.messages.length) {
        toastr.info('В этом чате пока нет инфоблоков.', 'MegaInfo');
        return;
    }
    const s = getSettings();
    const pron = userPronoun();
    const out = [`# MegaInfo: ${data.character} / ${data.user}`, `Экспорт: ${data.exported}`, ''];
    for (const m of data.messages) {
        const st = m.state;
        out.push(`## #${m.id} ${m.name}`);
        if (st) {
            out.push(`${st.date ?? ''} ${st.time ?? ''} · ${st.weather ?? ''} · ${st.location ?? ''}`);
            for (const id of st.scene ?? []) {
                const p = st.people?.[id];
                if (!p) continue;
                const bits = [];
                if (p.stats) bits.push(Object.entries(p.stats).map(([k, v]) => `${k} ${v}`).join(', '));
                if (p.money !== null && p.money !== undefined) bits.push(formatMoney(p.money, s.modules.sims.currency));
                if (typeof p.aff === 'number') bits.push(`симпатия ${p.aff}${p.rel ? ' (' + p.rel + ')' : ''}`);
                if (p.mood) bits.push(p.mood);
                if (p.outfit) bits.push(p.outfit);
                out.push(`- ${p.name}: ${bits.join(' · ')}${p.thought ? `\n  «${p.thought}»` : ''}`);
            }
            if (st.tx?.length) out.push(`Траты: ${st.tx.map((t) => `${t.who} ${formatMoney(t.amount, s.modules.sims.currency)} ${t.note}`).join('; ')}`);
            if (st.slow) out.push(`Слоуберн: ${st.slow.points}/100`);
            if (st.world) {
                const w = st.world;
                out.push(`Мир: сюжет «${w.plot}» ${w.progress}% · напряжение ${w.tension}%${w.twist ? ` · ПОВОРОТ: ${w.twist}` : ''}`);
                if (w.rumors?.length) out.push(`Слухи: ${w.rumors.map((r) => r.text).join(' | ')}`);
            }
            if (st.marks?.length) out.push(`Следы: ${st.marks.map((k) => `${k.who}: ${Marks.KINDS[k.kind]?.label ?? k.kind} (${k.where})`).join('; ')}`);
        }
        if (m.diary) out.push('', diaryText(m.diary, pron));
        if (m.phone) out.push('', 'Телефон:', ...m.phone.flatMap((p) => p.items.map((i) => `  [${p.app}] ${i.from || (i.dir === 'out' ? '→' : '←')}: ${i.text}`)));
        out.push('');
    }
    const places = Object.values(data.places);
    if (places.length) {
        out.push('# Места', '');
        for (const p of places) out.push(`## ${p.name}`, p.look, p.details, p.mood, '');
    }
    download(`${baseName()}.md`, out.join('\n'), 'text/markdown');
}
