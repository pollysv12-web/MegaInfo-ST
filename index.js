// MegaInfo — инфоблоки для SillyTavern.
// Точка входа: подписки на события таверны, вставка инструкций в промпт, отрисовка блоков.

import { MODULE, getSettings, saveSettings } from './src/settings.js';
import { getData, getMessage, lastBotMessageId, saveChat, setData, setMessageText } from './src/store.js';
import { ALL_TAGS } from './src/request.js';
import { findTagBlock, stripTagBlocks } from './src/util.js';
import * as Sims from './src/sims.js';
import { initSettingsUi, refreshTokenStats } from './src/ui-settings.js';

const PROMPT_KEY = 'megainfo_sims';
const LOG = '[MegaInfo]';

/** Сообщения, для которых сейчас идёт отдельный запрос: id -> Promise */
const pending = new Map();

const ctx = () => SillyTavern.getContext();

// ------------------------------------------------------------------ промпт

function clearInjection() {
    const c = ctx();
    c.setExtensionPrompt(PROMPT_KEY, '', 1, 0);
}

function updateInjection(type) {
    const c = ctx();
    const s = getSettings();
    if (!Sims.isEnabled() || s.sims.mode === 'separate' || ['quiet', 'impersonate'].includes(type)) {
        clearInjection();
        return '';
    }
    // При свайпе/продолжении последнее сообщение переписывается — состояние берём до него.
    const beforeId = (type === 'swipe' || type === 'continue') ? c.chat.length - 1 : c.chat.length;
    const text = Sims.inlinePrompt(beforeId);
    c.setExtensionPrompt(PROMPT_KEY, text, 1 /* IN_CHAT */, Number(s.sims.depth) || 0, false, 0 /* SYSTEM */);
    return text;
}

/**
 * Вызывается таверной перед каждой генерацией (см. generate_interceptor в manifest.json).
 * chat здесь — копии сообщений, их можно менять, не трогая сам чат.
 */
globalThis.megaInfoInterceptor = async function (chat, _contextSize, _abort, type) {
    try {
        if (!getSettings().enabled) {
            clearInjection();
            return;
        }
        // 1. Чистим историю от блоков — модель их не видит, токены не тратятся.
        for (const m of chat) {
            if (typeof m?.mes === 'string' && /<\w/.test(m.mes)) m.mes = stripTagBlocks(m.mes, ALL_TAGS);
        }
        // 2. Если ещё не закончился отдельный запрос за блоком — подождём (до 25 сек), чтобы состояние было свежим.
        if (pending.size && type !== 'quiet') {
            await Promise.race([
                Promise.allSettled([...pending.values()]),
                new Promise((r) => setTimeout(r, 25000)),
            ]);
        }
        // 3. Вставляем инструкцию + текущее состояние.
        updateInjection(type);
    } catch (e) {
        console.error(LOG, 'interceptor failed', e);
    }
};

// ------------------------------------------------------------------ обработка ответов

function isBotMessage(m) {
    return m && !m.is_user && !m.is_system;
}

async function onMessageReceived(messageId, type) {
    const s = getSettings();
    if (!s.enabled || type === 'impersonate') return;
    const id = Number(messageId);
    const message = getMessage(id);
    if (!isBotMessage(message)) return;

    let changed = false;
    let simsResult = 'none';

    if (findTagBlock(message.mes, 'sims')) {
        if (Sims.isEnabled()) simsResult = Sims.applyFromText(id, message, message.mes);
        setMessageText(message, stripTagBlocks(message.mes, ALL_TAGS));
        ctx().updateMessageBlock(id, message);
        changed = true;
    }

    if (changed) await saveChat();
    render(id);

    if (!Sims.isEnabled() || type === 'first_message') return;
    const mode = s.sims.mode;
    const hadData = !!getData(message)?.sims;
    const needSeparate = mode === 'separate'
        ? simsResult !== 'ok'
        : mode === 'auto' && (simsResult === 'error' || (simsResult === 'none' && !(type === 'continue' && hadData)));
    if (needSeparate) runSeparate(id);
}

/** Запускает отдельный запрос за блоком sims (не блокирует интерфейс). */
function runSeparate(messageId) {
    if (pending.has(messageId)) return pending.get(messageId);
    const c = ctx();
    const message = getMessage(messageId);
    if (!message) return null;
    const chatId = c.getCurrentChatId();
    const swipeId = message.swipe_id;

    const job = (async () => {
        try {
            const result = await Sims.requestSeparate(messageId, message, () =>
                ctx().getCurrentChatId() === chatId && getMessage(messageId) === message && message.swipe_id === swipeId);
            if (result === 'stale') return;
            await saveChat();
            if (result === 'error') toastr.warning('Модель вернула неразборчивый блок sims. Можно нажать ⟳ ещё раз.', 'MegaInfo');
        } catch (e) {
            console.error(LOG, 'separate request failed', e);
            toastr.error(String(e?.cause?.message || e?.message || e), 'MegaInfo: не удалось получить блок');
        }
    })();

    pending.set(messageId, job);
    render(messageId);
    job.finally(() => {
        pending.delete(messageId);
        render(messageId);
        refreshTokenStats();
    });
    return job;
}

async function onMessageEdited(messageId) {
    const id = Number(messageId);
    const message = getMessage(id);
    if (!isBotMessage(message) || !getSettings().enabled) return;
    // Если блок вписали руками при редактировании — применяем его.
    if (findTagBlock(message.mes, 'sims')) {
        if (Sims.isEnabled()) Sims.applyFromText(id, message, message.mes);
        setMessageText(message, stripTagBlocks(message.mes, ALL_TAGS));
        ctx().updateMessageBlock(id, message);
        await saveChat();
    }
    render(id);
}

