// Aircraft (heli + plane): airspeed, attitude indicator, altitude, vertical speed, THR / FUEL / ENG, gear / rotor
(() => {
    HUD.register('aircraft', {
        mount(root, cfg) {
            this.root = root;
            this.cfg = cfg.aircraft || {};
            this.L = cfg.labels || {};
            this.colors = cfg.colors || {};
            const L = this.L;
            root.innerHTML = '';

            const ac = HUD.el('div', 'ac', root);
            const main = HUD.el('div', 'ac-main', ac);

            const left = HUD.el('div', 'ac-side l', main);
            HUD.el('span', 'ac-cap', left).textContent = L.airspeed || 'AIRSPEED';
            const spd = HUD.el('span', 'ac-val', left);
            this.speedEl = HUD.el('span', '', spd);
            HUD.el('small', '', spd).textContent = L.knots || 'KTS';

            const ati = HUD.el('div', 'ac-ati', main);
            this.horizon = HUD.el('div', 'ac-horizon', ati);
            HUD.el('div', 'ac-wings', ati);
            HUD.el('div', 'ac-dot', ati);

            const right = HUD.el('div', 'ac-side r', main);
            HUD.el('span', 'ac-cap', right).textContent = L.altitude || 'ALTITUDE';
            const alt = HUD.el('span', 'ac-val', right);
            this.altEl = HUD.el('span', '', alt);
            HUD.el('small', '', alt).textContent = L.feet || 'FT';
            this.vsEl = HUD.el('span', 'ac-vs', right);

            const bottom = HUD.el('div', 'ac-bottom', ac);
            this.gauges = {};
            [['throttle', L.throttle || 'THR'], ['fuel', L.fuel || 'FUEL'], ['engine', L.engine || 'ENG']].forEach(([k, label]) => {
                const g = HUD.el('div', 'ac-gauge', bottom);
                HUD.el('span', 'ac-gauge-label', g).textContent = label;
                const segs = HUD.el('div', 'ac-segs', g);
                this.gauges[k] = Array.from({ length: 8 }, () => HUD.el('div', '', segs));
            });
            this.badge = HUD.el('span', 'ac-badge', bottom);
        },

        setGauge(key, value, color) {
            const on = Math.ceil(value / 12.5);
            this.gauges[key].forEach((s, i) => { s.style.background = i < on ? color : 'rgba(255,255,255,.1)'; });
        },

        update(d) {
            HUD.show(this.root, !!d);
            if (!d) return;
            const C = this.colors, L = this.L;

            this.speedEl.textContent = d.speed;
            this.altEl.textContent = d.alt.toLocaleString('en-US');
            this.vsEl.textContent = (d.vs >= 0 ? '▲ ' : '▼ ') + Math.abs(d.vs) + ' ' + (L.fpm || 'FPM');
            this.vsEl.classList.toggle('down', d.vs < 0);

            const roll = (this.cfg.invertRoll ? d.roll : -d.roll).toFixed(1);
            const pitch = (d.pitch * (this.cfg.pitchScale ?? 1.5)).toFixed(1);
            this.horizon.style.transform = `rotate(${roll}deg) translateY(${pitch}px)`;

            const low = this.cfg.lowFuel ?? 20;
            this.setGauge('throttle', d.throttle, C.primary || '#3b82f6');
            this.setGauge('fuel', d.fuel, d.fuel <= low ? (C.danger || '#ef4444') : (C.thirst || '#22d3ee'));
            this.setGauge('engine', d.engine, d.engine <= 20 ? (C.danger || '#ef4444') : '#e6ecf5');

            const b = this.badge;
            b.className = 'ac-badge';
            if (d.heli) {
                b.textContent = `${L.rotor || 'ROTOR'} ${d.rotor}%`;
                if (d.rotor <= 25) b.classList.add('danger');
            } else if (d.gear === 'down') {
                b.textContent = L.gearDown || 'GEAR DOWN';
                b.classList.add('down');
            } else if (d.gear === 'moving') {
                b.textContent = L.gearMoving || 'GEAR ...';
                b.classList.add('moving');
            } else {
                b.textContent = L.gearUp || 'GEAR UP';
            }
        },
    });
})();
