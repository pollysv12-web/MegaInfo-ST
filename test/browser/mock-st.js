// Мини-макет SillyTavern: только то, чем пользуется расширение. Поведение повторяет исходники ST 1.19
// (порядок событий, копии сообщений в перехватчике, регулярки до MESSAGE_RECEIVED, swipe_info).
(function () {
    const listeners = {};
    const eventSource = {
        on(ev, fn) { (listeners[ev] ??= []).push(fn); },
        async emit(ev, ...args) { for (const fn of listeners[ev] ?? []) await fn(...args); },
    };
    const eventTypes = {
        MESSAGE_RECEIVED: 'message_received', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
        USER_MESSAGE_RENDERED: 'user_message_rendered', MESSAGE_SWIPED: 'message_swiped', MESSAGE_EDITED: 'message_edited',
        MESSAGE_UPDATED: 'message_updated', MESSAGE_DELETED: 'message_deleted', MORE_MESSAGES_LOADED: 'more_messages_loaded',
        CHAT_CHANGED: 'chat_id_changed', GENERATION_ENDED: 'generation_ended',
    };
    const hooks = { beforeRegex: [], afterRegex: [], afterMarkdown: [] };
    const extension_prompts = {};
    const state = {
        chat: [], chatMetadata: {}, chatId: 'chat-1', extensionSettings: {}, name1: 'Миша', name2: 'Алекс',
        prompts: [], quietPrompts: [], saves: 0,
        // имитация пользовательской регулярки, которая режет теги из ответа (как у многих после скриптов Кисы)
        outputRegex: null,
        model: null, // function(kind, payload) -> string
    };
    const saved = sessionStorage.getItem('megainfo-harness-reload');
    if (saved) {
        Object.assign(state, JSON.parse(saved));
        sessionStorage.removeItem('megainfo-harness-reload');
        document.addEventListener('DOMContentLoaded', () => {
            state.chat.forEach((_, id) => renderMessage(id));
        });
    }
    window.__persistForReload = () => sessionStorage.setItem('megainfo-harness-reload', JSON.stringify({
        chat: state.chat, chatMetadata: state.chatMetadata, chatId: state.chatId,
        extensionSettings: state.extensionSettings, name1: state.name1, name2: state.name2,
    }));
    window.__st = state;

    function format(mes, isUser) {
        let m = mes;
        for (const h of hooks.beforeRegex) m = h.fn(m, { isUser });
        return m.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }

    function renderMessage(id) {
        const m = state.chat[id];
        let $el = $(`#chat .mes[mesid="${id}"]`);
        if (!$el.length) {
            $el = $(`<div class="mes" mesid="${id}"><div class="mes_block"><div class="ch_name">${m.name}</div><div class="mes_text"></div><div class="mes_bias"></div></div></div>`);
            $('#chat').append($el);
        }
        $el.find('.mes_text').html(format(m.extra?.display_text ?? m.mes, m.is_user));
    }

    function getContext() {
        return {
            chat: state.chat,
            chatMetadata: state.chatMetadata,
            extensionSettings: state.extensionSettings,
            name1: state.name1,
            name2: state.name2,
            characterId: 0,
            groupId: null,
            mainApi: 'openai',
            powerUserSettings: { persona_description: 'Миша — парень 24 лет, бариста.' },
            eventSource, eventTypes,
            getCurrentChatId: () => state.chatId,
            setExtensionPrompt(key, value, position, depth, scan, role) {
                extension_prompts[key] = { value: String(value), position, depth, role };
            },
            saveSettingsDebounced() {},
            saveMetadataDebounced() {},
            async saveChat() { state.saves++; },
            updateMessageBlock(id) { renderMessage(id); },
            async getTokenCountAsync(t) { return Math.ceil(String(t ?? '').length / 4); },
            async callGenericPopup() { return null; },
            POPUP_TYPE: { TEXT: 1, CONFIRM: 2, INPUT: 3 },
            messageFormatter: {
                stage: { BEFORE_REGEX: 'beforeRegex' },
                addHook(fn, { stage = 'afterMarkdown' } = {}) { hooks[stage].push({ fn }); },
            },
            async generateRaw({ prompt, systemPrompt }) {
                state.quietPrompts.push({ system: systemPrompt, prompt });
                // как Gemini через OpenRouter: запрос, который кончается ответом бота, — Bad Request
                if (prompt.at(-1)?.role !== 'user') throw new Error('Bad Request');
                if (window.__rawFailWithHistory && prompt.length > 1) throw new Error('Bad Request');
                return state.model('raw', { system: systemPrompt, user: prompt.at(-1).content });
            },
            async generateQuietPrompt({ quietPrompt }) {
                const core = await buildPrompt('quiet');
                state.quietPrompts.push({ system: quietPrompt, core });
                return state.model('raw', { system: quietPrompt, user: core.map((m) => m.mes).join('\n') });
            },
        };
    }
    window.SillyTavern = { getContext, libs: { DOMPurify: window.DOMPurify } };
    window.toastr = { info() {}, success() {}, warning(m) { console.warn('TOAST', m); }, error(m) { console.error('TOAST', m); } };

    async function runInterceptor(coreChat, type) {
        if (typeof globalThis.megaInfoInterceptor === 'function') await globalThis.megaInfoInterceptor(coreChat, 100000, () => {}, type);
    }

    async function buildPrompt(type) {
        let coreChat = state.chat.filter((x) => !x.is_system);
        if (type === 'swipe') coreChat = coreChat.slice(0, -1);
        coreChat = coreChat.map((x, index) => ({ ...x, index }));
        await runInterceptor(coreChat, type);
        return coreChat;
    }

    function applyOutputRegex(text) {
        return state.outputRegex ? text.replace(state.outputRegex, '') : text;
    }

    /** Имитирует отправку сообщения пользователем и ответ модели (без стриминга). */
    window.__send = async function (userText, type = 'normal') {
        if (type === 'normal') {
            state.chat.push({ name: state.name1, is_user: true, mes: userText, extra: {}, send_date: Date.now() });
            renderMessage(state.chat.length - 1);
            await eventSource.emit(eventTypes.USER_MESSAGE_RENDERED, state.chat.length - 1);
        }
        const core = await buildPrompt(type);
        const inj = extension_prompts.megainfo_inject?.value ?? '';
        state.prompts.push({ history: core.map((m) => m.mes), injection: inj, type });
        let text = state.model('main', { injection: inj, history: core });
        text = applyOutputRegex(text);
        if (type === 'continue') {
            const id = state.chat.length - 1;
            const msg = state.chat[id];
            msg.mes = msg.mes + ' ' + text;
            await eventSource.emit(eventTypes.MESSAGE_RECEIVED, id, 'continue');
            renderMessage(id);
            await eventSource.emit(eventTypes.CHARACTER_MESSAGE_RENDERED, id, 'continue');
        } else if (type === 'swipe') {
            const id = state.chat.length - 1;
            const msg = state.chat[id];
            msg.swipes.push(text);
            msg.swipe_info.push({ extra: structuredClone(msg.extra) });
            msg.swipe_id = msg.swipes.length - 1;
            msg.mes = text;
            await eventSource.emit(eventTypes.MESSAGE_RECEIVED, id, 'swipe');
            renderMessage(id);
            await eventSource.emit(eventTypes.CHARACTER_MESSAGE_RENDERED, id, 'swipe');
            msg.swipes[msg.swipe_id] = msg.mes;
            msg.swipe_info[msg.swipe_id] = { extra: structuredClone(msg.extra) };
        } else {
            state.chat.push({ name: state.name2, is_user: false, mes: text, extra: {}, send_date: Date.now() });
            const id = state.chat.length - 1;
            await eventSource.emit(eventTypes.MESSAGE_RECEIVED, id, type);
            renderMessage(id);
            await eventSource.emit(eventTypes.CHARACTER_MESSAGE_RENDERED, id, type);
            const item = state.chat[id];
            item.swipe_id = 0;
            item.swipes = [item.mes];
            item.swipe_info = [{ extra: structuredClone(item.extra) }];
        }
        await eventSource.emit(eventTypes.GENERATION_ENDED);
    };

    /** Свайп назад к предыдущему варианту (таверна восстанавливает extra из swipe_info). */
    window.__swipeLeft = async function () {
        const id = state.chat.length - 1;
        const msg = state.chat[id];
        msg.swipe_id -= 1;
        msg.mes = msg.swipes[msg.swipe_id];
        msg.extra = structuredClone(msg.swipe_info[msg.swipe_id].extra);
        renderMessage(id);
        await eventSource.emit(eventTypes.MESSAGE_SWIPED, id);
    };

    /** Новый чат с приветствием. */
    window.__newChat = async function (id, greeting) {
        state.chat.length = 0;
        for (const k of Object.keys(state.chatMetadata)) delete state.chatMetadata[k];
        state.chatId = id;
        $('#chat').empty();
        state.chat.push({ name: state.name2, is_user: false, mes: greeting, extra: {}, swipe_id: 0, swipes: [greeting], swipe_info: [{ extra: {} }] });
        renderMessage(0);
        await eventSource.emit(eventTypes.CHAT_CHANGED, id);
        await eventSource.emit(eventTypes.MESSAGE_RECEIVED, 0, 'first_message');
        await eventSource.emit(eventTypes.CHARACTER_MESSAGE_RENDERED, 0, 'first_message');
    };
})();
