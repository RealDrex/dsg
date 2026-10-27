/* ot-hud — by drex */
/* Player status: hexagon health + square tiles (mic, armor, hunger, thirst, stress, extras) */
(function () {
  var S = window.HUD, el = document.getElementById('player');
  var HEX = function (s) { var c = [[50, 4], [94, 29], [94, 81], [50, 106], [6, 81], [6, 29]]; return c.map(function (q) { return (50 + (q[0] - 50) * s).toFixed(1) + ',' + (55 + (q[1] - 55) * s).toFixed(1); }).join(' '); };
  el.innerHTML = '<div class="hex"><svg viewBox="0 0 100 110"><defs><clipPath id="hexclip"><polygon points="' + HEX(0.74) + '"></polygon></clipPath></defs>' +
    '<polygon class="o" points="' + HEX(1) + '"></polygon><polygon class="i" points="' + HEX(0.76) + '"></polygon>' +
    '<rect class="f" x="0" y="110" width="100" height="0" clip-path="url(#hexclip)"></rect>' +
    '<svg x="31" y="36" width="38" height="38" viewBox="0 0 24 24"><path class="h" d="' + window.ICONS.heart[1] + '"></path></svg></svg></div><div class="stats"></div>';
  var hex = el.querySelector('.hex'), hexFill = el.querySelector('.hex .f'), stats = el.querySelector('.stats');
  var nodes = {};

  function tile(key, icon) {
    var n = nodes[key];
    if (!n) {
      n = document.createElement('div');
      n.className = 'tile';
      n.innerHTML = '<div class="tb"><div class="tf"></div></div>' + window.svgIcon(icon) + (key === 'mic' ? '<div class="eq"><i></i><i></i><i></i><i></i></div>' : '');
      stats.appendChild(n);
      nodes[key] = n;
      n._icon = icon;
    } else if (n._icon !== icon) {
      n.querySelector('svg').outerHTML = window.svgIcon(icon);
      n._icon = icon;
    }
    n._seen = true;
    return n;
  }
  function set(n, v, color, cls) {
    v = Math.max(0, Math.min(100, v));
    n.firstChild.firstChild.style.height = v + '%';
    n.className = 'tile' + (cls ? ' ' + cls : '');
  }
  var pct = function (o) { return o && o.max ? Math.round((o.current / o.max) * 100) : (typeof o === 'number' ? o : 0); };

  S.subscribe(function () {
    var st = S.status, m = S.mic;
    var h = Math.max(0, Math.min(100, pct(st.health)));
    var fh = 82 * h / 100; hexFill.setAttribute('y', (96 - fh).toFixed(1)); hexFill.setAttribute('height', fh.toFixed(1));
    hex.classList.toggle('low', h <= 25);

    Object.keys(nodes).forEach(function (k) { nodes[k]._seen = false; });
    var mv = m.maxLevel ? (m.currentLevel / m.maxLevel) * 100 : 0;
    set(tile('mic', m.radio ? 'radio' : 'microphone'), mv, 'var(--talking)', m.talking ? 'talking' : '');
    set(tile('armor', 'shield'), pct(st.armor), 'var(--light)', '');
    set(tile('hunger', 'food'), st.hunger, 'var(--hunger)', 'food' + (st.hunger <= 20 ? ' low' : ''));
    set(tile('thirst', 'cup'), st.thirst, 'var(--thirst)', st.thirst <= 20 ? 'low' : '');
    if (st.stress > 0) set(tile('stress', 'stress'), st.stress, 'var(--stress)', '');
    if (st.breath < 100) set(tile('breath', 'lungs'), st.breath, 'var(--primary)', st.breath <= 20 ? 'low' : '');
    if (st.stamina < 100 && !S.inVehicle) set(tile('stamina', 'oxygen'), st.stamina, 'var(--primary-light)', st.stamina <= 15 ? 'low' : '');
    Object.keys(st.custom).forEach(function (id) {
      var c = st.custom[id];
      set(tile('c_' + id, c.icon), c.value, c.color || 'var(--primary)', '');
    });
    Object.keys(nodes).forEach(function (k) { if (!nodes[k]._seen) { nodes[k].remove(); delete nodes[k]; } });
  });
})();
