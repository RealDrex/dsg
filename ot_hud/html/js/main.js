/* ot-hud — by drex */
/* Visibility rules + browser demo (only runs outside FiveM) */
(function () {
  var S = window.HUD, app = document.getElementById('app');
  var $ = function (id) { return document.getElementById(id); };
  var mode = function (key) {
    var v = (S.config.visibility || {})[key];
    if (v === 'off' || v === 'never') return false;
    if (v === 'vehicle') return S.inVehicle;
    return true;
  };

  function flip(node, before) {
    var after = node.getBoundingClientRect().top, dy = before - after;
    if (Math.abs(dy) < 1) return;
    node.style.transition = 'none';
    node.style.transform = 'translateY(' + dy + 'px)';
    void node.offsetWidth;
    node.style.transition = 'transform .45s cubic-bezier(.2,.8,.2,1), opacity .2s ease';
    node.style.transform = '';
    clearTimeout(node._ft); node._ft = setTimeout(function () { node.style.transition = ''; }, 480);
  }
  function anim(node, show) {
    var on = node.dataset.on === '1';
    if (show === on) return;
    node.dataset.on = show ? '1' : '0';
    clearTimeout(node._t);
    node.classList.remove('enter', 'leave');
    if (show) { node.style.display = ''; void node.offsetWidth; node.classList.add('enter'); }
    else if (node.style.display !== 'none' && node.offsetParent && node.id !== 'vehicle') { node.classList.add('leave'); node._t = setTimeout(function () { node.style.display = 'none'; node.classList.remove('leave'); }, 260); }
    else node.style.display = 'none';
  }
  $('minimap').style.display = 'none'; $('vehicle').style.display = 'none';

  S.subscribe(function () {
    var hidden = S.disableAll || S.cinematic;
    app.classList.toggle('shift', !!S.shift);
    if (S.shiftPx) app.style.setProperty('--shift-px', String(+S.shiftPx));
    app.classList.toggle('hidden', hidden);
    var air = S.inVehicle && !!S.vehicle.aircraft;
    $('player').classList.toggle('off', !S.show.playerStatus);
    $('compass').classList.toggle('off', !(S.show.compass && mode('compass')));
    anim($('minimap'), mode('map') && S.show.minimap !== false);
    $('weapon').classList.toggle('off', !(S.show.weaponHUD && S.weapon && !air));
    $('weapon').style.display = S.weapon && !air ? '' : 'none';
    var wp = $('weapon'), before = wp.offsetParent ? wp.getBoundingClientRect().top : null, vOn = $('vehicle').dataset.on;
    anim($('vehicle'), S.inVehicle && !air && S.show.vehicleHUD);
    if (before != null && vOn !== $('vehicle').dataset.on) flip(wp, before);
    $('aircraft').classList.toggle('off', !(air && S.show.vehicleHUD));
  });

  if (S.isFiveM) { window.postMessage({ action: 'ready' }, '*'); return; }
  document.body.classList.add('demo');
  S.config.visibility = { compass: 'vehicle', map: 'vehicle' };

  /* ---------- demo ---------- */
  document.body.style.background = '#1a1d24 radial-gradient(120% 80% at 50% 100%, #222833, #0c0e12)';
  var send = function (m) { window.postMessage(m, '*'); };
  send({ action: 'disableAll', state: false });
  var t = 0, mag = 9, total = 237, m = 0, phone = false;
  var bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;gap:8px;font:600 12px Satoshi,sans-serif';
  ['On foot', 'Car', 'Heli', 'Notify', 'Fire', 'Phone'].forEach(function (l, i) {
    var b = document.createElement('button');
    b.textContent = l;
    b.style.cssText = 'height:30px;padding:0 12px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font:inherit';
    b.onclick = function () {
      if (i < 3) m = i;
      if (i === 3) send({ action: 'notif', notifData: { message: 'Vehicle stored in garage', type: ['info', 'success', 'warning', 'fail'][t % 4] } });
      if (i === 4) mag = mag > 0 ? mag - 1 : (total -= 12, 12);
      if (i === 5) { phone = !phone; send({ action: 'hud:shift', state: phone }); }
    };
    bar.appendChild(b);
  });
  document.body.appendChild(bar);
  var waypoint = null;
  window.addEventListener('keydown', function (e) { if ((e.key === 'x' || e.key === 'X') && S.focusedBlip != null) waypoint = waypoint === S.focusedBlip ? null : S.focusedBlip; });
  // same rule as Lua: close (<=150m) and the compass pointed at it (<=5°)
  var demoFocus = function (h, list) {
    var best = null;
    list.forEach(function (b) { var a = Math.abs(((b.bearing - h) % 360 + 540) % 360 - 180); if (b.distance <= 150 && a <= 5 && (!best || a < best.a)) best = { id: b.id, a: a }; });
    return best ? best.id : null;
  };

  setInterval(function () {
    t++;
    var cyc = (t % 220) / 220, heading = 200 + Math.sin(t / 140) * 55;
    var blips = [
      { id: 1, name: 'Garage', sprite: 357, color: '#5db6e5', bearing: 214, distance: 12 + Math.abs(Math.sin(t / 70)) * 120 },
      { id: 2, name: 'Gas station', sprite: 361, color: '#e03232', bearing: 152, distance: 420 },
      { id: 3, name: 'Hospital', sprite: 61, bearing: 172, distance: 1860 },
    ];
    var msg = {
      action: 'update',
      statusData: { health: { current: 156, max: 200 }, armor: { current: 75, max: 100 }, hunger: 50, thirst: 15, stress: 0 },
      micData: { talking: Math.sin(t / 15) > 0.3, currentLevel: 2, maxLevel: 3, radio: false },
      compassData: {
        zone: Math.sin(t / 40) > 0 ? 'Los Santos Freeway' : 'Pillbox Hill',
        heading: heading, street: heading < 200 ? 'Los Santos Freeway' : 'Power St', area: '',
        blips: blips,
        waypoint: waypoint,
        focus: demoFocus(heading, blips),
      },
      weaponData: m === 2 ? null : { name: 'Pistol MK2', magCapacity: 12, magContent: mag, totalAmmo: total, durability: { active: true, value: 82 } },
      vehicleData: m === 0 ? { speed: null } : {
        speed: m === 1 ? Math.round(cyc * 140) : 182 + Math.sin(t / 20) * 6,
        RPM: Math.min(100, 25 + ((cyc * 6) % 1) * 75), gear: Math.min(6, 1 + Math.floor(cyc * 6)), maxGear: 6,
        fuel: { type: 'gasoline', level: 64 }, engine: { active: true, durability: 92 }, body: 78,
        seatbelt: true, locked: false, lights: 'low', cruiseControl: false,
        aircraft: m === 2 ? { altitude: 1240 + Math.sin(t / 30) * 60, verticalSpeed: Math.cos(t / 30) * 400, pitch: Math.sin(t / 50) * 8, roll: Math.sin(t / 35) * 14, throttle: 70 + Math.sin(t / 25) * 15, gearDown: false } : null,
      },
    };
    send(msg);
  }, 60);
})();
