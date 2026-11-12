// Отрисовка панели инфоблока для одного сообщения: шапка + вкладки (или блоки друг под другом).
// Здесь только HTML-строки — никакой логики подсчёта.

import { STAT_DEFS, getSettings } from './settings.js';
import { Extras, Loc, Marks, People, Slow } from './core/engine.js';
import { trackingFor } from './tracking.js';
import {
    esc, formatDuration, formatMoney, formatSigned, weekday,
} from './util.js';

const MBTI = {
    ISTJ: 'Логист', ISFJ: 'Защитник', INFJ: 'Активист', INTJ: 'Стратег', ISTP: 'Виртуоз', ISFP: 'Артист',
    INFP: 'Посредник', INTP: 'Учёный', ESTP: 'Делец', ESFP: 'Развлекатель', ENFP: 'Борец', ENTP: 'Полемист',
    ESTJ: 'Менеджер', ESFJ: 'Консул', ENFJ: 'Тренер', ENTJ: 'Командир',
};

const MBTI_DESCRIPTION = {
    ISTJ: 'Практичный и последовательный: ценит надёжность, порядок и выполненные обещания; решения принимает по проверенным фактам.',
    ISFJ: 'Внимательный и заботливый: замечает бытовые нужды близких, поддерживает делом и бережно относится к привычным связям.',
    INFJ: 'Проницательный и сдержанный: ищет смысл в поступках, тонко чувствует людей и раскрывается в доверительных отношениях.',
    INTJ: 'Независимый стратег: видит долгосрочные цели, выстраивает планы и предпочитает содержательность внешним условностям.',
    ISTP: 'Наблюдательный практик: спокойно разбирается в сложных ситуациях, любит самостоятельность и проверяет идеи действием.',
    ISFP: 'Чуткий и свободолюбивый: выражает себя через поступки и вкус, живёт текущим моментом и уважает личные границы.',
    INFP: 'Вдумчивый идеалист: опирается на личные ценности, богатое воображение и искренность; чувствителен к внутренним противоречиям.',
    INTP: 'Любознательный аналитик: исследует идеи, замечает логические несостыковки и ценит свободу размышлять без готовых ответов.',
    ESTP: 'Энергичный делец: быстро оценивает обстановку, действует по ситуации, любит практические задачи, азарт и живой контакт.',
    ESFP: 'Открытый и выразительный: легко вовлекается в происходящее, замечает настроение окружающих и оживляет общение.',
    ENFP: 'Увлечённый исследователь: видит возможности, охотно знакомится с людьми и загорается новыми идеями и значимыми связями.',
    ENTP: 'Изобретательный собеседник: испытывает идеи спором, быстро находит альтернативы и любит интеллектуальный вызов.',
    ESTJ: 'Организованный руководитель: берёт ответственность, распределяет задачи и ценит ясные договорённости и ощутимый результат.',
    ESFJ: 'Общительный и участливый: поддерживает связь между людьми, помнит об общих договорённостях и заботится об атмосфере.',
    ENFJ: 'Внимательный вдохновитель: замечает потенциал людей, умеет объединять их и стремится к взаимопониманию.',
    ENTJ: 'Решительный организатор: задаёт направление, мыслит системно и настойчиво превращает замыслы в конкретные действия.',
};

const icon = (name, cls = 'fa-solid') => `<i class="${cls} ${name}"></i>`;
const delta = (d) => (d ? `<span class="mi-delta ${d > 0 ? 'mi-up' : 'mi-down'}">${formatSigned(d)}</span>` : '');
const nl2br = (t) => esc(t).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
const para = (t) => (t ? `<p>${nl2br(t)}</p>` : '');

// ---------------------------------------------------------------- персонажи (sims)

const EMOTIONAL = { label: 'Возбуждение', icon: 'fa-face-smile-beam' };
const CHANGE_KINDS = { time: 'По времени', event: 'В сцене', initial: 'Начальное значение', manual: 'Вручную' };

function pulseMode(opts, key, fallback = 'show') {
    const mode = opts.s.display?.pulse?.[key];
    return ['show', 'collapse', 'hide'].includes(mode) ? mode : fallback;
}

