// Compass: heading tape, map points, street name, waypoint + "set waypoint" prompt
(() => {
    const PX = 4;          // px per degree
    const HALF = 320;      // half of the tape width
    const VIEW = 78;       // visible degrees on each side for points
    const norm = d => ((d % 360) + 540) % 360 - 180;
    const fmtDist = m => m >= 1000 ? (m / 1000).toFixed(1) + 'km' : m + 'm';
    const GIF = new Set([0, 2, 3, 11, 12, 13, 14, 15, 41, 42, 161, 353, 422]);
    const blipUrl = sprite => `blips/${sprite}.${GIF.has(sprite) ? 'gif' : 'png'}`;

    // GTA blip image; with a color it is tinted like the in-game blip
    function setBlip(el, sprite, color) {
        const url = `url("${blipUrl(sprite)}")`;
        if (el._key === sprite + '|' + color) return;
        el._key = sprite + '|' + color;
        if (color) {
            el.style.backgroundImage = 'none';
            el.style.backgroundColor = color;
            el.style.webkitMaskImage = url;
        } else {
            el.style.backgroundImage = url;
            el.style.backgroundColor = 'transparent';
            el.style.webkitMaskImage = 'none';
        }
    }

    HUD.register('compass', {
        mount(root, cfg) {
            this.cfg = cfg;
            this.labels = cfg.labels || {};
            this.dirs = this.labels.directions || ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
            this.current = null;
            this.target = 0;
            this.points = [];
            this.pool = {};

            root.innerHTML = '';
            root.classList.add('off');
            const cp = HUD.el('div', 'cp', root);
            const wrap = HUD.el('div', 'cp-tape-wrap', cp);
            this.tape = HUD.el('div', 'cp-tape', wrap);
            this.blips = HUD.el('div', 'cp-blips', wrap);
            HUD.el('div', 'cp-marker', cp);

            const info = HUD.el('div', 'cp-info', cp);
            this.dirEl = HUD.el('span', 'cp-dir', info);
            HUD.el('span', 'cp-sep', info);
            this.streetEl = HUD.el('span', 'cp-street', info);
            this.zoneEl = HUD.el('span', 'cp-zone', info);
            this.wpSep = HUD.el('span', 'cp-sep', info);
            this.wpEl = HUD.el('span', 'cp-wp', info);

            this.promptEl = HUD.el('div', 'cp-prompt', cp);
            const pill = HUD.el('div', 'cp-pill', this.promptEl);
            this.promptIcon = HUD.el('div', 'cp-blip-img', pill);
            this.promptText = HUD.el('span', '', pill);
            const act = HUD.el('div', 'cp-action', this.promptEl);
            const key = HUD.el('span', 'cp-key', act);
            key.textContent = (cfg.compass && cfg.compass.key) || 'E';
            this.promptLabel = HUD.el('span', 'cp-action-label', act);
            this.promptEl.style.display = 'none';
            this.promptKey = null;

            this.buildTape();
            if (!this.raf) this.loop();
        },

        buildTape() {
            const card = {};
            [0, 45, 90, 135, 180, 225, 270, 315].forEach((deg, i) => { card[deg] = this.dirs[i]; });
            const frag = document.createDocumentFragment();
            for (let d = -180; d <= 540; d += 5) {
                const deg = ((d % 360) + 360) % 360;
                const c = card[deg];
                const lab = deg % 15 === 0;
                const x = (d + 180) * PX + 'px';

                const t = document.createElement('div');
                t.className = 'cp-tick';
                t.style.left = x;
                t.style.width = c ? '2px' : '1px';
                t.style.height = c ? '16px' : (lab ? '12px' : '7px');
                t.style.background = c ? 'var(--primary)' : (lab ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.22)');
                if (c) t.style.boxShadow = '0 0 6px var(--primary)';
                frag.appendChild(t);

                if (c || lab) {
                    const s = document.createElement('span');
                    s.className = 'cp-label';
                    s.style.left = x;
                    s.style.fontSize = c ? '14px' : '11px';
                    s.style.fontWeight = c ? '800' : '500';
                    s.style.color = c ? 'var(--text)' : 'var(--muted)';
                    s.textContent = c || deg + '°';
                    frag.appendChild(s);
                }
            }
            this.tape.innerHTML = '';
            this.tape.appendChild(frag);
        },

        update(d) {
            const root = document.getElementById('compass');
            if (!d || d.hidden) { HUD.show(root, false); return; }
            HUD.show(root, true);

            this.target = d.heading || 0;
            if (this.current === null) this.current = this.target;

            this.streetEl.textContent = d.street || '';
            this.zoneEl.textContent = d.zone || '';
            this.zoneEl.style.display = d.zone ? '' : 'none';

            const wp = d.waypoint;
            this.wpSep.style.display = wp ? '' : 'none';
            this.wpEl.style.display = wp ? '' : 'none';
            if (wp) this.wpEl.textContent = `${wp.label} · ${fmtDist(wp.dist)}`;

            this.points = d.points || [];
            this.syncBlips();

            const p = d.prompt;
            if (p) {
                const key = p.label + p.active;
                if (key !== this.promptKey) {
                    this.promptKey = key;
                    this.promptEl.style.animation = 'none';
                    void this.promptEl.offsetWidth;
                    this.promptEl.style.animation = '';
                }
                setBlip(this.promptIcon, p.sprite, p.color);
                this.promptText.textContent = `${p.label} · ${fmtDist(p.dist)}`;
                this.promptLabel.textContent = p.active ? this.labels.removeWaypoint : this.labels.setWaypoint;
                this.promptEl.style.display = '';
            } else {
                this.promptKey = null;
                this.promptEl.style.display = 'none';
            }
        },

        syncBlips() {
            const seen = {};
            this.points.forEach(p => {
                seen[p.id] = true;
                let b = this.pool[p.id];
                if (!b) {
                    b = HUD.el('div', 'cp-blip', this.blips);
                    b.img = HUD.el('div', 'cp-blip-img', b);
                    this.pool[p.id] = b;
                }
                setBlip(b.img, p.sprite, p.color);
                b.data = p;
                b.classList.toggle('active', !!p.active);
                b.classList.toggle('aimed', !!p.aimed);
            });
            for (const id in this.pool) {
                if (!seen[id]) { this.pool[id].remove(); delete this.pool[id]; }
            }
        },

        loop() {
            let last = performance.now();
            const frame = now => {
                const dt = Math.min((now - last) / 1000, 0.1);
                last = now;
                if (this.current !== null) {
                    this.current += norm(this.target - this.current) * Math.min(1, dt * 12);
                    this.current = ((this.current % 360) + 360) % 360;
                    const h = this.current;

                    this.tape.style.transform = `translateX(${HALF - (h + 180) * PX}px)`;
                    this.dirEl.textContent = this.dirs[Math.round(h / 45) % 8];

                    for (const id in this.pool) {
                        const b = this.pool[id];
                        const rel = norm(b.data.bearing - h);
                        if (Math.abs(rel) > VIEW) {
                            b.style.display = 'none';
                        } else {
                            b.style.display = '';
                            b.style.left = (HALF + rel * PX) + 'px';
                        }
                    }
                }
                this.raf = requestAnimationFrame(frame);
            };
            this.raf = requestAnimationFrame(frame);
        },
    });
})();
