// Vehicle: speed, gear, RPM bars, engine / body / fuel, lights / cruise / seatbelt / lock
(() => {
    HUD.register('vehicle', {
        mount(root, cfg) {
            this.root = root;
            this.cfg = cfg.vehicle || {};
            this.labels = cfg.labels || {};
            this.colors = cfg.colors || {};
            root.innerHTML = '';

            this.vh = HUD.el('div', 'vh', root);
            const head = HUD.el('div', 'vh-head', this.vh);
            const sw = HUD.el('div', 'vh-speed-wrap', head);
            this.speedEl = HUD.el('span', 'vh-speed', sw);
            const unit = HUD.el('span', 'vh-unit', sw);
            unit.textContent = this.cfg.unit === 'mph' ? (this.labels.mph || 'MPH') : (this.labels.kmh || 'KM/H');
            this.gearEl = HUD.el('div', 'vh-gear', head);
            this.gearText = HUD.el('span', '', this.gearEl);

            const rpm = HUD.el('div', 'vh-rpm', this.vh);
            this.rpm = Array.from({ length: 16 }, (_, i) => {
                const b = HUD.el('div', i >= 13 ? 'zone' : '', rpm);
                b.style.height = (6 + i * 0.6) + 'px';
                return b;
            });

            const foot = HUD.el('div', 'vh-foot', this.vh);
            const sys = HUD.el('div', 'vh-sys', foot);
            this.sys = {};
            ['engine', 'body', 'fuel'].forEach(k => {
                const st = HUD.el('div', 'stat', sys);
                const bar = HUD.el('div', 'stat-bar', st);
                const fill = HUD.el('div', 'stat-fill', bar);
                const icon = makeIcon(k === 'fuel' ? 'gas' : k === 'body' ? 'car-body' : 'engine', 20);
                st.appendChild(icon);
                this.sys[k] = { fill, icon };
            });

            const flags = HUD.el('div', 'vh-flags', foot);
            this.flags = {};
            [['lights', 'light-low'], ['cruise', 'cruise-control'], ['belt', 'seatbelt'], ['lock', 'lock']].forEach(([k, ic]) => {
                const f = HUD.el('div', 'vh-flag', flags);
                const icon = makeIcon(ic, 16);
                f.appendChild(icon);
                this.flags[k] = { f, icon };
            });
        },

        setSys(key, value, low) {
            const s = this.sys[key];
            const isLow = value <= low;
            const c = isLow ? (this.colors.danger || '#ef4444') : (this.colors.primary || '#3b82f6');
            s.fill.style.height = Math.max(value, 4) + '%';
            s.fill.style.background = c;
            s.fill.style.boxShadow = `0 0 6px ${c}`;
            s.icon.setAttribute('fill', isLow ? c : '#ffffff');
            s.icon.style.filter = `drop-shadow(0 0 6px ${HUD.rgba(c, .55)})`;
        },

        setFlag(key, on, color, icon) {
            const f = this.flags[key];
            if (icon) f.icon.setIcon(icon);
            f.icon.setAttribute('fill', on ? color : 'rgba(255,255,255,.28)');
            f.icon.style.filter = on ? `drop-shadow(0 0 5px ${HUD.rgba(color, .6)})` : 'none';
        },

        update(d) {
            HUD.show(this.root, !!d);
            if (!d) return;
            const C = this.colors;

            this.vh.classList.toggle('cycle', !!d.cycle);
            this.speedEl.textContent = d.speed;
            this.gearText.textContent = d.gear;
            this.gearEl.classList.toggle('red', d.rpm > (this.cfg.redline ?? 0.85));

            const lit = Math.round(d.rpm * 16);
            this.rpm.forEach((b, i) => b.classList.toggle('on', i < lit));

            this.setSys('engine', d.engine, 20);
            this.setSys('body', d.body, 20);
            this.sys.fuel.icon.setIcon(d.electric ? 'bolt' : 'gas');
            this.setSys('fuel', d.fuel, this.cfg.lowFuel ?? 20);

            const light = C.primaryLight || '#60a5fa';
            this.setFlag('lights', !!d.lights, light, d.lights === 'high' ? 'light-high' : 'light-low');
            this.setFlag('cruise', d.cruise, light);

            const belt = this.flags.belt;
            belt.f.classList.toggle('hide', !d.hasBelt);
            const warn = d.hasBelt && !d.belt && d.speed >= (this.cfg.beltWarningSpeed ?? 20);
            belt.f.classList.toggle('warn', warn);
            if (warn) this.setFlag('belt', true, C.danger || '#ef4444');
            else this.setFlag('belt', d.belt, C.success || '#4ade80');

            this.setFlag('lock', d.locked, C.warning || '#facc15');
        },
    });
})();
