// Отрисовка панели инфоблока для одного сообщения: шапка + вкладки (или блоки друг под другом).
// Здесь только HTML-строки — никакой логики подсчёта.

import { STAT_DEFS, getSettings } from './settings.js';
import { Extras, Loc, Marks, People, Slow } from './core/engine.js';
import {
    esc, formatDuration, formatMoney, formatSigned, weekday,
} from './util.js';

const MBTI = {
    ISTJ: 'Логист', ISFJ: 'Защитник', INFJ: 'Активист', INTJ: 'Стратег', ISTP: 'Виртуоз', ISFP: 'Артист',
    INFP: 'Посредник', INTP: 'Учёный', ESTP: 'Делец', ESFP: 'Развлекатель', ENFP: 'Борец', ENTP: 'Полемист',
    ESTJ: 'Менеджер', ESFJ: 'Консул', ENFJ: 'Тренер', ENTJ: 'Командир',
};

const icon = (name, cls = 'fa-solid') => `<i class="${cls} ${name}"></i>`;
const delta = (d) => (d ? `<span class="mi-delta ${d > 0 ? 'mi-up' : 'mi-down'}">${formatSigned(d)}</span>` : '');
const nl2br = (t) => esc(t).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
const para = (t) => (t ? `<p>${nl2br(t)}</p>` : '');

// ---------------------------------------------------------------- персонажи (sims)

function statRow(key, value, diff, view, crit) {
    const def = STAT_DEFS[key];
    if (view === 'chips') {
        return `<span class="mi-chip${crit ? ' mi-crit' : ''}" title="${esc(def.label)}">${icon(def.icon)}${value}%${delta(diff)}</span>`;
    }
    return `<div class="mi-stat${crit ? ' mi-crit' : ''}">`
        + `<span class="mi-stat-label">${icon(def.icon)}${esc(def.label)}</span>`
        + `<span class="mi-bar"><span class="mi-bar-fill mi-stat-${key}" style="width:${value}%"></span></span>`
        + `<span class="mi-stat-val">${value}%${delta(diff)}</span>`
        + '</div>';
}

function personCard(p, opts, warnings, { showRel = false } = {}) {
    const view = opts.s.modules.sims.view;
    const crit = new Set(warnings.filter((w) => w.id === p.id).map((w) => w.stat));
    const roleIcon = p.role === 'user' ? 'fa-user' : p.role === 'npc' ? 'fa-user-group' : 'fa-user-tie';
    let h = `<div class="mi-person mi-role-${esc(p.role)}">`;
    h += `<div class="mi-name">${icon(roleIcon)}<span>${esc(p.name)}</span>${p.role === 'npc' ? '<span class="mi-badge">NPC</span>' : ''}</div>`;
    if (p.stats && opts.stats.length) {
        const keys = opts.stats.filter((k) => p.stats[k] !== undefined);
        if (keys.length) {
            h += `<div class="${view === 'chips' ? 'mi-chips' : 'mi-stats'}">`;
            for (const k of keys) h += statRow(k, p.stats[k], p.diff?.[k], view, crit.has(k));
            h += '</div>';
        }
    }
    const tags = [];
    if (p.mood) tags.push(`<span class="mi-tag">${icon('fa-masks-theater')}${esc(p.mood)}</span>`);
    if (p.outfit) tags.push(`<span class="mi-tag">${icon('fa-shirt')}${esc(p.outfit)}</span>`);
    if (tags.length) h += `<div class="mi-tags">${tags.join('')}</div>`;
    if (showRel && typeof p.aff === 'number') h += affBar(p, opts);
    if (p.thought) h += `<div class="mi-thought">${icon('fa-comment-dots')}${esc(p.thought)}</div>`;
    h += '</div>';
    return h;
}

