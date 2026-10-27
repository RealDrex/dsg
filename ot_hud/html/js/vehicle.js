/* ot-hud — by drex */
/* Vehicle HUD: one bent RPM line (dot start), RPM numbers along it, inner fuel line, big speed, icons */
(function () {
  var S = window.HUD, el = document.getElementById('vehicle');
  var NS = 'http://www.w3.org/2000/svg';
  var MAIN = 'M14 138 L78 64 Q96 44 124 41 L346 20';
  var FUEL = 'M66 118 L92 88';
  el.innerHTML =
    '<svg class="vh-svg" viewBox="0 0 360 150">' +
    '<g class="marks"></g>' +
    '<path class="trk draw" d="' + MAIN + '" stroke-width="13" pathLength="100"></path>' +
    '<path class="fill" d="' + MAIN + '" stroke-width="7" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"></path>' +
    '<circle class="dot" cx="14" cy="138" r="7.5"></circle>' +
    '<path class="trk draw" d="' + FUEL + '" stroke-width="6" pathLength="100"></path>' +
    '<path class="fuelf" d="' + FUEL + '" stroke-width="3" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"></path>' +
    '</svg>' +
    window.svgIcon('gas', 'vh-fuel-ic') +
    '<div class="vh-speed"><div class="vh-meta"><span class="unit"></span><div class="vh-gear">N</div></div><b>0</b></div>' +
    '<div class="vh-icons">' +
    window.svgIcon('car-body', 'ic engine') + window.svgIcon('seatbelt', 'ic belt') + window.svgIcon('light-low', 'ic lights') +
    window.svgIcon('lock', 'ic lock') + window.svgIcon('cruise-control', 'ic cruise') + window.svgIcon('nos', 'ic nos') + window.svgIcon('harness', 'ic harness') +
    '</div>';
  var svg = el.querySelector('svg'), marks = el.querySelector('.marks'), fill = el.querySelector('.fill'), fuelf = el.querySelector('.fuelf');
  var fuelIc = el.querySelector('.vh-fuel-ic');
  fuelIc.style.left = (100 / 360 * 100) + '%'; fuelIc.style.top = (84 / 150 * 100) + '%';
  var speedEl = el.querySelector('.vh-speed b'), unitEl = el.querySelector('.unit'), gearEl = el.querySelector('.vh-gear');
  var q = function (c) { return el.querySelector('.vh-icons .' + c); };
  var I = { engine: q('engine'), belt: q('belt'), lights: q('lights'), lock: q('lock'), cruise: q('cruise'), nos: q('nos'), harness: q('harness') };
  var shown = 0, target = 0, raf = null, lastLights = 'low', labels = [];

  // RPM numbers 1..8 along the outside of the line
  (function () {
    var path = fill, len = path.getTotalLength(), N = 8;
    for (var i = 1; i <= N; i++) {
      var at = (0.1 + (i - 1) / (N - 1) * 0.88) * len;
      var p = path.getPointAtLength(at), p2 = path.getPointAtLength(Math.min(len, at + 1));
      var tx = p2.x - p.x, ty = p2.y - p.y, m = Math.hypot(tx, ty) || 1, nx = ty / m, ny = -tx / m; // left normal (outside)
      var red = i >= 7;
      var tk = document.createElementNS(NS, 'line');
      tk.setAttribute('x1', p.x + nx * 9); tk.setAttribute('y1', p.y + ny * 9); tk.setAttribute('x2', p.x + nx * 12); tk.setAttribute('y2', p.y + ny * 12);
      tk.setAttribute('class', 'tick' + (red ? ' red' : ''));
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', (p.x + nx * 19).toFixed(1)); t.setAttribute('y', (p.y + ny * 19).toFixed(1));
      t.setAttribute('class', red ? 'red' : ''); t.textContent = i;
      marks.appendChild(tk); marks.appendChild(t); labels.push({ t: t, red: red, v: (i - 1) / (N - 1) });
    }
  })();

  function tween() {
    shown += (target - shown) * 0.25;
    if (Math.abs(target - shown) < 0.5) shown = target;
    speedEl.textContent = Math.round(shown);
    raf = shown !== target ? requestAnimationFrame(tween) : null;
  }
  var unitLabel = function (u) { u = String(u || 'KMH').toUpperCase(); return u === 'MPH' ? 'MPH' : 'KM/H'; };

  S.subscribe(function () {
    var v = S.vehicle;
    if (!S.inVehicle || v.aircraft) return;
    target = Math.max(0, v.speed || 0);
    if (!raf) raf = requestAnimationFrame(tween);
    unitEl.textContent = unitLabel(S.config.speedometerUnit);

    var r = Math.max(0, Math.min(100, v.RPM || 0));
    fill.setAttribute('stroke-dashoffset', (100 - r).toFixed(1));
    fill.classList.toggle('red', r >= 92);
    labels.forEach(function (l) { l.t.classList.toggle('on', !l.red && r / 100 >= l.v); });

    var fl = Math.max(0, Math.min(100, v.fuel.level)), electric = v.fuel && v.fuel.type !== 'gasoline';
    fuelf.setAttribute('stroke-dashoffset', (100 - fl).toFixed(1));
    fuelf.classList.toggle('low', fl <= 20);
    fuelIc.classList.toggle('low', fl <= 20);
    if (electric !== fuelIc._el) { fuelIc._el = electric; var d0 = document.createElement('div'); d0.innerHTML = window.svgIcon(electric ? 'bolt' : 'gas', 'vh-fuel-ic'); fuelIc.querySelector('path').setAttribute('d', d0.querySelector('path').getAttribute('d')); }

    gearEl.style.display = electric ? 'none' : '';
    gearEl.textContent = v.gear === -1 ? 'R' : v.gear === 0 ? 'N' : v.gear;
    gearEl.classList.toggle('r', v.gear === -1);

    if (v.lights !== lastLights) {
      var d = document.createElement('div');
      d.innerHTML = window.svgIcon(v.lights === 'high' ? 'light-high' : 'light-low', 'ic lights');
      I.lights.replaceWith(d.firstChild); I.lights = q('lights'); lastLights = v.lights;
    }
    var set = function (n, state) { n.classList.remove('on', 'off', 'warn'); if (state) n.classList.add(state); };
    set(I.engine, !v.engine.active || v.engine.durability <= 30 || v.body <= 30 ? 'warn' : '');
    set(I.belt, v.seatbelt ? 'on' : (target > 10 ? 'warn' : 'off'));
    set(I.lights, v.lights && v.lights !== 'off' ? 'on' : 'off');
    set(I.lock, v.locked ? 'on' : 'off');
    set(I.cruise, v.cruiseControl ? 'on' : 'off');
    I.cruise.style.display = v.cruiseControl ? '' : 'none';
    I.nos.style.display = v.NOS && v.NOS.active ? '' : 'none';
    set(I.nos, v.NOS && v.NOS.level > 0 ? 'on' : 'off');
    I.harness.style.display = v.harness && v.harness.active ? '' : 'none';
    set(I.harness, 'on');
  });
})();
