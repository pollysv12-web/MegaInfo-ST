// Быстрое меню (кнопка в меню «волшебной палочки»): включить/выключить блоки и настройки только этого чата.

import {
    MODULE_LIST, getChatOverrides, getSettings, saveChatOverrides, saveSettings,
} from './settings.js';
import { esc } from './util.js';

const TRI = [['inherit', 'как везде'], ['on', 'вкл'], ['off', 'выкл']];

function select(name, value, options) {
    return `<select class="text_pole" data-mi-quick="${name}">${options.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

export async function openQuickMenu(onChange) {
    const c = SillyTavern.getContext();
    const s = getSettings();
    const hasChat = !!c.chatMetadata && (c.characterId !== undefined || c.groupId);
    const ov = hasChat ? getChatOverrides() : {};

    let h = '<div class="mi-quick">';
    h += '<h3>MegaInfo</h3>';
    h += `<label class="checkbox_label"><input type="checkbox" data-mi-quick="enabled"${s.enabled ? ' checked' : ''}><span>Расширение включено</span></label>`;
    h += '<h4>Блоки (везде)</h4>';
    for (const m of MODULE_LIST) {
        h += `<label class="checkbox_label"><input type="checkbox" data-mi-quick="mod:${m.key}"${s.modules[m.key].enabled ? ' checked' : ''}><span><i class="fa-solid ${m.icon}"></i> ${esc(m.label)}</span></label>`;
    }
    if (hasChat) {
        h += '<h4>Только для этого чата</h4>';
        for (const m of MODULE_LIST) {
            const v = typeof ov.modules?.[m.key] === 'boolean' ? (ov.modules[m.key] ? 'on' : 'off') : 'inherit';
            h += `<div class="mi-quick-row"><span><i class="fa-solid ${m.icon}"></i> ${esc(m.label)}</span>${select(`chat:${m.key}`, v, TRI)}</div>`;
        }
        h += `<div class="mi-quick-row"><span><i class="fa-solid fa-mobile-screen"></i> Телефоны в этом мире</span>${select('phones', ov.phones ?? 'inherit', [['inherit', 'как везде'], ['yes', 'есть'], ['no', 'нет']])}</div>`;
        h += `<div class="mi-quick-row"><span><i class="fa-solid fa-user"></i> ${esc(c.name1)} — это</span>${select('pronoun', ov.userPronoun ?? 'inherit', [['inherit', 'как везде'], ['he', 'он'], ['she', 'она'], ['they', 'они']])}</div>`;
    }
    h += '</div>';

    const $html = $(h);
    $html.on('change', '[data-mi-quick]', function () {
        const key = String($(this).data('mi-quick'));
        const val = this.type === 'checkbox' ? this.checked : $(this).val();
        if (key === 'enabled') s.enabled = !!val;
        else if (key.startsWith('mod:')) s.modules[key.slice(4)].enabled = !!val;
        else if (key.startsWith('chat:')) {
            const o = getChatOverrides();
            o.modules ??= {};
            if (val === 'inherit') delete o.modules[key.slice(5)];
            else o.modules[key.slice(5)] = val === 'on';
            saveChatOverrides();
        } else if (key === 'phones') {
            const o = getChatOverrides();
            if (val === 'inherit') delete o.phones; else o.phones = val;
            saveChatOverrides();
        } else if (key === 'pronoun') {
            const o = getChatOverrides();
            if (val === 'inherit') delete o.userPronoun; else o.userPronoun = val;
            saveChatOverrides();
        }
        saveSettings();
        onChange?.();
    });
    await c.callGenericPopup($html, c.POPUP_TYPE.TEXT, '', { okButton: 'Готово', allowVerticalScrolling: true });
}

export function addWandButton(onChange) {
    const $menu = $('#extensionsMenu');
    if (!$menu.length || $('#megainfo_wand').length) return;
    const $btn = $(`<div id="megainfo_wand" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="MegaInfo: включить/выключить блоки">
        <div class="fa-solid fa-layer-group extensionsMenuExtensionButton"></div><span>MegaInfo</span></div>`);
    $btn.on('click', () => openQuickMenu(onChange));
    $menu.append($btn);
}
