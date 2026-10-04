(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const ic = (name) => `<svg class="ic" aria-hidden="true"><use href="/icons.svg#${name}"/></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Nav background on scroll
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Reveal on scroll
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.12 });
  const observe = (root = document) => $$('.reveal:not(.in)', root).forEach((el) => io.observe(el));
  observe();

  // Toast
  const toast = $('#toast');
  let toastTimer;
  const notify = (text) => {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  };

  // Count-up animation
  const countUp = (el, value, format = (n) => n.toLocaleString('en-US')) => {
    if (typeof value !== 'number') { el.textContent = value ?? '—'; return; }
    const start = performance.now();
    const dur = 1200;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      el.textContent = format(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const uptime = (ms) => {
    const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60;
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  };

  async function loadStats() {
    try {
      const s = await fetch('/api/stats').then((r) => r.json());
      const status = $('#status');
      status.classList.toggle('online', s.online);
      status.classList.toggle('offline', !s.online);
      $('.status-text', status).textContent = s.online ? `البوت متصل • ${s.ping}ms` : 'البوت غير متصل حالياً';
      countUp($('[data-stat="plugins"]'), s.plugins);
      countUp($('[data-stat="commands"]'), s.commands);
      countUp($('[data-stat="members"]'), s.members);
      $('[data-stat="uptime"]').textContent = s.online ? uptime(s.uptime) : '—';
      if (s.prefix) $('#prefix-code').textContent = s.prefix;
      if (s.invite) $$('.invite-link').forEach((a) => { a.href = s.invite; a.target = '_blank'; a.rel = 'noopener'; a.hidden = false; });
    } catch {
      $('.status-text').textContent = 'تعذر جلب الحالة';
    }
  }

  // Plugins + commands
  let plugins = [];
  let commands = [];
  let active = 'all';

  const usageHtml = (usage) => esc(usage).replace(/(&lt;[^&]+&gt;|\[[^\]]+\])/g, '<span class="opt">$1</span>');

  function renderPlugins() {
    const grid = $('#plugin-grid');
    grid.innerHTML = plugins.map((p) => `
      <button class="plugin reveal" data-plugin="${esc(p.id)}">
        <span class="count">${commands.filter((c) => c.plugin === p.id).length} أمر</span>
        <span class="plugin-icon">${ic(esc(p.icon))}</span>
        <span>
          <h3>${esc(p.nameAr)}</h3>
          <span class="tag">@${esc(p.name)}</span>
          <p>${esc(p.description)}</p>
        </span>
      </button>`).join('');
    $$('.plugin', grid).forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
      card.addEventListener('click', () => {
        setFilter(card.dataset.plugin);
        $('#commands').scrollIntoView({ behavior: 'smooth' });
      });
    });
    observe(grid);
  }

  function renderChips() {
    const chips = $('#chips');
    chips.innerHTML = [`<button class="chip" data-plugin="all">الكل</button>`]
      .concat(plugins.map((p) => `<button class="chip" data-plugin="${esc(p.id)}">${ic(esc(p.icon))} ${esc(p.nameAr.replace(/^قسم\s*/, ''))}</button>`))
      .join('');
    $$('.chip', chips).forEach((c) => c.addEventListener('click', () => setFilter(c.dataset.plugin)));
  }

  function setFilter(id) {
    active = id;
    $$('.chip').forEach((c) => c.classList.toggle('active', c.dataset.plugin === id));
    const chip = $(`.chip[data-plugin="${CSS.escape(id)}"]`);
    const box = $('#chips');
    if (chip) {
      // Scroll only the chip row horizontally (never the page).
      const delta = chip.getBoundingClientRect().left + chip.offsetWidth / 2 - (box.getBoundingClientRect().left + box.clientWidth / 2);
      box.scrollBy({ left: delta, behavior: 'smooth' });
    }
    renderCommands();
  }

  function renderCommands() {
    const q = $('#search').value.trim().toLowerCase();
    const list = $('#command-list');
    const groups = plugins.map((p) => ({
      plugin: p,
      items: commands.filter((c) => c.plugin === p.id
        && (active === 'all' || active === p.id)
        && (!q || `${c.name} ${c.key}`.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))),
    })).filter((g) => g.items.length);

    list.innerHTML = groups.map((g) => `
      <div class="group">
        <h3 class="group-title">${ic(esc(g.plugin.icon))} ${esc(g.plugin.nameAr)} <small>${g.items.length}</small></h3>
        <div class="group-grid">
          ${g.items.map((c) => `
            <button class="cmd" data-usage="${esc(c.usage)}">
              <span class="cmd-usage">${usageHtml(c.usage)}</span>
              <span class="cmd-desc">${esc(c.description)}</span>
              ${c.staff ? '<span class="cmd-staff">للإدارة</span>' : ''}
            </button>`).join('')}
        </div>
      </div>`).join('');
    $('#empty').hidden = groups.length > 0;
    $$('.cmd', list).forEach((b) => b.addEventListener('click', async () => {
      const text = b.dataset.usage.split(' ').filter((w) => !/^[<[]/.test(w)).join(' ');
      try { await navigator.clipboard.writeText(text); notify(`تم النسخ: ${text}`); } catch { notify(text); }
    }));
  }

  $('#search').addEventListener('input', renderCommands);

  async function loadCommands() {
    try {
      [plugins, commands] = await Promise.all([
        fetch('/api/plugins').then((r) => r.json()),
        fetch('/api/commands').then((r) => r.json()),
      ]);
      renderPlugins();
      renderChips();
      setFilter('all');
    } catch {
      $('#empty').hidden = false;
      $('#empty').textContent = 'تعذر تحميل الأوامر.';
    }
  }

  // Discord account in the navbar
  async function loadAccount() {
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) return;
      const { user } = await res.json();
      const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : '/assets/logo-96.png';
      $('#account').innerHTML = `
        <a class="user-chip" href="/dashboard" title="لوحة التحكم">
          <img src="${esc(avatar)}" alt=""><span>${esc(user.username)}</span>${ic('settings')}
        </a>
        <a class="icon-link" href="/auth/logout" title="تسجيل الخروج">${ic('joined')}</a>`;
      const cta = $('#hero-cta');
      cta.href = '/dashboard';
      cta.innerHTML = `${ic('settings')}<span>لوحة التحكم</span>`;
      const ctaLogin = $('#cta-login');
      if (ctaLogin) { ctaLogin.href = '/dashboard'; ctaLogin.innerHTML = `${ic('settings')}<span>افتح لوحة التحكم</span>`; }
    } catch { /* stay logged out */ }
  }

  loadAccount();
  loadStats();
  loadCommands();
  setInterval(loadStats, 30000);
})();