function profileSection(state, people, opts) {
    const cfg = opts.s.modules.sims;
    const rows = people.map((p) => {
        const pr = p.profile ?? {};
        const items = [];
        if (cfg.showProfile) {
            if (pr.birthday) items.push(`<div>${icon('fa-cake-candles')}<span class="mi-k">д/р</span>${esc(pr.birthday)}</div>`);
            if (pr.zodiac) items.push(`<div>${icon('fa-star')}<span class="mi-k">знак</span>${esc(pr.zodiac)}</div>`);
            if (pr.mbti) {
                const code = String(pr.mbti).match(/\b([IE][NS][TF][JP])\b/i)?.[1]?.toUpperCase();
                const desc = String(pr.mbti).replace(/^\s*[IE][NS][TF][JP]\s*[-–—:]?\s*/i, '') || (code ? MBTI[code] : '');
                items.push(`<div>${icon('fa-brain')}<span class="mi-k">MBTI</span><span title="${esc(desc)}">${esc(code ?? pr.mbti)}</span>${desc && code ? `<span class="mi-muted"> · ${esc(desc)}</span>` : ''}</div>`);
            }
        }
        if (cfg.showMoney && p.money !== null && p.money !== undefined) {
            items.push(`<div class="mi-money">${icon('fa-wallet')}<span class="mi-k">деньги</span>${esc(formatMoney(p.money, cfg.currency))}</div>`);
        }
        if (!items.length) return '';
        return `<div class="mi-profile"><div class="mi-profile-name">${esc(p.name)}</div>${items.join('')}</div>`;
    }).filter(Boolean);

    let tx = '';
    if (cfg.showMoney && state.tx?.length) {
        tx = '<div class="mi-tx">' + state.tx.map((t) => `<span class="mi-tx-item ${t.amount > 0 ? 'mi-up' : 'mi-down'}">${esc(formatMoney(t.amount, cfg.currency))}${t.note ? ' · ' + esc(t.note) : ''}<span class="mi-tx-who">${esc(t.who)}</span></span>`).join('') + '</div>';
    }
    if (!rows.length && !tx) return '';
    return `<details class="mi-more"><summary>${icon('fa-circle-info')}Общая информация</summary><div class="mi-profiles">${rows.join('')}</div>${tx}</details>`;
}

// ---------------------------------------------------------------- отношения

function affBar(p, opts) {
    const v = Math.round(p.aff ?? 0);
    const pos = (v + 100) / 2;
    const U = opts.userName || 'User';
    return `<div class="mi-aff" title="Симпатия к ${esc(U)}: ${v} (от −100 до 100)">`
        + `<div class="mi-aff-head"><span>${icon('fa-heart')}${esc(p.rel || 'отношение')}</span><span class="mi-aff-val">${v > 0 ? '+' : ''}${v}${delta(p.affDiff)}</span></div>`
        + `<div class="mi-aff-track"><span class="mi-aff-mark" style="left:${pos}%"></span></div>`
        + '</div>';
}

function relationsPane(state, opts) {
    const scene = new Set(state.scene ?? []);
    const people = People.sortPeople(Object.values(state.people ?? {}).filter((p) => p.role !== 'user' && typeof p.aff === 'number'));
    if (!people.length) return '';
    const simsShowsThoughts = opts.on.sims && opts.s.modules.sims.variant !== 'lite';
    const inScene = people.filter((p) => scene.has(p.id));
    const away = people.filter((p) => !scene.has(p.id));
    const card = (p) => `<div class="mi-person mi-rel-card">`
        + `<div class="mi-name">${icon(p.role === 'npc' ? 'fa-user-group' : 'fa-user-tie')}<span>${esc(p.name)}</span>${scene.has(p.id) ? '' : '<span class="mi-badge">не в сцене</span>'}</div>`
        + (!simsShowsThoughts && p.outfit && scene.has(p.id) ? `<div class="mi-tags"><span class="mi-tag">${icon('fa-shirt')}${esc(p.outfit)}</span></div>` : '')
        + affBar(p, opts)
        + (!simsShowsThoughts && p.thought && scene.has(p.id) ? `<div class="mi-thought">${icon('fa-comment-dots')}${esc(p.thought)}</div>` : '')
        + '</div>';
    let h = `<div class="mi-people">${inScene.map(card).join('')}</div>`;
    if (away.length) h += `<details class="mi-more"><summary>${icon('fa-users')}Не в сцене (${away.length})</summary><div class="mi-people">${away.map(card).join('')}</div></details>`;
    return h;
}