function pulseSection(person, key, label, html, opts, fallback = 'show') {
    if (!html) return '';
    const mode = pulseMode(opts, key, fallback);
    if (mode === 'hide') return '';
    if (mode === 'show') return html;
    return `<details class="mi-pulse-more" data-mi-sec="pulse:${esc(person.id)}:${esc(key)}"><summary>${esc(label)}</summary><div>${html}</div></details>`;
}

function editButton(person, field, label, opts, editable = true) {
    if (!editable || opts.s.display?.editControls === false) return '';
    const title = `Изменить: ${label}`;
    return `<button type="button" class="mi-act mi-field-edit" data-mi-act="edit-field" data-mi-person="${esc(person.id)}" data-mi-field="${esc(field)}" title="${esc(title)}" aria-label="${esc(title)}">${icon('fa-pen')}</button>`;
}

function changeEntries(person, key, state) {
    const entries = Array.isArray(person.changes?.[key]) ? person.changes[key].filter((entry) => entry && typeof entry === 'object') : [];
    if (entries.length) return entries.slice(0, 12);
    if (key === 'money') {
        const tx = (state?.tx ?? []).filter((t) => t.who === person.name || t.who === person.id);
        if (tx.length) return tx.slice(0, 12).map((t) => ({ kind: 'event', delta: t.amount, reason: t.note || 'Операция без описания' }));
    }
    const diff = key === 'aff' ? person.affDiff : person.diff?.[key];
    if (Number.isFinite(diff) && diff !== 0) return [{ kind: 'event', delta: diff, reason: 'Изменение сохранено; причина для этого ответа не указана.' }];
    return [];
}

function reasonText(person, key, state) {
    const entries = changeEntries(person, key, state);
    return entries.length ? entries.map((e) => `${CHANGE_KINDS[e.kind] || 'Изменение'}${Number.isFinite(e.delta) ? ` ${formatSigned(e.delta)}` : ''}: ${String(e.reason || 'Причина не указана.').slice(0, 500)}`).join('\n')
        : 'Нет сохранённых изменений для этого ответа. Старые сообщения могут не содержать причин.';
}

function reasonBody(person, key, state) {
    const entries = changeEntries(person, key, state);
    if (!entries.length) return '<div class="mi-change-empty">Нет сохранённых изменений для этого ответа. В старых сообщениях причины могли не записываться.</div>';
    return '<ul class="mi-change-list">' + entries.map((e) => `<li><span class="mi-change-kind">${esc(CHANGE_KINDS[e.kind] || 'Изменение')}</span>`
        + (Number.isFinite(e.delta) ? `<b class="${e.delta > 0 ? 'mi-up' : e.delta < 0 ? 'mi-down' : 'mi-muted'}">${esc(formatSigned(e.delta))}</b>` : '')
        + `<span>${esc(String(e.reason || 'Причина не указана.').slice(0, 500))}</span>`
        + (Number.isFinite(e.from) && Number.isFinite(e.to) ? `<span class="mi-change-range">${esc(e.from)} → ${esc(e.to)}</span>` : '') + '</li>').join('') + '</ul>';
}

function statRow(person, key, value, diff, view, crit, opts, state, editable) {
    value = Math.round(Math.min(100, Math.max(0, Number(value) || 0)));
    const def = key === 'excitement' ? EMOTIONAL : STAT_DEFS[key];
    if (!def) return '';
    const title = `${def.label}: ${value}%.\n${key === 'excitement' ? 'Радость, азарт и предвкушение; не сексуальная страсть.\n' : ''}${reasonText(person, key, state)}`;
    return `<div class="mi-stat${view === 'chips' ? ' mi-stat-chip' : ''}${crit ? ' mi-crit' : ''}" data-mi-stat="${esc(key)}">`
        + `<details class="mi-stat-change" data-mi-sec="change:${esc(person.id)}:${esc(key)}"><summary title="${esc(title)}">`
        + `<span class="mi-stat-label">${icon(def.icon)}${esc(def.label)}</span>`
        + (view === 'chips' ? '' : `<span class="mi-bar"><span class="mi-bar-fill mi-stat-${esc(key)}" style="width:${value}%"></span></span>`)
        + `<span class="mi-stat-val">${value}%${delta(diff)}${icon('fa-angle-down')}</span></summary>`
        + `<div class="mi-change-body">${reasonBody(person, key, state)}</div></details>`
        + editButton(person, key, def.label, opts, editable) + '</div>';
}