// ------------------------------------------------------------------ отрисовка

function shouldShow(messageId) {
    const s = getSettings();
    const n = Number(s.showOnLast) || 0;
    if (n <= 0) return true;
    return messageId >= ctx().chat.length - n;
}

function render(messageId) {
    const id = Number(messageId);
    const $mes = $(`#chat .mes[mesid="${id}"]`);
    if (!$mes.length) return;
    const $block = $mes.find('.mes_block').first();
    $block.children('.mi-host').remove();

    const s = getSettings();
    const message = getMessage(id);
    if (!s.enabled || !isBotMessage(message)) return;

    let html = '';
    if (pending.has(id)) {
        html += '<div class="mi-block mi-pending"><i class="fa-solid fa-spinner fa-spin"></i><span>Обновляю инфоблок…</span></div>';
    } else if (Sims.isEnabled() && shouldShow(id)) {
        html += Sims.renderHtml(message);
        if (!getData(message)?.sims && !getData(message)?.simsError && id === lastBotMessageId()) {
            html += '<div class="mi-block mi-missing"><i class="fa-solid fa-circle-plus"></i>'
                + '<span>У этого сообщения нет блока sims</span>'
                + '<button class="menu_button mi-act" data-mi-act="regen" data-mi-mod="sims">Создать</button></div>';
        }
    }
    if (!html) return;

    const $host = $(`<div class="mi-host mi-style-${s.style}"></div>`).html(html);
    const $text = $block.children('.mes_text');
    if (s.placement === 'bottom') $text.after($host);
    else $text.before($host);
}

export function renderAll() {
    const { chat } = ctx();
    $('#chat .mes').each(function () {
        const id = Number($(this).attr('mesid'));
        if (Number.isFinite(id) && id < chat.length) render(id);
    });
}

// ------------------------------------------------------------------ кнопки в блоках

async function editState(messageId) {
    const c = ctx();
    const message = getMessage(messageId);
    const state = getData(message)?.sims;
    if (!state) return;
    const value = await c.callGenericPopup(
        '<b>Значения блока sims</b><br><small>Можно поправить числа, деньги, имена. Сохраняется только для этого сообщения; следующие блоки будут считаться от него.</small>',
        c.POPUP_TYPE.INPUT,
        JSON.stringify(state, null, 2),
        { rows: 22, wide: true, large: true, okButton: 'Сохранить', cancelButton: 'Отмена' },
    );
    if (!value || typeof value !== 'string') return;
    try {
        const parsed = JSON.parse(value);
        setData(message, 'sims', parsed);
        await saveChat();
        render(messageId);
        toastr.success('Сохранено', 'MegaInfo');
    } catch (e) {
        toastr.error('Не получилось прочитать JSON: ' + e.message, 'MegaInfo');
    }
}

function onActionClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const $btn = $(event.currentTarget);
    const id = Number($btn.closest('.mes').attr('mesid'));
    if (!Number.isFinite(id)) return;
    const act = $btn.data('mi-act');
    if (act === 'regen') runSeparate(id);
    if (act === 'edit') editState(id);
}

// ------------------------------------------------------------------ запуск

function registerFormatterHook() {
    // Прячет сырой <sims>{...} прямо во время печати ответа (SillyTavern 1.13.5+).
    const formatter = ctx().messageFormatter;
    if (!formatter?.addHook) return;
    formatter.addHook((mes, info) => {
        if (info?.isUser || !getSettings().enabled || !getSettings().hideWhileStreaming) return mes;
        if (!/<\w/.test(mes)) return mes;
        return stripTagBlocks(mes, ALL_TAGS);
    }, { stage: formatter.stage?.BEFORE_REGEX ?? 'beforeRegex' });
}

async function init() {
    const c = ctx();
    const { eventSource, eventTypes: E } = c;
    getSettings();

    await initSettingsUi({
        onChange: () => {
            saveSettings();
            renderAll();
            updateInjection('normal');
            refreshTokenStats();
        },
        getInjectionText: () => (Sims.isEnabled() && getSettings().sims.mode !== 'separate') ? Sims.inlinePrompt(ctx().chat.length) : '',
    });

    try {
        registerFormatterHook();
    } catch (e) {
        console.warn(LOG, 'formatter hook unavailable', e);
    }

    eventSource.on(E.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(E.CHARACTER_MESSAGE_RENDERED, () => renderAll());
    eventSource.on(E.USER_MESSAGE_RENDERED, () => renderAll());
    eventSource.on(E.MESSAGE_SWIPED, (id) => setTimeout(() => render(Number(id)), 0));
    eventSource.on(E.MESSAGE_EDITED, onMessageEdited);
    eventSource.on(E.MESSAGE_UPDATED, (id) => render(Number(id)));
    eventSource.on(E.MESSAGE_DELETED, () => setTimeout(renderAll, 0));
    eventSource.on(E.MORE_MESSAGES_LOADED, () => setTimeout(renderAll, 0));
    eventSource.on(E.CHAT_CHANGED, () => {
        pending.clear();
        setTimeout(() => {
            renderAll();
            refreshTokenStats();
        }, 100);
    });
    eventSource.on(E.GENERATION_ENDED, () => refreshTokenStats());

    $(document).on('click', '.mi-host .mi-act', onActionClick);

    renderAll();
    console.log(LOG, 'loaded', MODULE);
}

jQuery(() => {
    init().catch((e) => console.error(LOG, 'init failed', e));
});