// ---------------------------------------------------------------- слоуберн

function slowPane(state, opts) {
    const sb = state.slow ?? { points: 0, moments: [] };
    const i = Slow.stageIndex(sb.points);
    const st = Slow.STAGES[i];
    const next = Slow.STAGES[i + 1];
    const within = next ? Math.round(((sb.points - st.at) / (next.at - st.at)) * 100) : 100;
    let h = '<div class="mi-slow">';
    h += `<div class="mi-slow-head"><span class="mi-slow-pair">${esc(Slow.targetName(opts))} ${icon('fa-arrows-left-right')} ${esc(opts.userName)}</span>`
        + `<span class="mi-slow-stage">${i + 1}/${Slow.STAGES.length} · ${esc(st.name)}${delta(sb.diff)}</span></div>`;
    h += '<div class="mi-slow-ladder">';
    Slow.STAGES.forEach((stage, k) => {
        h += `<span class="mi-slow-step${k < i ? ' mi-done' : ''}${k === i ? ' mi-now' : ''}" title="${k + 1}. ${esc(stage.name)} — ${esc(stage.ru ?? '')}"></span>`;
    });
    h += '</div>';
    h += `<div class="mi-slow-progress"><span class="mi-bar"><span class="mi-bar-fill mi-slow-fill" style="width:${within}%"></span></span><span class="mi-muted">${next ? `до «${esc(next.name)}»` : 'финал'}</span></div>`;
    h += `<div class="mi-slow-note">${icon('fa-feather')}${esc(st.ru ?? st.now)}</div>`;
    if (sb.moments?.length) {
        h += `<details class="mi-more"><summary>${icon('fa-bookmark')}Ключевые моменты (${sb.moments.length})</summary><ul class="mi-list">`
            + sb.moments.slice().reverse().map((m) => `<li><span class="mi-muted">${esc(m.date)}</span> ${esc(m.text)}</li>`).join('')
            + '</ul></details>';
    }
    h += '</div>';
    return h;
}

// ---------------------------------------------------------------- мир

function worldPane(state, opts) {
    const w = state.world;
    if (!w) return '';
    const cfg = opts.s.modules.world;
    let h = '<div class="mi-world">';
    if (cfg.plot && w.plot) {
        h += `<div class="mi-wrow"><span class="mi-k">${icon('fa-diagram-project')}Сюжет</span><span class="mi-wval">${esc(w.plot)}</span>`
            + `<span class="mi-bar"><span class="mi-bar-fill mi-plot-fill" style="width:${Math.round(w.progress)}%"></span></span><span class="mi-stat-val">${Math.round(w.progress)}%${delta(w.progressDiff)}</span></div>`;
    }
    if (cfg.tension) {
        const t = Math.round(w.tension ?? 0);
        h += `<div class="mi-wrow"><span class="mi-k">${icon('fa-bolt-lightning')}Напряжение</span><span class="mi-wval"></span>`
            + `<span class="mi-bar"><span class="mi-bar-fill mi-tension-fill${t >= 85 ? ' mi-hot' : ''}" style="width:${t}%"></span></span><span class="mi-stat-val">${t}%${delta(w.tensionDiff)}</span></div>`;
    }
    if (w.twist) h += `<div class="mi-twist">${icon('fa-burst')}<b>Поворот:</b> ${esc(w.twist)}</div>`;
    if (cfg.schedule && w.schedule?.length) {
        h += `<div class="mi-sub">${icon('fa-list-check')}Расписание</div><ul class="mi-list mi-schedule">`
            + w.schedule.slice(0, 5).map((e) => `<li><b>${esc(e.at.split(' ')[1] ?? '')}</b>${e.who ? ` <span class="mi-muted">${esc(e.who)}</span>` : ''} — ${esc(e.what)}</li>`).join('')
            + '</ul>';
    }
    if (cfg.rumors && w.rumors?.length) {
        h += `<div class="mi-sub">${icon('fa-comments')}Слухи</div><ul class="mi-list mi-rumors">`
            + w.rumors.map((r) => `<li>«${esc(r.text)}»</li>`).join('')
            + '</ul>';
    }
    if (!cfg.twists || !w.twist) {
        if (w.lastTwist && cfg.twists) h += `<div class="mi-muted mi-small">${icon('fa-clock-rotate-left')}Последний поворот: ${esc(w.lastTwist)}</div>`;
    }
    h += '</div>';
    return h;
}