function textField(p, key, label, glyph, value, opts, editable, { thought = false } = {}) {
    const text = value || 'Не указано';
    return `<div class="mi-pulse-field${thought ? ' mi-thought' : ''}"><span class="mi-field-text">${icon(glyph)}<span class="mi-field-caption">${esc(label)}:</span> ${esc(text)}</span>${editButton(p, key, label, opts, editable)}</div>`;
}

function moneyField(p, opts, state, editable) {
    const money = p.money === null || p.money === undefined ? 'Не указано' : formatMoney(p.money, opts.s.modules.sims.currency);
    return `<div class="mi-pulse-field mi-money"><details class="mi-stat-change" data-mi-sec="change:${esc(p.id)}:money"><summary title="${esc(reasonText(p, 'money', state))}"><span class="mi-field-text">${icon('fa-wallet')}Деньги</span><span class="mi-stat-val">${esc(money)}${icon('fa-angle-down')}</span></summary><div class="mi-change-body">${reasonBody(p, 'money', state)}</div></details>${editButton(p, 'money', 'Деньги', opts, editable)}</div>`;
}

function personCard(p, opts, warnings, { showRel = false, editable = true, state } = {}) {
    const tracked = trackingFor(p, opts.s);
    if (tracked.detail === 'off') return '';
    const fields = tracked.fields;
    const view = opts.s.modules.sims.view;
    const crit = new Set(warnings.filter((w) => w.id === p.id).map((w) => w.stat));
    const roleIcon = p.role === 'user' ? 'fa-user' : p.role === 'npc' ? 'fa-user-group' : 'fa-user-tie';
    let h = `<div class="mi-person mi-role-${esc(p.role)}">`;
    h += `<div class="mi-name">${icon(roleIcon)}<span>${esc(p.name)}</span>${p.role === 'npc' ? '<span class="mi-badge">NPC</span>' : ''}</div>`;
    if (fields.stats && p.stats && opts.stats.length) {
        const keys = opts.stats.filter((k) => p.stats[k] !== undefined);
        if (keys.length) {
            const rows = keys.map((k) => statRow(p, k, p.stats[k], p.diff?.[k], view, crit.has(k), opts, state, editable)).join('');
            h += pulseSection(p, 'stats', 'Состояние', `<div class="${view === 'chips' ? 'mi-chips' : 'mi-stats'}">${rows}</div>`, opts);
        }
    }
    if (fields.stats) h += pulseSection(p, 'excitement', 'Эмоциональное возбуждение', statRow(p, 'excitement', p.excitement ?? 0, p.excitementDiff, view, false, opts, state, editable), opts);
    if (fields.mood && (p.mood || editable)) h += pulseSection(p, 'mood', 'Настроение', textField(p, 'mood', 'Настроение', 'fa-masks-theater', p.mood, opts, editable), opts);
    if (fields.outfit && (p.outfit || editable)) h += pulseSection(p, 'outfit', 'Одежда', textField(p, 'outfit', 'Одежда', 'fa-shirt', p.outfit, opts, editable), opts);
    if (fields.money && opts.s.modules.sims.showMoney) h += pulseSection(p, 'money', 'Деньги', moneyField(p, opts, state, editable), opts);
    if (showRel && fields.relations && typeof p.aff === 'number') h += affBar(p, opts);
    const showUserThought = opts.s.modules.sims.userThoughts && (!opts.on.relations || opts.s.modules.relations.thoughts !== false);
    if (fields.thought && (p.thought || editable) && (p.role !== 'user' || showUserThought)) h += pulseSection(p, 'thought', 'Мысли', textField(p, 'thought', 'Мысли', 'fa-comment-dots', p.thought, opts, editable, { thought: true }), opts);
    if (opts.on.pocket && fields.pocket && state) {
        const items = state.pockets?.[p.id] ?? [];
        const text = items.length ? items.map((x) => x.name).join(' · ') : 'Пока пусто';
        const summary = `<div class="mi-pocket-summary">${icon('fa-bag-shopping')}<span><b>Кармашек:</b> ${esc(text)}</span></div>`;
        h += pulseSection(p, 'pocket', 'Кармашек', summary, opts);
    }
    h += '</div>';
    return h;
}

