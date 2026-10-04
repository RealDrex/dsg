// Weapon: type, name, magazine / reserve, round segments, durability, reloading
(() => {
    HUD.register('weapon', {
        mount(root, cfg) {
            this.root = root;
            this.cfg = cfg.weapon || {};
            this.labels = cfg.labels || {};
            root.innerHTML = '';

            const wp = HUD.el('div', 'wp', root);
            const head = HUD.el('div', 'wp-head', wp);
            const title = HUD.el('div', 'wp-title', head);
            this.typeEl = HUD.el('span', 'wp-type', title);
            this.nameEl = HUD.el('span', 'wp-name', title);

            this.ammoEl = HUD.el('div', 'wp-ammo', head);
            this.magEl = HUD.el('span', 'wp-mag', this.ammoEl);
            this.totalEl = HUD.el('span', 'wp-total', this.ammoEl);

            this.roundsEl = HUD.el('div', 'wp-rounds', wp);
            this.rounds = [];

            this.durEl = HUD.el('div', 'wp-dur', wp);
            const bar = HUD.el('div', 'wp-dur-bar', this.durEl);
            this.durFill = HUD.el('div', 'wp-dur-fill', bar);
            this.durLabel = HUD.el('span', 'wp-dur-label', this.durEl);

            this.reloadEl = HUD.el('span', 'wp-reload', wp);
            this.reloadEl.textContent = this.labels.reloading || 'RELOADING';
        },

        setSegments(n) {
            if (this.rounds.length === n) return;
            this.roundsEl.innerHTML = '';
            this.roundsEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
            this.rounds = Array.from({ length: n }, () => HUD.el('div', '', this.roundsEl));
        },

        update(d) {
            HUD.show(this.root, !!d);
            if (!d) return;

            this.typeEl.textContent = d.type || '';
            this.nameEl.textContent = d.name || '';

            const gun = d.kind === 'gun';
            const hasCount = gun || d.kind === 'throwable';
            this.ammoEl.style.display = hasCount ? '' : 'none';
            this.roundsEl.style.display = gun ? '' : 'none';
            this.totalEl.style.display = gun ? '' : 'none';

            if (hasCount) {
                this.magEl.textContent = d.mag;
                this.totalEl.textContent = '/ ' + d.total;
            }

            if (gun) {
                const cap = Math.max(d.cap || 1, 1);
                const n = Math.min(cap, this.cfg.maxSegments || 30);
                this.setSegments(n);
                const filled = Math.ceil((d.mag / cap) * n);
                const low = d.mag <= Math.max(1, Math.floor(cap * (this.cfg.lowAmmo ?? 0.25)));
                this.rounds.forEach((r, i) => r.classList.toggle('on', i < filled));
                this.roundsEl.classList.toggle('low', low);
                this.magEl.classList.toggle('low', low);
            } else {
                this.magEl.classList.remove('low');
            }

            const hasDur = d.durability !== undefined && d.durability !== null;
            this.durEl.style.display = hasDur ? '' : 'none';
            if (hasDur) {
                this.durFill.style.width = d.durability + '%';
                this.durLabel.textContent = `${this.labels.durability || 'DUR'} ${d.durability}%`;
                this.durEl.classList.toggle('low', d.durability <= 20);
            }

            this.reloadEl.style.display = d.reloading ? '' : 'none';
        },
    });
})();
