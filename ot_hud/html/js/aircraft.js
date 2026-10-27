/* ot-hud — by drex */
/* Aircraft HUD (heli / plane): airspeed, attitude, altitude, V/S, throttle, fuel, engine, gear */
(function () {
  var S = window.HUD, el = document.getElementById('aircraft');
  var segs = '<div class="segs">' + '<i></i>'.repeat(8) + '</div>';
  el.innerHTML =
    '<div class="ac-row">' +
    '<div class="ac-read l"><small>AIRSPEED</small><b class="spd">0<span>KTS</span></b></div>' +
    '<div class="ac-att"><div class="ac-horizon"></div><div class="ac-wings"></div><div class="ac-dot"></div></div>' +
    '<div class="ac-read"><small>ALTITUDE</small><b class="alt">0<span>FT</span></b><span class="ac-vs"></span></div>' +
    '</div>' +
    '<div class="ac-gauges">' +
    '<div class="ac-g thr"><small>THR</small>' + segs + '</div>' +
    '<div class="ac-g fuel"><small>FUEL</small>' + segs + '</div>' +
    '<div class="ac-g eng" style="--c:var(--light)"><small>ENG</small>' + segs + '</div>' +
    '<span class="ac-gear">GEAR UP</span></div>';
  var spd = el.querySelector('.spd'), alt = el.querySelector('.alt'), vs = el.querySelector('.ac-vs'), hor = el.querySelector('.ac-horizon'), gear = el.querySelector('.ac-gear');
  var g = { thr: el.querySelectorAll('.thr i'), fuel: el.querySelectorAll('.fuel i'), eng: el.querySelectorAll('.eng i') };
  var fuelBox = el.querySelector('.fuel');
  var fill = function (list, v) { var n = Math.ceil(Math.max(0, Math.min(100, v)) / 12.5); list.forEach(function (s, i) { s.classList.toggle('on', i < n); }); };

  S.subscribe(function () {
    var v = S.vehicle, a = v.aircraft;
    if (!S.inVehicle || !a) return;
    var speed = a.airspeed != null ? a.airspeed : v.speed;
    spd.firstChild.nodeValue = Math.round(speed || 0);
    alt.firstChild.nodeValue = Math.round(a.altitude || 0).toLocaleString('en-US');
    var s = Math.round(a.verticalSpeed || 0);
    vs.textContent = (s >= 0 ? '▲ ' : '▼ ') + Math.abs(s) + ' FPM';
    vs.style.color = s >= 0 ? '#4ade80' : '#f87171';
    hor.style.transform = 'rotate(' + ((S.config.invertRoll ? 1 : -1) * (a.roll || 0)).toFixed(1) + 'deg) translateY(' + 'calc(' + ((a.pitch || 0) * 0.86).toFixed(1) + 'px * var(--s)))';
    fill(g.thr, a.throttle != null ? a.throttle : 0);
    fill(g.fuel, v.fuel.level);
    fuelBox.style.setProperty('--c', v.fuel.level <= 20 ? 'var(--danger)' : 'var(--thirst)');
    fill(g.eng, v.engine.durability);
    var hasGear = a.gearDown != null;
    gear.style.display = hasGear ? '' : 'none';
    gear.textContent = a.gearDown ? 'GEAR DOWN' : 'GEAR UP';
    gear.classList.toggle('down', !!a.gearDown);
  });
})();