function profileSection(state, people, opts) {
    const cfg = opts.s.modules.sims;
    const rows = people.map((p) => {
        const tracked = trackingFor(p, opts.s);
        if (tracked.detail === 'off' || !tracked.fields.profile) return '';
        const pr = p.profile ?? {};
        const items = [];
        if (cfg.showProfile) {
            items.push(`<div class="mi-profile-line">${icon('fa-cake-candles')}<span class="mi-k">д/р</span><span>${esc(pr.birthday || 'Не указано')}</span>${editButton(p, 'profile.birthday', 'День рождения', opts)}</div>`);
            items.push(`<div class="mi-profile-line">${icon('fa-star')}<span class="mi-k">знак</span><span>${esc(pr.zodiac || 'Не указано')}</span>${editButton(p, 'profile.zodiac', 'Знак зодиака', opts)}</div>`);
            if (pr.mbti) {
                const code = String(pr.mbti).match(/\b([IE][NS][TF][JP])\b/i)?.[1]?.toUpperCase();
                if (code) {
                    const desc = MBTI_DESCRIPTION[code];
                    items.push(`<div class="mi-profile-line"><details class="mi-mbti"><summary title="${esc(desc)}">${icon('fa-brain')}<span class="mi-k">MBTI</span><span>${esc(code)} · ${esc(MBTI[code])}</span></summary><p class="mi-mbti-description">${esc(desc)}</p></details>${editButton(p, 'profile.mbti', 'MBTI', opts)}</div>`);
                } else {
                    items.push(`<div class="mi-profile-line">${icon('fa-brain')}<span class="mi-k">MBTI</span><span>${esc(pr.mbti)}</span>${editButton(p, 'profile.mbti', 'MBTI', opts)}</div>`);
                }
            }
            if (!pr.mbti) items.push(`<div class="mi-profile-line">${icon('fa-brain')}<span class="mi-k">MBTI</span><span>Не указано</span>${editButton(p, 'profile.mbti', 'MBTI', opts)}</div>`);
        }
        if (!items.length) return '';
        return `<div class="mi-profile"><div class="mi-profile-name">${esc(p.name)}</div>${items.join('')}</div>`;
    }).filter(Boolean);

    let tx = '';
    if (cfg.showMoney && pulseMode(opts, 'money') !== 'hide' && state.tx?.length) {
        const visible = state.tx.filter((t) => {
            const p = people.find((x) => t.who === x.id || t.who === x.name);
            return p && trackingFor(p, opts.s).detail !== 'off' && trackingFor(p, opts.s).fields.money;
        });
        if (visible.length) tx = '<div class="mi-tx">' + visible.map((t) => `<span class="mi-tx-item ${t.amount > 0 ? 'mi-up' : 'mi-down'}">${esc(formatMoney(t.amount, cfg.currency))}${t.note ? ' · ' + esc(t.note) : ''}<span class="mi-tx-who">${esc(t.who)}</span></span>`).join('') + '</div>';
    }
    if (!rows.length && !tx) return '';
    const mode = pulseMode(opts, 'profile', 'collapse');
    if (mode === 'hide') return '';
    const body = `<div class="mi-profiles">${rows.join('')}</div>${tx}`;
    return mode === 'collapse' ? `<details class="mi-more" data-mi-sec="profile"><summary>${icon('fa-circle-info')}Общая информация</summary>${body}</details>` : `<section class="mi-pulse-profile"><div class="mi-sub">${icon('fa-circle-info')}Общая информация</div>${body}</section>`;
}

// ---------------------------------------------------------------- отношения