// ---------------------------------------------------------------- локация

function placePane(state, opts, data) {
    const place = Loc.findPlace(opts.places, state.location);
    if (!place) {
        return state.location ? `<div class="mi-muted">${icon('fa-hourglass')}Описание места «${esc(state.location)}» ещё не готово.</div>` : '';
    }
    const isNew = data?.newPlace && Loc.findPlace({ x: place }, data.newPlace);
    let h = '<div class="mi-place">';
    h += `<div class="mi-place-name">${icon('fa-location-dot')}${esc(place.name)}${isNew ? '<span class="mi-badge">новое место</span>' : ''}</div>`;
    if (place.look) h += `<div class="mi-place-sec"><span class="mi-k">${icon('fa-eye')}Как выглядит</span>${para(place.look)}</div>`;
    if (place.details) h += `<div class="mi-place-sec"><span class="mi-k">${icon('fa-couch')}Что здесь есть</span>${para(place.details)}</div>`;
    if (place.mood) h += `<div class="mi-place-sec"><span class="mi-k">${icon('fa-wind')}Атмосфера</span>${para(place.mood)}</div>`;
    h += '</div>';
    return h;
}

// ---------------------------------------------------------------- следы на теле

function bodyPane(state, opts) {
    const marks = (state.marks ?? []).map((m) => ({ m, st: Marks.markStatus(m, state, opts) })).filter((x) => x.st.permanent || x.st.progress < 1);
    if (!marks.length) return '';
    const groups = new Map();
    for (const x of marks) {
        const key = x.m.who;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(x);
    }
    let h = '<div class="mi-body-marks">';
    for (const [who, list] of groups) {
        h += `<div class="mi-person"><div class="mi-name">${icon('fa-user')}<span>${esc(who)}</span></div><ul class="mi-list mi-marks">`;
        for (const { m, st } of list) {
            const def = Marks.KINDS[m.kind] ?? Marks.KINDS.other;
            const left = st.permanent ? st.stage : `${st.stage} · ещё ~${formatDuration(st.left)}`;
            h += `<li class="mi-mark mi-sev-${m.sev}">${icon(def.icon)}<span class="mi-mark-main"><b>${esc(def.label)}</b> — ${esc(m.where)}${m.note ? ` <span class="mi-muted">(${esc(m.note)})</span>` : ''}</span>`
                + `<span class="mi-mark-meta"><span class="mi-sev" title="тяжесть ${m.sev}/3">${'●'.repeat(m.sev)}${'○'.repeat(3 - m.sev)}</span> ${esc(left)}</span>`
                + (st.permanent ? '' : `<span class="mi-bar mi-heal"><span class="mi-bar-fill" style="width:${Math.round((1 - st.progress) * 100)}%"></span></span>`)
                + '</li>';
        }
        h += '</ul></div>';
    }
    h += '</div>';
    return h;
}

// ---------------------------------------------------------------- дневник

