// Фейковая модель: читает инструкцию MegaInfo (какие ключи в FORMAT) и отвечает правдоподобным блоком.
// window.__behavior: 'good' | 'forget' | 'broken' | 'truncated' — что сделает модель в ОСНОВНОМ ответе.
(function () {
    let clock = 14 * 60;
    window.__behavior = 'good';
    window.__sepBehavior = 'good';
    window.__location = 'Кофейня «Зерно»';
    window.__calls = { main: 0, raw: 0 };

    const pad = (n) => String(n).padStart(2, '0');
    const now = () => `${pad(Math.floor(clock / 60) % 24)}:${pad(clock % 60)}`;

    function formatKeys(instr) {
        const m = instr.match(/FORMAT:\n<megainfo>\n([\s\S]*?)\n<\/megainfo>/);
        if (!m) return {};
        try { return JSON.parse(m[1]); } catch { return {}; }
    }

    function makeBlock(instr) {
        const f = formatKeys(instr);
        const firstTime = /CURRENT STATE: none yet/.test(instr);
        const data = {};
        if ('time' in f) {
            clock += 20;
            Object.assign(data, { date: '15.03.2025', time: now(), weather: 'ясно, +12°', location: window.__location });
        }
        if (f.people) {
            data.people = [
                { name: 'Алекс', role: 'char', mood: 'задумчив', outfit: 'чёрное худи', thought: 'он опять смотрит на меня', d: { food: -2 }, aff: 2, rel: 'знакомый',
                    ...(firstTime ? { new: { stats: { food: 60, hygiene: 80, energy: 70, arousal: 10 }, money: 20000, birthday: '01.02.1995', zodiac: 'Водолей', mbti: 'INTJ — стратег', aff: 5 } } : {}) },
                { name: 'Миша', role: 'user', outfit: 'кожанка', ...(firstTime ? { new: { stats: { food: 70, hygiene: 90, energy: 60, arousal: 5 }, money: 5000, birthday: '10.10.2000', zodiac: 'Весы', mbti: 'ENFP' } } : {}) },
            ];
        }
        if (f.money) data.money = [{ who: 'Алекс', amount: -350, note: 'капучино' }];
        if (f.world) data.world = { pace: 'slow', plot: 'Знакомство', plot_d: 1, rumor_add: firstTime ? ['Бариста встречается с хозяином'] : [] };
        if (f.slowburn) data.slowburn = { d: 1, moment: '' };
        if (f.marks) data.marks = { add: firstTime ? [{ who: 'Миша', kind: 'bruise', where: 'запястье', sev: 1, note: 'ударился' }] : [], heal: [] };
        if (f.place) {
            const described = instr.match(/Already described places: ([^\n]*)/)?.[1] ?? '';
            if (!described.includes(window.__location)) {
                data.place = { name: window.__location, look: `Описание места ${window.__location}.`, details: 'Столики, стойка.', mood: 'Тихо, пахнет кофе.' };
            }
        }
        if (f.diary) {
            const about = /he\/him/.test(instr) ? 'Он сегодня был другим.' : 'Она сегодня была другой.';
            data.diary = { date: `15.03.2025 ${now()}`, title: 'Странный день', entry: 'Длинная запись дневника.\n\nВторой абзац…', about_user: about, npcs: [{ name: 'Кира', entry: 'Слежу за ними.' }] };
        }
        if (f.phone && window.__phone) data.phone = { app: 'telegram', kind: 'chat', title: 'Кира', items: [{ from: 'Кира', dir: 'in', text: 'ты где??', time: now() }, { dir: 'out', text: 'щас буду', time: now() }] };
        let out = `<megainfo>\n${JSON.stringify(data)}\n</megainfo>`;
        if (/megainfo_html/.test(instr) && window.__card) out += '\n<megainfo_html><style>.x{color:red}</style><div class="x"><i class="fa-solid fa-receipt"></i> Чек: капучино 350₽</div><script>alert(1)</script></megainfo_html>';
        return out;
    }

    window.__st.model = function (kind, payload) {
        if (kind === 'main') {
            window.__calls.main++;
            const story = `Алекс поставил чашку на стол (ход ${window.__calls.main}). «Ты опять пришёл», — сказал он.`;
            const instr = payload.injection || '';
            if (!instr.includes('[MegaInfo · status tracker]')) return story;
            const b = window.__behavior;
            if (b === 'forget') return story;
            if (b === 'broken') return `${story}\n\n<megainfo>{"time": "сломано", people: [}</megainfo>`;
            const block = makeBlock(instr);
            if (b === 'truncated') return `${story}\n\n${block.slice(0, Math.floor(block.length * 0.6))}`;
            return `${story}\n\n${block}`;
        }
        window.__calls.raw++;
        if (window.__sepBehavior === 'fail') throw new Error('сеть упала');
        if (window.__sepBehavior === 'garbage') return 'Извините, не могу.';
        return makeBlock(payload.system);
    };
})();