function affBar(p, opts) {
    const v = Math.round(p.aff ?? 0);
    const pos = (v + 100) / 2;
    const U = opts.userName || 'User';
    return `<div class="mi-aff" title="Симпатия к ${esc(U)}: ${v} (от −100 до 100)">`
        + `<details class="mi-aff-changes" data-mi-sec="change:${esc(p.id)}:aff"><summary class="mi-aff-head" title="${esc(reasonText(p, 'aff'))}"><span>${icon('fa-heart')}${esc(p.rel || 'отношение')}</span><span class="mi-aff-val">${v > 0 ? '+' : ''}${v}${delta(p.affDiff)}${icon('fa-angle-down')}</span></summary><div class="mi-change-body">${reasonBody(p, 'aff')}</div></details>`
        + `<div class="mi-aff-track"><span class="mi-aff-mark" style="left:${pos}%"></span></div>`
        + '</div>';
}

function relationsPane(state, opts) {
    const scene = new Set(state.scene ?? []);
    const people = People.sortPeople(Object.values(state.people ?? {}).filter((p) => p.role !== 'user' && typeof p.aff === 'number' && trackingFor(p, opts.s).detail !== 'off' && trackingFor(p, opts.s).fields.relations));
    if (!people.length) return '';
    const simsShowsThoughts = opts.on.sims && opts.s.modules.sims.variant !== 'lite';
    // Основная пара всегда выше NPC, даже если персонаж временно вне сцены.
    const inScene = people.filter((p) => p.role === 'char' || scene.has(p.id));
    const away = people.filter((p) => p.role !== 'char' && !scene.has(p.id));
    const card = (p) => `<div class="mi-person mi-rel-card">`
        + `<div class="mi-name">${icon(p.role === 'npc' ? 'fa-user-group' : 'fa-user-tie')}<span>${esc(p.name)} ↔ ${esc(opts.userName || 'User')}</span>${scene.has(p.id) ? '' : '<span class="mi-badge">не в сцене</span>'}</div>`
        + (!simsShowsThoughts && trackingFor(p, opts.s).fields.outfit && p.outfit && scene.has(p.id) ? `<div class="mi-tags"><span class="mi-tag">${icon('fa-shirt')}${esc(p.outfit)}</span></div>` : '')
        + affBar(p, opts)
        + (!simsShowsThoughts && trackingFor(p, opts.s).fields.thought && p.thought && scene.has(p.id) ? `<div class="mi-thought">${icon('fa-comment-dots')}${esc(p.thought)}</div>` : '')
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
    if (cfg.threads !== false && w.threads?.length) {
        h += `<section class="mi-threads"><div class="mi-sub">${icon('fa-link')}Нити сюжета</div><ul class="mi-thread-list">`
            + w.threads.map((thread) => `<li class="mi-thread"><div class="mi-thread-main"><span>${esc(thread.text)}</span><button type="button" class="mi-act mi-item-action" data-mi-act="thread-dismiss" data-mi-thread="${esc(thread.id)}" title="Убрать нить сюжета" aria-label="Убрать нить сюжета: ${esc(thread.text)}">${icon('fa-xmark')}</button></div>`
                + (thread.endings?.length ? `<details class="mi-thread-endings" data-mi-sec="thread:${esc(thread.id)}"><summary>Возможные завершения</summary><ul>${thread.endings.slice(0, 5).map((ending) => `<li>${esc(ending)}</li>`).join('')}</ul><div class="mi-muted mi-small">Варианты, а не предрешённые события.</div></details>` : '') + '</li>').join('') + '</ul></section>';
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
    const marks = (state.marks ?? []).filter((m) => Marks.isTracked(m, opts)).map((m) => ({ m, st: Marks.markStatus(m, state, opts) })).filter((x) => x.st.permanent || x.st.progress < 1);
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
            const sev = Math.min(3, Math.max(1, Math.round(Number(m.sev) || 1)));
            const removeTitle = `Убрать след: ${def.label}, ${m.where}`;
            h += `<li class="mi-mark mi-sev-${sev}">${icon(def.icon)}<span class="mi-mark-main"><b>${esc(def.label)}</b> — ${esc(m.where)}${m.note ? ` <span class="mi-muted">(${esc(m.note)})</span>` : ''}</span>`
                + `<button type="button" class="mi-act mi-mark-remove" data-mi-act="remove-mark" data-mi-mark="${esc(m.id)}" title="${esc(removeTitle)}" aria-label="${esc(removeTitle)}">${icon('fa-xmark')}</button>`
                + `<span class="mi-mark-meta"><span class="mi-sev" title="тяжесть ${sev}/3">${'●'.repeat(sev)}${'○'.repeat(3 - sev)}</span> ${esc(left)}</span>`
                + (st.permanent ? '' : `<span class="mi-bar mi-heal"><span class="mi-bar-fill" style="width:${Math.round((1 - st.progress) * 100)}%"></span></span>`)
                + '</li>';
        }
        h += '</ul></div>';
    }
    h += '</div>';
    return h;
}