function diaryPane(diary, opts) {
    if (!diary) return '';
    const cfg = opts.s.modules.diary;
    let h = '<div class="mi-diary">';
    h += `<div class="mi-diary-head">${icon('fa-book-open')}<span>${esc(diary.title || 'Дневник')}</span><span class="mi-muted">${esc(diary.date)}</span></div>`;
    h += `<div class="mi-diary-sec mi-diary-main"><div class="mi-diary-title">${icon('fa-pen-nib')}Мои мысли</div>${para(diary.entry)}</div>`;
    if (cfg.aboutUser && diary.aboutUser) {
        h += `<div class="mi-diary-sec mi-diary-user"><div class="mi-diary-title">${icon('fa-heart')}${esc(Extras.diaryAboutTitle(opts.pronoun))}</div>${para(diary.aboutUser)}</div>`;
    }
    if (cfg.npcs && diary.npcs?.length) {
        h += `<div class="mi-diary-sec mi-diary-npc"><div class="mi-diary-title">${icon('fa-users')}Другие</div>`
            + diary.npcs.map((n) => `<div class="mi-diary-npc-entry"><b>${esc(n.name)}:</b>${para(n.entry)}</div>`).join('') + '</div>';
    }
    if (cfg.gossip && diary.gossip) {
        h += `<div class="mi-diary-sec mi-diary-gossip"><div class="mi-diary-title">${icon('fa-comments')}Шепчутся</div>${para(diary.gossip)}</div>`;
    }
    h += '<div class="mi-diary-actions"><span class="mi-act mi-link" data-mi-act="diary" title="Написать запись заново">'
        + `${icon('fa-rotate')}переписать</span></div>`;
    h += '</div>';
    return h;
}

// ---------------------------------------------------------------- телефон

const APP_ICON = {
    telegram: 'fa-brands fa-telegram', whatsapp: 'fa-brands fa-whatsapp', instagram: 'fa-brands fa-instagram',
    twitter: 'fa-brands fa-x-twitter', x: 'fa-brands fa-x-twitter', tinder: 'fa-solid fa-fire', vk: 'fa-brands fa-vk',
    discord: 'fa-brands fa-discord', tiktok: 'fa-brands fa-tiktok', sms: 'fa-solid fa-comment-sms',
};

function phoneBlock(p, opts, state) {
    const ic = APP_ICON[p.app] ?? 'fa-solid fa-mobile-screen';
    const time = state?.time ?? '';
    let h = `<div class="mi-phone mi-phone-${esc(opts.s.modules.phone.style)} mi-app-${esc(p.app)}">`;
    h += `<div class="mi-phone-status"><span>${esc(time)}</span><span>${icon('fa-signal')}${icon('fa-wifi')}${icon('fa-battery-three-quarters')}</span></div>`;
    h += `<div class="mi-phone-bar"><i class="${ic}"></i><span class="mi-phone-title">${esc(p.title || p.app)}</span></div>`;
    h += '<div class="mi-phone-screen">';
    if (p.kind.startsWith('post')) {
        for (const m of p.items) {
            h += '<div class="mi-post">'
                + `<div class="mi-post-author">${icon('fa-circle-user')}${esc(m.from || p.title)}</div>`
                + (m.image ? `<div class="mi-post-img">${icon('fa-image')}<span>${esc(m.image)}</span></div>` : '')
                + (m.text ? `<div class="mi-post-text">${nl2br(m.text)}</div>` : '')
                + `<div class="mi-post-stats">${icon('fa-heart', 'fa-regular')}${esc(m.likes || '0')} ${icon('fa-comment', 'fa-regular')}${esc(m.comments || '0')}${m.time ? `<span class="mi-muted">${esc(m.time)}</span>` : ''}</div>`
                + '</div>';
        }
    } else if (p.kind.startsWith('notif')) {
        for (const m of p.items) {
            h += `<div class="mi-notif"><div class="mi-notif-head"><i class="${ic}"></i><b>${esc(m.from || p.title)}</b><span class="mi-muted">${esc(m.time)}</span></div><div>${nl2br(m.text)}</div></div>`;
        }
    } else {
        for (const m of p.items) {
            h += `<div class="mi-msg mi-msg-${m.dir}">${m.dir === 'in' && m.from ? `<div class="mi-msg-from">${esc(m.from)}</div>` : ''}`
                + `<div class="mi-msg-text">${nl2br(m.text)}</div><div class="mi-msg-time">${esc(m.time)}${m.dir === 'out' ? ' ' + icon('fa-check-double') : ''}</div></div>`;
        }
    }
    h += '</div></div>';
    return h;
}

function phonePane(phone, opts, state) {
    if (!phone?.length) return '';
    return `<div class="mi-phones">${phone.map((p) => phoneBlock(p, opts, state)).join('')}</div>`;
}

// ---------------------------------------------------------------- сборка

