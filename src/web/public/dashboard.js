(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(c));
    return node;
  };
  const SVG = 'http://www.w3.org/2000/svg';
  const icon = (name, cls = 'ic') => {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG, 'use');
    use.setAttribute('href', `/icons.svg#${name}`);
    svg.append(use);
    return svg;
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const setPath = (o, p, v) => {
    const keys = p.split('.');
    const last = keys.pop();
    keys.reduce((a, k) => (a[k] ??= {}), o)[last] = v;
  };

  const state = { guilds: [], data: null, pluginId: null, tab: 'settings', draft: null, original: null, view: 'plugin' };

  // Log types mirror the logs plugin — label + icon for the live feed.
  const LOG_TYPES = {
    all: { label: 'الكل', icon: 'logs' },
    messages: { label: 'الرسائل', icon: 'message' },
    messageEdit: { label: 'تعديل الرسائل', icon: 'edit' },
    members: { label: 'الأعضاء', icon: 'users' },
    moderation: { label: 'الإدارة', icon: 'ban' },
    server: { label: 'الرتب والرومات', icon: 'roles' },
    voice: { label: 'الفويس', icon: 'voice' },
    voiceLeave: { label: 'خروج الفويس', icon: 'leave' },
    protection: { label: 'الحماية', icon: 'protection' },
    general: { label: 'عام', icon: 'logs' },
  };
  let logsTimer = null;
  const logsState = { type: 'all' };

  // ── API ──────────────────────────────────────────────────────
  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || 'خطأ'), { status: res.status, body });
    return body;
  }

  // ── Toast ────────────────────────────────────────────────────
  let toastTimer;
  function toast(text, error = false) {
    const t = $('#toast');
    t.replaceChildren(icon(error ? 'error' : 'success'), el('span', { text }));
    t.classList.toggle('error', error);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ── Gate screens ─────────────────────────────────────────────
  const ERRORS = {
    oauth: 'تسجيل الدخول غير مفعّل بعد: أضف CLIENT_SECRET و PUBLIC_URL في ملف .env وأضف رابط /auth/callback في صفحة البوت.',
    state: 'انتهت صلاحية محاولة الدخول، حاول مرة ثانية.',
    login: 'فشل تسجيل الدخول، حاول مرة ثانية.',
  };

  function gate(text, { login = true, guilds = null } = {}) {
    $('#app').hidden = true;
    $('#gate').hidden = false;
    $('#gate-text').textContent = text;
    $('#gate-login').hidden = !login;
    const pick = $('#guild-pick');
    pick.innerHTML = '';
    for (const g of guilds || []) {
      pick.append(el('button', { class: 'guild-option', type: 'button', onclick: () => openGuild(g.id) },
        el('img', { src: g.icon || '/assets/logo-96.png', alt: '' }),
        el('span', {}, el('b', { text: g.name }), el('small', { text: `${g.members.toLocaleString('en-US')} عضو` }))));
    }
  }

  // ── Boot ─────────────────────────────────────────────────────
  async function boot() {
    const err = new URLSearchParams(location.search).get('error');
    if (err) history.replaceState(null, '', '/dashboard');
    let me;
    try {
      me = await api('/api/me');
    } catch (e) {
      if (e.status === 401) return gate(ERRORS[err] || (e.body?.oauth === false ? ERRORS.oauth : 'سجّل دخولك بحساب ديسكورد عشان تتحكم بإعدادات البوت.'));
      return gate('تعذر الاتصال بالموقع.', { login: false });
    }
    $('#me-name').textContent = me.user.username;
    $('#me-avatar').src = me.user.avatar ? `https://cdn.discordapp.com/avatars/${me.user.id}/${me.user.avatar}.png?size=64` : '/assets/logo-96.png';

    const { online, guilds } = await api('/api/guilds');
    state.guilds = guilds;
    if (!online) return gate('البوت غير متصل حالياً — شغّله وارجع حدّث الصفحة.', { login: false });
    if (!guilds.length) return gate('ما لقينا سيرفر فيه البوت وعندك فيه صلاحية Manage Server.', { login: false });
    const saved = sessionStorageGet('guild');
    const target = guilds.find((g) => g.id === saved) || (guilds.length === 1 ? guilds[0] : null);
    if (target) return openGuild(target.id);
    gate('اختر السيرفر اللي تبي تديره:', { login: false, guilds });
  }

  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }

  async function openGuild(id) {
    try {
      state.data = await api(`/api/guilds/${id}`);
    } catch (e) {
      return gate(e.message, { login: false, guilds: state.guilds });
    }
    sessionStorageSet('guild', id);
    $('#gate').hidden = true;
    $('#app').hidden = false;
    const { guild } = state.data;
    $('#server-icon').src = guild.icon || '/assets/logo-96.png';
    $('#server-name').textContent = guild.name;
    $('#server-meta').textContent = `${guild.members.toLocaleString('en-US')} عضو • البريفكس ${state.data.prefix}`;
    const fromHash = location.hash.slice(1);
    selectPlugin(state.data.plugins.some((p) => p.id === fromHash) ? fromHash : state.data.plugins[0].id, true);
  }

  // ── Sidebar ──────────────────────────────────────────────────
  function renderMenu() {
    const menu = $('#menu');
    menu.innerHTML = '';
    menu.append(el('button', {
      class: `menu-item${state.view === 'logs' ? ' active' : ''}`, type: 'button', onclick: () => selectLogs(),
    },
    el('span', { class: 'menu-icon' }, icon('logs')),
    el('span', { class: 'menu-text' }, el('b', { text: 'اللوقات المباشرة' }), el('small', { text: 'سجل السيرفر' })),
    el('span', { class: 'menu-dot', title: 'مباشر' })));
    for (const p of state.data.plugins) {
      menu.append(el('button', {
        class: `menu-item${state.view === 'plugin' && p.id === state.pluginId ? ' active' : ''}`, type: 'button', onclick: () => selectPlugin(p.id),
      },
      el('span', { class: 'menu-icon' }, icon(p.icon)),
      el('span', { class: 'menu-text' }, el('b', { text: p.nameAr }), el('small', { text: `@${p.name}` })),
      el('span', { class: `menu-dot${p.enabled ? '' : ' off'}`, title: p.enabled ? 'شغال' : 'مقفل' })));
    }
  }

  const current = () => state.data.plugins.find((p) => p.id === state.pluginId);
  const dirty = () => state.draft && JSON.stringify(state.draft) !== JSON.stringify(state.original);

  function updateSavebar() {
    $('#savebar').classList.toggle('show', !!dirty());
  }

  function selectPlugin(id, force = false) {
    if (!force && dirty()) {
      const bar = $('#savebar');
      bar.classList.remove('shake');
      void bar.offsetWidth;
      bar.classList.add('shake');
      return;
    }
    if (logsTimer) { clearInterval(logsTimer); logsTimer = null; }
    state.view = 'plugin';
    if (state.pluginId !== id) state.tab = 'settings';
    state.pluginId = id;
    const p = current();
    state.original = clone(p.config || {});
    state.draft = clone(p.config || {});
    if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
    closeDrawer();
    renderMenu();
    renderPage();
    updateSavebar();
    window.scrollTo({ top: 0 });
  }

  // ── Page ─────────────────────────────────────────────────────
  function renderPage() {
    $('#tabs').hidden = false;
    const p = current();
    if (p.id === 'voicebots') return renderMusicPage(p);
    $('#p-icon').replaceChildren(icon(p.icon));
    $('#p-title').textContent = p.nameAr;
    $('#p-tag').textContent = `@${p.name}`;
    $('#p-desc').textContent = p.description;
    $('#crumbs').innerHTML = '';
    $('#crumbs').append(state.data.guild.name, ' / ', el('b', { text: p.nameAr }));
    $('#p-toggle-wrap').hidden = !p.toggleable;
    $('#p-toggle').checked = p.enabled;
    $$('.tab').forEach((t) => {
      const counts = { settings: null, actions: p.actions.length, images: p.images.length, commands: p.commands.length };
      t.classList.toggle('active', t.dataset.tab === state.tab);
      const label = { settings: 'الإعدادات', actions: 'الإجراءات', images: 'الصور', commands: 'الأوامر' }[t.dataset.tab];
      t.innerHTML = '';
      t.append(label, counts[t.dataset.tab] != null ? el('span', { class: 'count', text: ` (${counts[t.dataset.tab]})` }) : '');
      t.hidden = (t.dataset.tab === 'actions' && !p.actions.length) || (t.dataset.tab === 'images' && !p.images.length);
    });
    if ((state.tab === 'actions' && !p.actions.length) || (state.tab === 'images' && !p.images.length)) state.tab = 'settings';
    const panel = $('#panel');
    panel.innerHTML = '';
    if (p.toggleable && !p.enabled) {
      panel.append(el('div', { class: 'notice disabled-note' }, icon('off'), el('span', { text: 'هذا القسم مقفل — أوامره وأحداثه موقفة. شغّله من الزر فوق.' })));
    }
    if (state.tab === 'settings') renderSettings(panel, p);
    if (state.tab === 'actions') renderActions(panel, p);
    if (state.tab === 'commands') renderCommands(panel, p);
    if (state.tab === 'images') renderImages(panel, p);
  }

  // ── Live logs view ───────────────────────────────────────────
  function selectLogs() {
    if (dirty()) {
      const bar = $('#savebar');
      bar.classList.remove('shake'); void bar.offsetWidth; bar.classList.add('shake');
      return;
    }
    state.view = 'logs';
    closeDrawer();
    renderMenu();
    renderLogsPage();
    window.scrollTo({ top: 0 });
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'الآن';
    if (s < 3600) return `قبل ${Math.floor(s / 60)} د`;
    if (s < 86400) return `قبل ${Math.floor(s / 3600)} س`;
    return new Date(ts).toLocaleString('ar', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  async function loadLogs(feed) {
    try {
      const { entries } = await api(`/api/guilds/${state.data.guild.id}/logs?type=${logsState.type}&limit=200`);
      feed.innerHTML = '';
      if (!entries.length) {
        feed.append(el('div', { class: 'list-empty', text: 'ما فيه لوقات لهذا النوع بعد.' }));
        return;
      }
      for (const e of entries) {
        const t = LOG_TYPES[e.type] || LOG_TYPES.general;
        feed.append(el('div', { class: 'log-row' },
          el('span', { class: 'log-ic' }, icon(t.icon)),
          el('div', { class: 'log-body' },
            el('div', { class: 'log-head' },
              el('b', { text: e.title }),
              el('span', { class: 'log-type', text: t.label }),
              el('span', { class: 'log-time', text: timeAgo(e.at) })),
            e.user ? el('small', { class: 'log-user', text: e.user }) : null,
            e.text ? el('p', { class: 'log-text', text: e.text }) : null)));
      }
    } catch (err) {
      feed.innerHTML = '';
      feed.append(el('div', { class: 'list-empty', text: err.message }));
    }
  }

  function renderLogsPage() {
    if (logsTimer) { clearInterval(logsTimer); logsTimer = null; }
    $('#p-icon').replaceChildren(icon('logs'));
    $('#p-title').textContent = 'اللوقات المباشرة';
    $('#p-tag').textContent = '@logs';
    $('#p-desc').textContent = 'سجل مباشر لكل شي يصير بالسيرفر — يتحدث تلقائياً.';
    $('#crumbs').innerHTML = '';
    $('#crumbs').append(state.data.guild.name, ' / ', el('b', { text: 'اللوقات المباشرة' }));
    $('#p-toggle-wrap').hidden = true;
    $('#tabs').hidden = true;
    const panel = $('#panel');
    panel.innerHTML = '';

    const filter = el('div', { class: 'log-filter' });
    const feed = el('div', { class: 'log-feed' });
    for (const [key, t] of Object.entries(LOG_TYPES)) {
      filter.append(el('button', {
        class: `chip${logsState.type === key ? ' active' : ''}`, type: 'button',
        onclick: () => { logsState.type = key; renderLogsPage(); },
      }, icon(t.icon), t.label));
    }
    panel.append(el('section', { class: 'card' },
      el('h2', {}, icon('logs'), 'السجل المباشر'),
      el('p', { class: 'card-desc', text: 'آخر 200 حدث — يتحدث كل 10 ثواني.' }),
      filter, feed));
    loadLogs(feed);
    logsTimer = setInterval(() => { if (state.view === 'logs') loadLogs(feed); }, 10000);
  }

  // ── Music bots manager ───────────────────────────────────────
  function musicApi(path, options) { return api(`/api/guilds/${state.data.guild.id}/music${path}`, options); }

  function voiceSelect(value) {
    const s = el('select', { class: 'input' }, el('option', { value: '', text: '— اختر روم فويس —' }), channelOptions('voice'));
    s.value = value || '';
    return s;
  }
  function textSelect(value) {
    const s = el('select', { class: 'input' }, el('option', { value: '', text: '— روم الأوامر (نص) —' }), channelOptions('text'));
    s.value = value || '';
    return s;
  }

  function musicBotCard(b) {
    const dot = { running: 'on', starting: 'warn', error: 'error', stopped: 'off' }[b.status] || 'off';
    const nameInput = el('input', { class: 'input', value: b.name, maxlength: 32 });
    const voice = voiceSelect(b.channelId);
    const cmd = textSelect(b.commandChannelId);
    const vol = el('input', { class: 'input', type: 'number', min: 10, max: 150, value: b.volume });
    const avatarInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif', hidden: true });
    const avatar = el('img', { class: 'mb-avatar', src: b.avatar || '/assets/logo-96.png', alt: '' });

    const save = el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'حفظ' });
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const { bots } = await musicApi(`/${b.id}`, { method: 'PATCH', body: { name: nameInput.value.trim(), channelId: voice.value, commandChannelId: cmd.value, volume: Number(vol.value) } });
        toast('تم الحفظ'); drawMusic(bots);
      } catch (e) { toast(e.message, true); save.disabled = false; }
    });

    const running = b.status === 'running' || b.status === 'starting';
    const power = el('button', { class: `btn btn-sm ${running ? 'btn-ghost' : 'btn-primary'}`, type: 'button', text: running ? 'إيقاف' : 'تشغيل' });
    power.addEventListener('click', async () => {
      power.disabled = true;
      try { const { bots } = await musicApi(`/${b.id}/${running ? 'stop' : 'start'}`, { method: 'POST' }); drawMusic(bots); }
      catch (e) { toast(e.message, true); power.disabled = false; }
    });

    const avatarBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => avatarInput.click() }, icon('image'), 'أفتار');
    avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files[0]; if (!file) return;
      if (file.size > 8 * 1024 * 1024) return toast('الصورة أكبر من 8 ميقا', true);
      try {
        const res = await fetch(`/api/guilds/${state.data.guild.id}/music/${b.id}/avatar`, { method: 'POST', body: file, headers: { 'Content-Type': file.type }, credentials: 'same-origin' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'فشل');
        toast('تم تغيير الأفتار'); drawMusic(body.bots);
      } catch (e) { toast(e.message, true); }
    });

    const del = el('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: async () => {
      if (!confirm(`حذف البوت "${b.name}"؟`)) return;
      try { const { bots } = await musicApi(`/${b.id}`, { method: 'DELETE' }); toast('تم الحذف'); drawMusic(bots); }
      catch (e) { toast(e.message, true); }
    } }, icon('trash'), 'حذف');

    return el('div', { class: 'mb-card' },
      el('div', { class: 'mb-head' }, avatar,
        el('div', { class: 'mb-id' }, nameInput,
          el('small', { class: 'mb-status' },
            icon(dot),
            ` ${b.status}${b.error ? ' — ' + b.error : ''} • ID ${b.botId}`))),
      el('div', { class: 'mb-fields' },
        el('label', {}, 'روم التواجد (فويس)', voice),
        el('label', {}, 'روم الأوامر (نص)', cmd),
        el('label', {}, 'الصوت الافتراضي (10–150)', vol)),
      el('div', { class: 'mb-actions' }, save, power, avatarBtn, del, avatarInput));
  }

  function drawMusic(bots) {
    const list = $('#mb-list');
    if (!list) return;
    list.innerHTML = '';
    if (!bots.length) { list.append(el('div', { class: 'list-empty', text: 'ما فيه بوتات أغاني بعد — أضف واحد فوق.' })); return; }
    for (const b of bots) list.append(musicBotCard(b));
  }

  function renderMusicPage(p) {
    $('#tabs').hidden = true;
    $('#p-toggle-wrap').hidden = true;
    $('#p-icon').replaceChildren(icon('music'));
    $('#p-title').textContent = p.nameAr;
    $('#p-tag').textContent = `@${p.name}`;
    $('#p-desc').textContent = 'أضف بوتات أغاني، حدد رومها، غيّر اسمها وأفتارها وصوتها — كل بوت يشتغل بتوكنه.';
    $('#crumbs').innerHTML = '';
    $('#crumbs').append(state.data.guild.name, ' / ', el('b', { text: p.nameAr }));
    const panel = $('#panel');
    panel.innerHTML = '';

    // Add-bot form
    const token = el('input', { class: 'input', type: 'password', placeholder: 'توكن البوت', maxlength: 120 });
    const voice = voiceSelect('');
    const cmd = textSelect('');
    const addBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, icon('plus'), 'إضافة بوت');
    addBtn.addEventListener('click', async () => {
      if (!token.value.trim()) return toast('حط التوكن', true);
      if (!voice.value) return toast('اختر روم الفويس', true);
      addBtn.disabled = true;
      try {
        const { bots } = await musicApi('', { method: 'POST', body: { token: token.value.trim(), channelId: voice.value, commandChannelId: cmd.value } });
        token.value = ''; toast('تمت الإضافة — شغّال'); drawMusic(bots);
      } catch (e) { toast(e.message, true); } finally { addBtn.disabled = false; }
    });
    panel.append(el('section', { class: 'card' },
      el('h2', {}, icon('plus'), 'إضافة بوت أغاني'),
      el('p', { class: 'card-desc', text: 'لازم تفعّل Message Content Intent لكل بوت من Developer Portal. التوكن يُخزّن مشفّر ولا يظهر مرة ثانية.' }),
      el('div', { class: 'mb-fields' },
        el('label', {}, 'التوكن', token),
        el('label', {}, 'روم التواجد (فويس)', voice),
        el('label', {}, 'روم الأوامر (نص)', cmd)),
      el('div', { style: 'margin-top:12px' }, addBtn)));

    panel.append(el('section', { class: 'card' },
      el('h2', {}, icon('music'), 'بوتات الأغاني'),
      el('div', { id: 'mb-list', style: 'margin-top:12px;display:flex;flex-direction:column;gap:12px' })));

    musicApi('', {}).then(({ bots }) => drawMusic(bots)).catch((e) => toast(e.message, true));
  }

  function renderSettings(panel, p) {
    if (!p.sections.length) {
      panel.append(el('div', { class: 'card' }, el('h2', {}, icon('info'), 'ما فيه إعدادات هنا'), el('p', { class: 'card-desc', text: 'هذا القسم يُدار بالأوامر — شوف تبويب الأوامر.' })));
      return;
    }
    for (const section of p.sections) {
      const fields = el('div', { class: 'fields' });
      for (const f of section.fields || []) {
        fields.append(renderField(f, state.draft, f.key, () => updateSavebar()));
      }
      panel.append(el('section', { class: 'card' },
        el('h2', {}, section.icon ? icon(section.icon) : null, section.title),
        section.description ? el('p', { class: 'card-desc', text: section.description }) : null,
        section.fields?.length ? fields : null));
    }
  }

  // ── Fields ───────────────────────────────────────────────────
  const channelsOf = (type) => state.data.channels.filter((c) => c.type === type);
  const roleById = (id) => state.data.roles.find((r) => r.id === id);
  const channelById = (id) => state.data.channels.find((c) => c.id === id);

  function channelOptions(type) {
    if (type === 'category') return channelsOf('category').map((c) => el('option', { value: c.id, text: `▸ ${c.name}` }));
    if (type === 'voice') return channelsOf('voice').map((c) => el('option', { value: c.id, text: `🔊 ${c.name}` }));
    const groups = new Map([[null, []]]);
    for (const c of channelsOf('text')) {
      if (!groups.has(c.parent)) groups.set(c.parent, []);
      groups.get(c.parent).push(c);
    }
    return [...groups].filter(([, list]) => list.length).map(([parent, list]) => {
      const opts = list.map((c) => el('option', { value: c.id, text: `# ${c.name}` }));
      return parent ? el('optgroup', { label: channelById(parent)?.name || '—' }, opts) : opts;
    }).flat();
  }

  function roleOptions() {
    return state.data.roles.map((r) => el('option', { value: r.id, text: `@ ${r.name}` }));
  }

  function renderField(f, target, key, onChange) {
    const value = getPath(target, key);
    const set = (v) => { setPath(target, key, v); onChange(); };
    const wide = ['textarea', 'list', 'tags', 'roles', 'channels', 'icon'].includes(f.type);
    const wrap = el('div', { class: `field${wide ? ' wide' : ''}`, 'data-key': key });
    const label = el('label', { text: f.label });
    const hint = f.hint ? el('small', { class: 'hint', text: f.hint }) : null;
    const put = (...nodes) => wrap.append(...nodes.filter(Boolean));

    switch (f.type) {
      case 'bool': {
        const input = el('input', { type: 'checkbox', onchange: (e) => set(e.target.checked) });
        input.checked = !!value;
        put(el('div', { class: 'bool-row' },
          el('span', { class: 'bool-text' }, el('b', { text: f.label }), hint),
          el('label', { class: 'switch' }, input, el('span'))));
        return wrap;
      }
      case 'text':
      case 'number': {
        const input = el('input', {
          class: 'input', type: f.type === 'number' ? 'number' : 'text', min: f.min, max: f.max ?? null,
          maxlength: f.type === 'text' ? f.max : null, readonly: f.readonly, dir: 'auto',
          oninput: (e) => set(f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : (e.target.value || (f.nullable ? null : ''))),
        });
        input.value = value ?? '';
        put(label, input, hint);
        return wrap;
      }
      case 'textarea': {
        const count = el('span', { class: 'counter' });
        const input = el('textarea', { class: 'input', maxlength: f.max, dir: 'auto', oninput: (e) => { set(e.target.value); count.textContent = `${e.target.value.length}/${f.max}`; } });
        input.value = value ?? '';
        count.textContent = `${input.value.length}/${f.max}`;
        put(label, input, el('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, hint || el('span'), count));
        return wrap;
      }
      case 'select': {
        const input = el('select', { class: 'input', onchange: (e) => set(e.target.value) }, f.options.map((o) => el('option', { value: o.value, text: o.label })));
        input.value = value ?? f.options[0]?.value;
        if (value == null) setPath(target, key, input.value);
        put(label, input, hint);
        return wrap;
      }
      case 'icon': {
        const grid = el('div', { class: 'icon-grid', role: 'radiogroup' });
        const draw = () => {
          grid.replaceChildren(...state.data.icons.map((name) => el('button', {
            type: 'button', class: `icon-pick${getPath(target, key) === name ? ' active' : ''}`, title: name, 'aria-label': name,
            onclick: () => { set(name); draw(); },
          }, icon(name))));
        };
        draw();
        put(label, grid, hint);
        return wrap;
      }
      case 'channel':
      case 'category':
      case 'role': {
        const input = el('select', { class: 'input', onchange: (e) => set(e.target.value || null) },
          el('option', { value: '', text: '— بدون —' }), f.type === 'role' ? roleOptions() : channelOptions(f.type));
        input.value = value ?? '';
        put(label, input, hint);
        return wrap;
      }
      case 'channels':
      case 'roles': {
        const list = Array.isArray(value) ? [...value] : [];
        const box = el('div', { class: 'chips-field' });
        const draw = () => {
          box.innerHTML = '';
          for (const id of list) {
            const item = f.type === 'roles' ? roleById(id) : channelById(id);
            box.append(el('span', { class: 'pill' },
              f.type === 'roles' ? el('i', { style: `background:${item?.color && item.color !== '#000000' ? item.color : '#8a8a8a'}` }) : null,
              el('span', { text: item ? (f.type === 'roles' ? `@${item.name}` : `#${item.name}`) : id }),
              el('button', { type: 'button', 'aria-label': 'إزالة', text: '×', onclick: () => { list.splice(list.indexOf(id), 1); set([...list]); draw(); } })));
          }
          const picker = el('select', {
            onchange: (e) => { if (e.target.value && !list.includes(e.target.value)) { list.push(e.target.value); set([...list]); draw(); } },
          }, el('option', { value: '', text: f.type === 'roles' ? '+ إضافة رتبة' : '+ إضافة روم' }),
          (f.type === 'roles' ? roleOptions() : channelOptions('text')));
          box.append(picker);
        };
        draw();
        put(label, box, hint);
        return wrap;
      }
      case 'tags': {
        const list = Array.isArray(value) ? [...value] : [];
        const box = el('div', { class: 'chips-field' });
        const add = (raw) => {
          for (const part of String(raw).split(',')) {
            const t = part.trim();
            if (t && !list.includes(t) && list.length < (f.max || 100)) list.push(f.lowercase ? t.toLowerCase() : t);
          }
          set([...list]);
          draw();
        };
        const draw = () => {
          box.innerHTML = '';
          for (const t of list) {
            box.append(el('span', { class: 'pill' }, el('span', { text: t }),
              el('button', { type: 'button', text: '×', onclick: () => { list.splice(list.indexOf(t), 1); set([...list]); draw(); } })));
          }
          const input = el('input', {
            placeholder: 'اكتب واضغط Enter', dir: 'auto',
            onkeydown: (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(e.target.value); } },
            onblur: (e) => { if (e.target.value.trim()) add(e.target.value); },
          });
          box.append(input);
        };
        draw();
        put(label, box, hint);
        return wrap;
      }
      case 'list': {
        const items = Array.isArray(value) ? value : [];
        setPath(target, key, items);
        const listEl = el('div', { class: 'list' });
        const draw = () => {
          listEl.innerHTML = '';
          if (!items.length) listEl.append(el('div', { class: 'list-empty', text: 'ما فيه شي للحين.' }));
          items.forEach((item, i) => {
            const fields = el('div', { class: 'fields' });
            for (const sub of f.fields) fields.append(renderField(sub, item, sub.key, onChange));
            listEl.append(el('div', { class: 'list-item' }, fields,
              el('button', { class: 'remove', type: 'button', title: 'حذف', onclick: () => { items.splice(i, 1); onChange(); draw(); } }, icon('trash'))));
          });
          if (f.addLabel && items.length < (f.max || 25)) {
            listEl.append(el('button', {
              class: 'add-btn', type: 'button', text: `+ ${f.addLabel}`,
              onclick: () => {
                const blank = {};
                for (const sub of f.fields) blank[sub.key] = sub.type === 'bool' ? false : sub.type === 'tags' ? [] : sub.type === 'number' ? (sub.min ?? 0) : sub.type === 'select' ? sub.options[0].value : null;
                items.push(blank);
                onChange();
                draw();
              },
            }));
          }
        };
        draw();
        put(label, hint, listEl);
        return wrap;
      }
      default:
        return wrap;
    }
  }

  // ── Actions & commands tabs ──────────────────────────────────
  function renderActions(panel, p) {
    for (const action of p.actions) {
      const params = {};
      const row = el('div', { class: 'row' });
      for (const f of action.params) row.append(renderField(f, params, f.key, () => {}));
      const button = el('button', { class: `btn ${action.danger ? 'btn-danger' : 'btn-primary'} btn-sm`, type: 'button', text: action.label });
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const res = await api(`/api/guilds/${state.data.guild.id}/plugins/${p.id}/actions/${action.id}`, { method: 'POST', body: { params } });
          toast(res.message);
          replacePlugin(res.plugin, { keepDraft: dirty() });
        } catch (e) {
          toast(e.message, true);
        } finally {
          button.disabled = false;
        }
      });
      row.append(button);
      panel.append(el('section', { class: 'card action-card' },
        el('div', {}, el('h2', {}, icon('sparkles'), action.label), action.description ? el('p', { class: 'card-desc', text: action.description }) : null),
        row));
    }
  }

  function renderImages(panel, p) {
    const base = `/api/guilds/${state.data.guild.id}/plugins/${p.id}/images`;
    const grid = el('div', { class: 'image-grid' });
    for (const im of p.images) {
      const preview = el('img', { class: 'image-preview', alt: im.label, loading: 'lazy', src: `${base}/${im.key}?v=${Date.now()}` });
      const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true });
      const upload = el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => input.click() }, icon('image'), im.custom ? 'تغيير الصورة' : 'رفع صورة');
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) return toast('الصورة أكبر من 8 ميقا', true);
        upload.disabled = true;
        try {
          const res = await fetch(`${base}/${im.key}`, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' }, credentials: 'same-origin' });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || 'فشل الرفع');
          toast(`تم رفع صورة ${im.label}`);
          replacePlugin(body, { keepDraft: dirty() });
        } catch (e) {
          toast(e.message, true);
          upload.disabled = false;
        }
      });
      const reset = im.custom ? el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: async () => {
          try {
            const plugin = await api(`${base}/${im.key}`, { method: 'DELETE' });
            toast('رجعت الصورة الافتراضية');
            replacePlugin(plugin, { keepDraft: dirty() });
          } catch (e) { toast(e.message, true); }
        },
      }, icon('trash'), 'الافتراضية') : null;
      grid.append(el('div', { class: 'image-card' },
        preview,
        el('div', { class: 'image-meta' },
          el('b', {}, icon(im.icon || 'image'), im.label),
          el('small', { text: im.custom ? 'صورة مرفوعة' : 'الصورة الافتراضية' })),
        el('div', { class: 'image-actions' }, upload, reset, input)));
    }
    panel.append(el('section', { class: 'card' },
      el('h2', {}, icon('image'), 'صور الألعاب'),
      el('p', { class: 'card-desc', text: 'هذي الصورة تطلع فوق غرفة الانتظار لكل لعبة. ارفع صورتك (PNG / JPG / GIF / WEBP حتى 8 ميقا)، والمقاس الأنسب 1000×400.' }),
      el('div', { style: 'margin-top:16px' }, grid)));
  }

  function renderCommands(panel, p) {
    const prefix = state.data.prefix;
    const grid = el('div', { class: 'cmd-grid' });
    for (const c of p.commands) {
      const prefixed = c.usage.replace(/^\//, prefix);
      grid.append(el('div', { class: 'cmd-row' },
        el('code', { text: c.usage, dir: 'rtl' }),
        el('span', { class: 'alt', text: `بالبريفكس: ${prefixed}` }),
        el('p', { text: c.description })));
    }
    panel.append(el('section', { class: 'card' },
      el('h2', {}, icon('keyboard'), `أوامر ${p.nameAr}`),
      el('p', { class: 'card-desc', text: `كل أمر يشتغل بالسلاش أو بالبريفكس ${prefix} — <> إجباري • [] اختياري` }),
      el('div', { style: 'margin-top:14px' }, grid)));
  }

  function replacePlugin(plugin, { keepDraft = false } = {}) {
    const i = state.data.plugins.findIndex((x) => x.id === plugin.id);
    state.data.plugins[i] = plugin;
    if (!keepDraft && plugin.id === state.pluginId) {
      state.original = clone(plugin.config || {});
      state.draft = clone(plugin.config || {});
    }
    if (plugin.id === 'settings' && plugin.config?.prefix) {
      state.data.prefix = plugin.config.prefix;
      $('#server-meta').textContent = `${state.data.guild.members.toLocaleString('en-US')} عضو • البريفكس ${state.data.prefix}`;
    }
    renderMenu();
    renderPage();
    updateSavebar();
  }

  // ── Events ───────────────────────────────────────────────────
  $('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    state.tab = tab.dataset.tab;
    renderPage();
  });

  $('#p-toggle').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    try {
      const plugin = await api(`/api/guilds/${state.data.guild.id}/plugins/${state.pluginId}`, { method: 'PUT', body: { enabled } });
      plugin.config = current().config;
      replacePlugin(plugin, { keepDraft: true });
      toast(enabled ? 'تم تشغيل القسم' : 'تم إيقاف القسم');
    } catch (err) {
      e.target.checked = !enabled;
      toast(err.message, true);
    }
  });

  $('#save-btn').addEventListener('click', async () => {
    const btn = $('#save-btn');
    btn.disabled = true;
    $$('.field.error').forEach((f) => f.classList.remove('error'));
    try {
      const plugin = await api(`/api/guilds/${state.data.guild.id}/plugins/${state.pluginId}`, { method: 'PUT', body: { config: state.draft } });
      replacePlugin(plugin);
      toast('تم حفظ التغييرات');
    } catch (e) {
      toast(e.message, true);
      if (e.body?.field) $(`.field[data-key="${CSS.escape(e.body.field)}"]`)?.classList.add('error');
    } finally {
      btn.disabled = false;
    }
  });

  $('#reset-btn').addEventListener('click', () => {
    state.draft = clone(state.original);
    renderPage();
    updateSavebar();
  });

  $('#server-btn').addEventListener('click', () => {
    if (state.guilds.length > 1) gate('اختر السيرفر اللي تبي تديره:', { login: false, guilds: state.guilds });
    else toast('البوت موجود في سيرفر واحد بس');
  });

  function closeDrawer() {
    $('#sidebar').classList.remove('open');
    $('#scrim').classList.remove('show');
  }
  $('#menu-toggle').addEventListener('click', () => {
    $('#sidebar').classList.add('open');
    $('#scrim').classList.add('show');
  });
  $('#scrim').addEventListener('click', closeDrawer);

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (state.data && id !== state.pluginId && state.data.plugins.some((p) => p.id === id)) selectPlugin(id);
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty()) e.preventDefault();
  });

  boot();
})();