// ---------------------------------------------------------------- дневник

export function renderDiary(diary, opts) {
    if (!diary) return '';
    const cfg = opts.s.modules.diary;
    let h = '<div class="mi-diary">';
    h += `<div class="mi-diary-head">${icon('fa-book-open')}<span>${esc(diary.title || 'Заметки')}</span><span class="mi-muted">${esc(diary.date)}</span></div>`;
    h += `<div class="mi-diary-sec mi-diary-main"><div class="mi-diary-title">${icon('fa-pen-nib')}Личное</div>${para(diary.entry)}</div>`;
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

export function renderPhone(phone, opts, state) {
    if (!phone?.length) return '';
    return `<div class="mi-phones">${phone.map((p) => phoneBlock(p, opts, state)).join('')}</div>`;
}

// ---------------------------------------------------------------- важные вещи

function pocketPane(state, opts) {
    const known = People.sortPeople(Object.values(state.people ?? {}));
    const owners = known.filter((p) => {
        const track = trackingFor(p, opts.s);
        return track.detail !== 'off' && track.fields.pocket
            && (p.role !== 'npc' || track.detail === 'full' || (state.pockets?.[p.id]?.length ?? 0) > 0);
    });
    if (!owners.length) return '';
    const limit = Math.min(20, Math.max(1, Math.round(Number(opts.s.modules.pocket?.maxItems) || 5)));
    const action = (name, label, glyph, person, item) => `<button type="button" class="mi-act mi-item-action" data-mi-act="${name}" data-mi-person="${esc(person.id)}"${item ? ` data-mi-item="${esc(item.id)}"` : ''} title="${esc(label)}" aria-label="${esc(label)}">${icon(glyph)}</button>`;
    return '<div class="mi-pockets"><div class="mi-muted mi-small">Значимые вещи при себе — подарки, улики, памятные мелочи.</div>'
        + owners.map((p) => {
            const items = (state.pockets?.[p.id] ?? []).slice(0, limit);
            let h = `<section class="mi-person mi-pocket-owner"><div class="mi-pocket-heading"><div class="mi-name">${icon('fa-bag-shopping')}<span>${esc(p.name)}</span></div><span class="mi-pocket-count">${items.length}/${limit}</span>`
                + (items.length < limit ? action('pocket-add', `Добавить вещь: ${p.name}`, 'fa-plus', p) : '') + '</div>';
            if (!items.length) h += '<div class="mi-muted mi-small">Пока пусто. Можно добавить свою вещь.</div>';
            else h += '<ul class="mi-pocket-list">' + items.map((item) => `<li><div class="mi-pocket-item"><span class="mi-pocket-name">${esc(item.name)}</span><span class="mi-item-actions">${action('pocket-edit', `Изменить вещь: ${item.name}`, 'fa-pen', p, item)}${action('pocket-remove', `Убрать вещь: ${item.name}`, 'fa-xmark', p, item)}</span></div>${item.note ? `<div class="mi-pocket-note">${esc(item.note)}</div>` : ''}</li>`).join('') + '</ul>';
            return h + '</section>';
        }).join('') + '</div>';
}

// ---------------------------------------------------------------- сборка

/** Список вкладок, у которых есть что показать. */
function buildTabs(data, opts) {
    const state = data?.state;
    const tabs = [];
    const cfg = opts.s.modules;
    if (state) {
        const people = People.scenePeople(state).filter((p) => trackingFor(p, opts.s).detail !== 'off');
        const warnings = People.collectWarnings(state, opts);
        const simsFull = opts.on.sims && cfg.sims.variant !== 'lite';
        if (simsFull && people.length) {
            const main = people.filter((p) => p.role !== 'npc' || !cfg.sims.npcTab);
            const npcs = people.filter((p) => p.role === 'npc');
            if (main.length) {
                tabs.push({
                    key: 'chars', label: 'Пульс', icon: 'fa-heart-pulse',
                    html: `<div class="mi-people mi-view-${esc(cfg.sims.view)}">${main.map((p) => personCard(p, opts, warnings, { state })).join('')}</div>${profileSection(state, main, opts)}`,
                });
            }
            if (cfg.sims.npcTab && npcs.length) {
                tabs.push({
                    key: 'npc', label: 'Окружение', icon: 'fa-user-group',
                    html: `<div class="mi-people mi-view-${esc(cfg.sims.view)}">${npcs.map((p) => personCard(p, opts, warnings, { showRel: opts.on.relations, editable: false, state })).join('')}</div>`,
                });
            }
        }
        if (opts.on.relations) {
            const html = relationsPane(state, opts);
            if (html) tabs.push({ key: 'rel', label: 'Связи', icon: 'fa-people-arrows', html });
        }
        if (opts.on.slowburn && state.slow) tabs.push({ key: 'slow', label: 'Slow burn', icon: 'fa-heart', html: slowPane(state, opts) });
        if (opts.on.world) {
            const html = worldPane(state, opts);
            if (html) tabs.push({ key: 'world', label: 'Сюжет', icon: 'fa-earth-europe', html });
        }
        if (opts.on.location && state.location) {
            const html = placePane(state, opts, data);
            if (html) tabs.push({ key: 'place', label: 'Места', icon: 'fa-map-location-dot', html });
        }
        if (opts.on.marks) {
            const html = bodyPane(state, opts);
            if (html) tabs.push({ key: 'body', label: 'Следы', icon: 'fa-band-aid', html });
        }
        if (opts.on.pocket) {
            const html = pocketPane(state, opts);
            if (html) tabs.push({ key: 'pocket', label: 'Кармашек', icon: 'fa-bag-shopping', html });
        }
    }
    const order = Array.isArray(opts.s.display?.tabOrder) ? opts.s.display.tabOrder : [];
    return tabs.sort((a, b) => {
        const ai = order.indexOf(a.key), bi = order.indexOf(b.key);
        return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
    });
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
    if (state) actions += `<i class="fa-solid fa-pen mi-act" data-mi-act="edit" title="Исправить данные инфоблока целиком"></i>`;
    if (opts.on.diary && !data?.diary) actions += `<i class="fa-solid fa-book-open mi-act" data-mi-act="diary" title="Добавить личную заметку"></i>`;
    if (tabs.length) actions += `<i class="fa-solid ${collapsed ? 'fa-chevron-down' : 'fa-chevron-up'} mi-act" data-mi-act="toggle" title="Свернуть / развернуть"></i>`;

    if (!state && !tabs.length && !err && !pending) {
        if (!isLast) return '';
        const anyOn = Object.values(opts.on).some(Boolean);
        if (!anyOn) return '';
        return `<div class="mi-panel mi-missing">${icon('fa-circle-plus')}<span>У этого ответа нет инфоблока</span>`
            + '<span class="menu_button mi-act" data-mi-act="regen">Создать</span>'
            + (opts.on.diary ? '<span class="menu_button mi-act" data-mi-act="diary">Заметки</span>' : '')
            + '</div>';
    }

    let h = `<div class="mi-panel${collapsed ? ' mi-collapsed' : ''} mi-layout-${esc(s.layout)}">`;
    h += header(state, { pending, actions });
    if (!collapsed && opts.on.relations && state) {
        const main = People.sortPeople(Object.values(state.people ?? {})).find((p) => p.role === 'char' && typeof p.aff === 'number' && trackingFor(p, opts.s).detail !== 'off' && trackingFor(p, opts.s).fields.relations);
        if (main) h += `<div class="mi-main-relation"><div class="mi-name">${icon('fa-heart')}<span>${esc(main.name)} ↔ ${esc(opts.userName || 'User')}</span></div>${affBar(main, opts)}</div>`;
    }
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