/** Список вкладок, у которых есть что показать. */
function buildTabs(data, opts) {
    const state = data?.state;
    const tabs = [];
    const cfg = opts.s.modules;
    if (state) {
        const people = People.scenePeople(state);
        const warnings = People.collectWarnings(state, opts);
        const simsFull = opts.on.sims && cfg.sims.variant !== 'lite';
        if (simsFull && people.length) {
            const main = people.filter((p) => p.role !== 'npc' || !cfg.sims.npcTab);
            const npcs = people.filter((p) => p.role === 'npc');
            if (main.length) {
                tabs.push({
                    key: 'chars', label: 'Персонажи', icon: 'fa-heart-pulse',
                    html: `<div class="mi-people mi-view-${esc(cfg.sims.view)}">${main.map((p) => personCard(p, opts, warnings)).join('')}</div>${profileSection(state, people.filter((p) => p.role !== 'npc'), opts)}`,
                });
            }
            if (cfg.sims.npcTab && npcs.length) {
                tabs.push({
                    key: 'npc', label: 'NPC', icon: 'fa-user-group',
                    html: `<div class="mi-people mi-view-${esc(cfg.sims.view)}">${npcs.map((p) => personCard(p, opts, warnings, { showRel: opts.on.relations })).join('')}</div>`,
                });
            }
        }
        if (opts.on.relations) {
            const html = relationsPane(state, opts);
            if (html) tabs.push({ key: 'rel', label: 'Отношения', icon: 'fa-people-arrows', html });
        }
        if (opts.on.slowburn && state.slow) tabs.push({ key: 'slow', label: 'Слоуберн', icon: 'fa-hourglass-half', html: slowPane(state, opts) });
        if (opts.on.world) {
            const html = worldPane(state, opts);
            if (html) tabs.push({ key: 'world', label: 'Мир', icon: 'fa-earth-europe', html });
        }
        if (opts.on.location && state.location) {
            const html = placePane(state, opts, data);
            if (html) tabs.push({ key: 'place', label: 'Место', icon: 'fa-map-location-dot', html });
        }
        if (opts.on.marks) {
            const html = bodyPane(state, opts);
            if (html) tabs.push({ key: 'body', label: 'Тело', icon: 'fa-band-aid', html });
        }
    }
    if (opts.on.diary && data?.diary) tabs.push({ key: 'diary', label: 'Дневник', icon: 'fa-book-open', html: diaryPane(data.diary, opts) });
    if (opts.on.phone && data?.phone) tabs.push({ key: 'phone', label: 'Телефон', icon: 'fa-mobile-screen', html: phonePane(data.phone, opts, state) });
    if (opts.on.cards && data?.card) tabs.push({ key: 'card', label: 'Карточка', icon: 'fa-wand-magic-sparkles', html: '<div class="mi-card-host" data-mi-card="1"></div>' });
    return tabs;
}

function header(state, { pending, actions }) {
    let h = '<div class="mi-head">';
    h += '<span class="mi-head-main">';
    if (state) {
        const wd = weekday(state.date, state.time);
        const passed = formatDuration(state.elapsed);
        if (state.date) h += `<span>${icon('fa-calendar-days')}${esc([wd, state.date].filter(Boolean).join(', '))}</span>`;
        if (state.time) h += `<span>${icon('fa-clock')}${esc(state.time)}${passed ? `<span class="mi-passed">+${esc(passed)}</span>` : ''}</span>`;
        if (state.weather) h += `<span class="mi-head-sub">${icon('fa-cloud-sun')}${esc(state.weather)}</span>`;
        if (state.location) h += `<span class="mi-head-sub">${icon('fa-location-dot')}${esc(state.location)}</span>`;
    } else {
        h += `<span class="mi-head-sub">${icon('fa-layer-group')}MegaInfo</span>`;
    }
    if (pending) h += `<span class="mi-pending">${icon('fa-spinner fa-spin')}обновляю…</span>`;
    h += '</span>';
    h += `<span class="mi-actions">${actions}</span>`;
    h += '</div>';
    return h;
}

