// Core: config, message routing, scaling. Every HUD section registers itself with HUD.register().
const HUD = {
    modules: {},
    cfg: null,
    inGame: typeof GetParentResourceName === 'function',

    register(name, mod) {
        this.modules[name] = mod;
    },

    // '#3b82f6' -> 'rgba(59,130,246,a)'
    rgba(hex, a) {
        const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    },

    rgb(hex) {
        const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
        return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    },

    el(tag, cls, parent) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (parent) parent.appendChild(e);
        return e;
    },

    show(el, state) {
        el.classList.toggle('off', !state);
    },

    applyConfig(cfg) {
        this.cfg = cfg;
        const root = document.documentElement.style;
        const c = cfg.colors || {};
        const vars = {
            '--primary': c.primary, '--primary-light': c.primaryLight, '--primary-dark': c.primaryDark,
            '--primary-pale': c.primaryPale, '--danger': c.danger, '--warning': c.warning,
            '--success': c.success, '--text': c.text, '--muted': c.muted, '--muted-light': c.mutedLight,
            '--durability': c.durability,
        };
        for (const k in vars) if (vars[k]) root.setProperty(k, vars[k]);
        if (c.primary) root.setProperty('--primary-rgb', this.rgb(c.primary));
        if (c.danger) root.setProperty('--danger-rgb', this.rgb(c.danger));
        if (c.success) root.setProperty('--success-rgb', this.rgb(c.success));
        if (cfg.ui && cfg.ui.font) root.setProperty('--font', cfg.ui.font);

        const L = cfg.layout || {};
        const set = (id, o, keys) => {
            const e = document.getElementById(id);
            if (e && o) {
                keys.forEach(k => { if (o[k]) e.style[k] = o[k]; });
                if (o.scale) e.style.setProperty('--ps', o.scale);
            }
        };
        set('compass', L.compass, ['top']);
        set('player', L.player, ['left', 'bottom']);
        set('right', L.right, ['right', 'bottom']);
        set('aircraft', L.aircraft, ['bottom']);

        this.rescale();
        for (const name in this.modules) {
            const m = this.modules[name];
            if (m.mount) m.mount(document.getElementById(name), cfg);
        }
    },

    rescale() {
        const s = (window.innerHeight / 1080) * ((this.cfg && this.cfg.ui && this.cfg.ui.scale) || 1);
        document.documentElement.style.setProperty('--scale', s.toFixed(4));
    },

    // minimap visible -> move the player bar next to it
    setMinimap(state) {
        const L = (this.cfg && this.cfg.layout && this.cfg.layout.player) || {};
        const el = document.getElementById('player');
        el.style.left = state && L.leftWithMinimap ? L.leftWithMinimap : (L.left || '3%');
    },

    onMessage(d) {
        if (!d || !this.cfg) return;
        switch (d.action) {
            case 'visible':
                document.getElementById('hud').classList.toggle('hidden', !d.state);
                break;
            case 'update':
                this.setMinimap(!!d.minimap);
                ['player', 'weapon', 'vehicle', 'aircraft'].forEach(k => {
                    const m = this.modules[k];
                    if (m) m.update(d[k]);
                });
                break;
            case 'compass':
                if (this.modules.compass) this.modules.compass.update(d);
                break;
        }
    },
};

window.addEventListener('message', e => HUD.onMessage(e.data));
window.addEventListener('resize', () => HUD.rescale());

window.addEventListener('DOMContentLoaded', () => {
    if (!HUD.inGame) return; // browser preview -> demo.js
    const handshake = () => fetch(`https://${GetParentResourceName()}/ready`, { method: 'POST', body: '{}' })
        .then(r => r.json())
        .then(cfg => HUD.applyConfig(cfg))
        .catch(() => setTimeout(handshake, 1000));
    handshake();
});
