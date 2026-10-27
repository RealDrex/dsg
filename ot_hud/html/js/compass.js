/* ot-hud — by drex */
/* Compass bar + blips + "press X" focus prompt.
   Light version: the tape is built once and moved with a single transform per frame,
   blips are pooled, the heading is smoothed between Lua updates. */
(function () {
  var S = window.HUD, el = document.getElementById('compass');
  var PX = 4; // px per degree at 1080p (637px tape ≈ 160°)
  var HALF = 318.6, RANGE = 80;
  var CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  var DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  el.innerHTML =
    '<div class="cmp-tape"><div class="cmp-strip"></div><div class="cmp-blips"></div></div><div class="cmp-needle"></div>' +
    '<div class="cmp-info"><span class="cmp-dir"></span><span class="cmp-sep"></span><span class="cmp-street"></span>' +
    '<span class="cmp-sep wp-sep" style="display:none"></span><span class="cmp-wp" style="display:none"></span></div>' +
    '<div class="cmp-focus" style="display:none"><div class="cmp-pill"></div><div class="cmp-key"><span class="key">X</span><span class="lbl"></span></div></div>';
  var strip = el.querySelector('.cmp-strip'), blipLayer = el.querySelector('.cmp-blips');
  var dir = el.querySelector('.cmp-dir'), street = el.querySelector('.cmp-street');
  var wpSep = el.querySelector('.wp-sep'), wpTxt = el.querySelector('.cmp-wp');
  var focus = el.querySelector('.cmp-focus'), pill = el.querySelector('.cmp-pill'), lbl = focus.querySelector('.lbl'), keyEl = focus.querySelector('.key');

  var norm = function (d) { return ((d % 360) + 540) % 360 - 180; };
  var fmt = function (m) { return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.round(m) + 'm'; };
  var L = function (k, def) { return (S.labels.Compass && S.labels.Compass[k]) || def; };
  var px = function (v) { return 'calc(' + v.toFixed(1) + 'px * var(--s))'; };

  // static tape from -180° to 540° so any heading 0..360 ± RANGE is covered
  var names = null;
  function buildTape() {
    names = [L('north', 'N'), L('northEast', 'NE'), L('east', 'E'), L('southEast', 'SE'), L('south', 'S'), L('southWest', 'SW'), L('west', 'W'), L('northWest', 'NW')];
    var html = '';
    for (var d = -180; d <= 540; d += 5) {
      var deg = ((d % 360) + 360) % 360, card = CARD[deg] != null, lab = deg % 15 === 0, x = px((d + 180) * PX);
      html += '<i class="cmp-tick' + (card ? ' card' : lab ? ' lab' : '') + '" style="left:' + x + '"></i>';
      if (card || lab) html += '<span class="cmp-label' + (card ? ' card' : '') + '" style="left:' + x + '">' + (card ? names[deg / 45] : deg + '°') + '</span>';
    }
    strip.innerHTML = html;
  }
  buildTape();

  var cur = null, target = 0, pool = {}, lastFocusKey = '', labelsRef = null;

  S.subscribe(function () {
    var c = S.compass;
    if (S.labels !== labelsRef) { labelsRef = S.labels; buildTape(); keyEl.textContent = L('key', 'X'); }
    target = ((c.heading || 0) % 360 + 360) % 360;
    if (cur === null) cur = target;

    street.textContent = c.street ? (c.area ? c.street + ' / ' + c.area : c.street) : (c.area || '');

    // blips (pooled)
    var seen = {}, blips = c.blips || [];
    for (var i = 0; i < blips.length; i++) {
      var b = blips[i], key = String(b.id), n = pool[key];
      var look = (b.sprite || '') + '|' + (b.spriteName || '') + '|' + (b.color || '') + '|' + (b.icon || '');
      if (!n) { n = document.createElement('div'); n.className = 'cmp-blip'; blipLayer.appendChild(n); pool[key] = n; }
      if (n._look !== look) { n.innerHTML = window.blipIcon(b); n._look = look; }
      n._b = b;
      n.classList.toggle('wp', c.waypoint != null && b.id === c.waypoint);
      n.classList.toggle('focus', c.focus != null && b.id === c.focus);
      seen[key] = true;
    }
    for (var k in pool) if (!seen[k]) { pool[k].remove(); delete pool[k]; }

    var wp = blips.find(function (b) { return c.waypoint != null && b.id === c.waypoint; });
    wpSep.style.display = wpTxt.style.display = wp ? '' : 'none';
    if (wp) wpTxt.textContent = (wp.name || '') + ' · ' + fmt(wp.distance || 0);

    // focus is decided in Lua (close + aimed for a moment), the UI only shows it
    var f = c.focus != null ? blips.find(function (b) { return b.id === c.focus; }) : null;
    focus.style.display = f ? '' : 'none';
    if (f) {
      var fk = f.id + '|' + f.sprite + '|' + f.color;
      if (fk !== lastFocusKey) { pill.innerHTML = window.blipIcon(f) + '<span></span>'; lastFocusKey = fk; }
      pill.lastChild.textContent = (f.name || '') + ' · ' + fmt(f.distance || 0);
      lbl.textContent = c.waypoint === f.id ? L('removeWaypoint', 'Remove waypoint') : L('setWaypoint', 'Set waypoint');
    } else lastFocusKey = '';
    S.focusedBlip = f ? f.id : null;
  });

  var last = performance.now();
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (cur !== null && !el.classList.contains('off')) {
      var diff = norm(target - cur);
      if (Math.abs(diff) > 0.01) {
        cur = ((cur + diff * Math.min(1, dt * 12)) % 360 + 360) % 360;
      }
      strip.style.transform = 'translateX(' + px(HALF - (cur + 180) * PX) + ')';
      dir.textContent = names[Math.round(cur / 45) % 8] || DIRS[Math.round(cur / 45) % 8];
      for (var k in pool) {
        var n = pool[k], dl = norm(n._b.bearing - cur);
        if (Math.abs(dl) > RANGE - 2) { if (n.style.display !== 'none') n.style.display = 'none'; continue; }
        if (n.style.display) n.style.display = '';
        n.style.left = px(HALF + dl * PX);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