/**
 * HTML панели для сообщения.
 * @param {object} p
 * @returns {string}
 */
export function renderPanel({ data, opts, pending = false, isLast = false, collapsed = false, activeTab = '' }) {
    const s = opts.s;
    const state = data?.state ?? null;
    const err = data?.err;
    const tabs = buildTabs(data, opts);

    let actions = '';
    actions += `<i class="fa-solid fa-rotate mi-act" data-mi-act="regen" title="Пересчитать инфоблок этого сообщения отдельным запросом"></i>`;
    if (state) actions += `<i class="fa-solid fa-pen mi-act" data-mi-act="edit" title="Исправить значения вручную"></i>`;
    if (opts.on.diary && !data?.diary) actions += `<i class="fa-solid fa-book-open mi-act" data-mi-act="diary" title="Написать запись в дневник"></i>`;
    if (tabs.length) actions += `<i class="fa-solid ${collapsed ? 'fa-chevron-down' : 'fa-chevron-up'} mi-act" data-mi-act="toggle" title="Свернуть / развернуть"></i>`;

    if (!state && !tabs.length && !err && !pending) {
        if (!isLast) return '';
        const anyOn = Object.values(opts.on).some(Boolean);
        if (!anyOn) return '';
        return `<div class="mi-panel mi-missing">${icon('fa-circle-plus')}<span>У этого ответа нет инфоблока</span>`
            + '<span class="menu_button mi-act" data-mi-act="regen">Создать</span>'
            + (opts.on.diary ? '<span class="menu_button mi-act" data-mi-act="diary">Дневник</span>' : '')
            + '</div>';
    }

    let h = `<div class="mi-panel${collapsed ? ' mi-collapsed' : ''} mi-layout-${esc(s.layout)}">`;
    h += header(state, { pending, actions });
    if (err && !pending) {
        h += `<div class="mi-error">${icon('fa-triangle-exclamation')}<span>Блок не распознан: ${esc(err.text)}</span>`
            + '<span class="menu_button mi-act" data-mi-act="regen">Повторить</span></div>';
    }
    if (tabs.length && !collapsed) {
        if (s.layout === 'stack') {
            h += '<div class="mi-stack">';
            for (const t of tabs) h += `<details class="mi-sec" open data-mi-sec="${t.key}"><summary>${icon(t.icon)}${esc(t.label)}</summary><div class="mi-pane">${t.html}</div></details>`;
            h += '</div>';
        } else {
            const active = tabs.find((t) => t.key === activeTab) ?? tabs[0];
            h += '<div class="mi-tabs" role="tablist">';
            for (const t of tabs) h += `<span class="mi-tab${t === active ? ' mi-active' : ''}" data-mi-tab="${t.key}" role="tab">${icon(t.icon)}<span class="mi-tab-label">${esc(t.label)}</span></span>`;
            h += '</div>';
            for (const t of tabs) h += `<div class="mi-pane${t === active ? ' mi-active' : ''}" data-mi-pane="${t.key}">${t.html}</div>`;
        }
    }
    h += '</div>';
    return h;
}

/** Вставляет HTML-карточку в Shadow DOM — её стили не ломают таверну. */
export function mountCard(el, html) {
    if (!el || el.shadowRoot) return;
    const purify = globalThis.DOMPurify ?? SillyTavern.libs?.DOMPurify;
    const clean = purify
        ? purify.sanitize(html, { FORCE_BODY: true, ADD_TAGS: ['style'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'textarea'] })
        : '';
    const root = el.attachShadow({ mode: 'open' });
    // иконки Font Awesome внутри карточки
    document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
        if (/fontawesome|font-awesome|\/all\.min\.css/i.test(l.href)) root.appendChild(l.cloneNode());
    });
    const style = document.createElement('style');
    style.textContent = ':host{display:block;max-width:100%;overflow-x:auto}*{box-sizing:border-box;max-width:100%}img{height:auto}';
    root.appendChild(style);
    const wrap = document.createElement('div');
    wrap.innerHTML = clean || '<i>Карточка пуста или заблокирована.</i>';
    root.appendChild(wrap);
}

export { getSettings };
