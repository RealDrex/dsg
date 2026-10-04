// Player bar: armor segments, health bar, voice / hunger / thirst / stress (+ stamina / oxygen)
(() => {
    HUD.register('player', {
        mount(root, cfg) {
            this.cfg = cfg.player || {};
            this.colors = cfg.colors || {};
            root.innerHTML = '';

            const pl = HUD.el('div', 'pl', root);
            const top = HUD.el('div', 'pl-top', pl);
            const armor = HUD.el('div', 'pl-armor', top);
            this.armor = Array.from({ length: 8 }, () => HUD.el('div', '', armor));

            this.health = HUD.el('div', 'pl-health', top);
            this.healthFill = HUD.el('div', 'pl-health-fill', this.health);
            this.healthVal = HUD.el('span', 'pl-health-val', this.health);

            const statsEl = HUD.el('div', 'pl-stats', pl);
            const order = (this.cfg.stats || ['voice', 'hunger', 'thirst', 'stress']).concat(['stamina', 'oxygen']);
            this.stats = {};
            order.forEach(key => {
                if (this.stats[key]) return;
                const st = HUD.el('div', 'stat', statsEl);
                const bar = HUD.el('div', 'stat-bar', st);
                const fill = HUD.el('div', 'stat-fill', bar);
                const icon = makeIcon(key, 20);
                st.appendChild(icon);
                this.stats[key] = { st, fill, icon };
            });
        },

        setStat(key, value, color, iconColor, glow) {
            const s = this.stats[key];
            if (!s) return;
            if (value === undefined || value === null) { s.st.classList.add('hide'); return; }
            s.st.classList.remove('hide');
            s.fill.style.height = Math.max(value, 4) + '%';
            s.fill.style.background = color;
            s.fill.style.boxShadow = `0 0 6px ${color}`;
            s.icon.setAttribute('fill', iconColor);
            s.icon.style.filter = `drop-shadow(0 0 6px ${glow || HUD.rgba(color, .6)})`;
        },

        update(d) {
            if (!d) return;
            const C = this.colors;
            const low = this.cfg.lowThreshold ?? 20;
            const danger = C.danger || '#ef4444';

            const armorOn = Math.round((d.armor || 0) / 12.5);
            this.armor.forEach((a, i) => a.classList.toggle('on', i < armorOn));

            this.healthFill.style.width = `calc(${d.health}% - 4px)`;
            this.healthVal.textContent = d.health;
            this.health.classList.toggle('low', d.health <= low);

            // need-type stats: red when low
            const need = (key, value, color) => {
                const isLow = value !== undefined && value <= low;
                const c = isLow ? danger : color;
                this.setStat(key, value, c, isLow ? danger : '#ffffff');
            };

            if (d.voice) {
                const v = d.voice;
                const c = v.radioTalking ? (C.radio || '#4ade80') : (C.voice || '#60a5fa');
                const active = v.talking || v.radioTalking;
                this.setStat('voice', v.value, c, active ? c : '#ffffff', active ? c : HUD.rgba(c, .6));
            }
            need('hunger', d.hunger, C.hunger || '#facc15');
            need('thirst', d.thirst, C.thirst || '#22d3ee');

            const stressHigh = d.stress >= (this.cfg.stressDanger ?? 80);
            const sc = stressHigh ? danger : (C.stress || '#f472b6');
            this.setStat('stress', d.stress, sc, stressHigh ? danger : '#ffffff');

            need('stamina', d.stamina, C.stamina || '#a3e635');
            need('oxygen', d.oxygen, C.oxygen || '#38bdf8');
        },
    });
})();
