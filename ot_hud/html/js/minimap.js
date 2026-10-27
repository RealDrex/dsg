/* ot-hud — by drex */
/* Rectangular minimap frame (native radar sits under .mm-window) + N/E/S/W riding the frame + clock */
(function () {
  var S = window.HUD, el = document.getElementById('minimap'), clock = document.getElementById('clock');
  el.innerHTML = '<div class="mm-window"></div>' +
    '<div class="mm-ring"></div>' +
    
    '<span class="mm-dir n">N</span><span class="mm-dir">E</span><span class="mm-dir">S</span><span class="mm-dir">W</span>' +
    '<div class="mm-tab">' +
    '<svg class="cap l"><path class="tabf"></path><path class="tabl"></path></svg>' +
    '<div class="mid"><span class="mm-hdg"><span></span></span><span class="mm-zone"></span></div>' +
    '<svg class="cap r"><path class="tabf"></path><path class="tabl"></path></svg>' +
    '</div><div class="mm-scan"></div>';
  var dirs = el.querySelectorAll('.mm-dir'), zone = el.querySelector('.mm-zone'), hdg = el.querySelector('.mm-hdg span');
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], MO = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var cd = clock.querySelector('.d'), ct = clock.querySelector('.t');
  var mid = el.querySelector('.mm-tab .mid');
  /* tab caps drawn in real pixels so the blue line meets the frame line exactly at any scale */
  function buildCaps() {
    var s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
    var W = 40 * s, H = 34 * s, base = H - 12 * s, y = base - 1, top = 1, k = W * 0.5;
    el.querySelectorAll('.mm-tab .cap').forEach(function (svg) {
      var right = svg.classList.contains('r');
      svg.setAttribute('viewBox', '0 0 ' + W.toFixed(2) + ' ' + H.toFixed(2));
      var f = svg.querySelector('.tabf'), l = svg.querySelector('.tabl');
      if (!right) {
        f.setAttribute('d', 'M0 ' + H + ' L0 ' + (base - 2) + ' C' + k + ' ' + (base - 2) + ' ' + k + ' 0 ' + W + ' 0 L' + W + ' ' + H + ' Z');
        l.setAttribute('d', 'M0 ' + y + ' C' + k + ' ' + y + ' ' + k + ' ' + top + ' ' + (W + 1) + ' ' + top);
      } else {
        f.setAttribute('d', 'M0 0 C' + k + ' 0 ' + k + ' ' + (base - 2) + ' ' + W + ' ' + (base - 2) + ' L' + W + ' ' + H + ' L0 ' + H + ' Z');
        l.setAttribute('d', 'M-1 ' + top + ' C' + k + ' ' + top + ' ' + k + ' ' + y + ' ' + W + ' ' + y);
      }
    });
  }
  buildCaps();
  window.addEventListener('resize', function () { setTimeout(buildCaps, 30); });
  function setZone(txt) {
    var from = mid.getBoundingClientRect().width;
    zone.textContent = txt;
    mid.style.width = 'auto';
    var to = mid.getBoundingClientRect().width;
    if (!from || Math.abs(to - from) < 1) { mid.style.width = ''; return; }
    mid.style.width = from + 'px';
    void mid.offsetWidth;
    mid.style.width = to + 'px';
    zone.classList.remove('swap'); void zone.offsetWidth; zone.classList.add('swap');
    clearTimeout(mid._t); mid._t = setTimeout(function () { mid.style.width = ''; }, 380);
  }
  var p = function (n) { return (n < 10 ? '0' : '') + n; };

  function tick() {
    var d = new Date(), w = S.weather || {};
    var h = w.hour != null ? w.hour : d.getHours(), m = w.minute != null ? w.minute : d.getMinutes();
    ct.innerHTML = p(h) + '<i>:</i>' + p(m);
    cd.innerHTML = '<b>' + DAYS[w.day != null ? w.day : d.getDay()] + '</b>'; // in-game day when Lua sends it
  }
  tick();
  setInterval(tick, 1000);

  /* tell Lua where the map hole is (normalized 0..1) so the native radar lines up on any resolution */
  var lastRect = '';
  function sendRect() {
    if (el.style.display === 'none' || !el.offsetParent) return;
    // never measure while the frame is still sliding in: Lua would place the radar a few px off
    var moving = el.getAnimations ? el.getAnimations({ subtree: true }).some(function (a) { return a.playState === 'running'; }) : false;
    if (moving) { queueRect(150); return; }
    var r = el.querySelector('.mm-window').getBoundingClientRect(), W = innerWidth, H = innerHeight;
    var data = { x: r.left / W, y: r.top / H, w: r.width / W, h: r.height / H, resX: W, resY: H };
    var key = [data.x, data.y, data.w, data.h].map(function (v) { return v.toFixed(4); }).join(',');
    if (key === lastRect) return;
    lastRect = key; S.minimapRect = data; S.post('minimap:rect', data);
  }
  // re-measure only when something can have moved it (resize / map shown), not on every update
  var rectTimer = null, wasShown = false;
  function queueRect(ms) { clearTimeout(rectTimer); rectTimer = setTimeout(sendRect, ms); }
  window.addEventListener('resize', function () { lastRect = ''; queueRect(80); });
  S.subscribe(function () {
    var shown = el.style.display !== 'none';
    if (shown && !wasShown) queueRect(900); // after the enter animation (mm-window settles at ~0.6s)
    wasShown = shown;
  });
  setInterval(function () { if (el.style.display !== 'none') sendRect(); }, 3000); // safety net

  var sc = 1;
  function readScale() { sc = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1; }
  readScale();
  window.addEventListener('resize', function () { setTimeout(readScale, 20); });
  S.subscribe(function () {
    if (el.style.display === 'none') return;
    if (S.scaleDirty) { S.scaleDirty = false; readScale(); buildCaps(); lastRect = ''; queueRect(900); }
    var W = el.clientWidth, H = el.clientHeight, inset = 6 * sc, tabW = (el.querySelector('.mm-tab') || {}).offsetWidth || 190 * sc; // centre of the dark border
    var hw = W / 2 - inset, hh = H / 2 - inset, h = S.compass.heading || 0;
    for (var i = 0; i < 4; i++) {
      var a = (i * 90 - h) * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
      var t = Math.min(dx ? hw / Math.abs(dx) : 1e9, dy ? hh / Math.abs(dy) : 1e9);
      dirs[i].style.left = (W / 2 + dx * t).toFixed(1) + 'px';
      dirs[i].style.top = (H / 2 + dy * t).toFixed(1) + 'px';
      var bx = W / 2 + dx * t, by = H / 2 + dy * t;
      var tw = tabW / 2 + 12 * sc;
      dirs[i].classList.toggle('hid', by > H - 40 * sc && Math.abs(bx - W / 2) < tw);
    }
    var c = S.compass;
    var zt = c.zone || c.street || '';
    if (zt !== zone.textContent) setZone(zt);
    hdg.textContent = String(Math.round(((h % 360) + 360) % 360)).padStart(3, '0') + '°';
  });
})();
