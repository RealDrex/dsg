/* ot-hud — by drex */
/* Shared state + NUI bridge. Message actions & callbacks match the original ot-hud. */
(function () {
  var uiScale = 1;
  function fit() { document.documentElement.style.setProperty('--s', (Math.min(innerWidth / 1920, innerHeight / 1080) * uiScale).toFixed(4)); }
  fit(); window.addEventListener('resize', fit);
  var S = (window.HUD = {
    disableAll: true,
    cinematic: false,
    show: { playerStatus: true, vehicleHUD: true, compass: true, weaponHUD: true, worldInfo: true, balance: true },
    config: { speedometerUnit: 'KMH', visibility: {}, colors: {} },
    labels: {},
    status: { health: { current: 200, max: 200 }, armor: { current: 100, max: 100 }, hunger: 100, thirst: 100, stamina: 100, breath: 100, stress: 0, custom: {} },
    mic: { radio: false, maxLevel: 3, currentLevel: 2, talking: false },
    inVehicle: false,
    vehicle: { speed: 0, RPM: 0, fuel: { type: 'gasoline', level: 100 }, harness: { active: false, durability: 0 }, NOS: { active: false, level: 0 }, engine: { active: true, durability: 100 }, body: 100, gear: 0, seatbelt: false, locked: false, lights: 'off', cruiseControl: false, aircraft: null, custom: {} },
    weapon: null,
    compass: { heading: 0, street: '', area: '', blips: [], waypoint: null },
  });

  var subs = [], queued = false;
  S.subscribe = function (fn) { subs.push(fn); };
  S.emit = function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; subs.forEach(function (f) { f(S); }); });
  };

  S.isFiveM = typeof window.GetParentResourceName === 'function';
  S.post = function (name, data) {
    if (!S.isFiveM) return Promise.resolve(null);
    return fetch('https://' + GetParentResourceName() + '/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(data || {}),
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  };

  function hex(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, w) {
    return 'rgb(' + a.map(function (v, i) { return Math.round(v * w + b[i] * (1 - w)); }).join(',') + ')';
  }

  function applyColors(c) {
    if (!c) return;
    var root = document.documentElement.style;
    var map = { theme: '--primary', danger: '--danger', hunger: '--hunger', thirst: '--thirst', stress: '--stress', talking: '--talking' };
    Object.keys(map).forEach(function (k) { if (c[k]) root.setProperty(map[k], c[k]); });
    if (c.theme) {
      // mixed in JS: FiveM's CEF is older than color-mix() support
      var rgb = hex(c.theme);
      if (rgb) {
        root.setProperty('--primary-light', mix(rgb, [255, 255, 255], 0.7));
        root.setProperty('--primary-dark', mix(rgb, [0, 0, 0], 0.6));
        root.setProperty('--primary-glow', 'rgba(' + rgb.join(',') + ',.55)');
      }
    }
  }
  S.applyColors = applyColors;

  function merge(target, src) {
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') merge(target[k], v);
      else target[k] = v;
    });
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    switch (d.action) {
      case 'ready':
        if (S.readyDone) break;
        S.post('ready').then(function (res) {
          if (!res || !res.Config) { setTimeout(function () { window.postMessage({ action: 'ready' }, '*'); }, 1000); return; }
          if (S.readyDone) return;
          S.readyDone = true;
          var C = res.Config || {};
          if (C.uiScale && +C.uiScale !== 1) { uiScale = +C.uiScale; fit(); S.scaleDirty = true; }
          S.config = C;
          S.labels = res.Labels || {};
          applyColors(C.colors);
          S.post('settings:update', {
            colors: C.colors, style: C.style, perspective: C.perspective, colorMode: C.colorMode,
            speedometerUnit: C.speedometerUnit, compassBase: C.compassBase, cinematicMode: C.cinematicMode,
            cinematicBars: C.cinematicBars, visibility: C.visibility, performanceMode: C.performanceMode,
          });
          S.emit();
        });
        break;
      case 'update':
        S.weapon = d.weaponData ? {
          name: d.weaponData.name, magCapacity: d.weaponData.magCapacity, magContent: d.weaponData.magContent, totalAmmo: d.weaponData.totalAmmo,
          durability: { active: (d.weaponData.durability && d.weaponData.durability.active) || false, value: (d.weaponData.durability && d.weaponData.durability.value) != null ? d.weaponData.durability.value : 100 },
        } : null;
        if (d.vehicleData) {
          S.inVehicle = d.vehicleData.speed != null;
          if (!('aircraft' in d.vehicleData) && !S.inVehicle) S.vehicle.aircraft = null;
          merge(S.vehicle, d.vehicleData);
        }
        if (d.statusData) merge(S.status, d.statusData);
        if (d.compassData) {
          var c = d.compassData;
          S.compass.heading = c.heading;
          S.compass.street = c.street;
          S.compass.area = c.area;
          if ('zone' in c) S.compass.zone = c.zone;
          // Lua drops nil keys from JSON, so missing = cleared
          S.compass.blips = Array.isArray(c.blips) ? c.blips : [];
          S.compass.waypoint = c.waypoint != null ? c.waypoint : null;
          S.compass.focus = c.focus != null ? c.focus : null;
        }
        if (d.micData) merge(S.mic, d.micData);
        if (d.weatherData) S.weather = d.weatherData;
        break;
      case 'balance:update':
        S.balance = d.data;
        break;
      case 'command:trigger':
        if (d.command === 'cinematic') S.cinematic = !S.cinematic;
        else if (d.command === 'cinematicbars') S.cinematicBars = !S.cinematicBars;
        else if (d.command in S.show) S.show[d.command] = !S.show[d.command];
        break;
      case 'key:pressed':
        break;
      case 'hud:shift':
        S.shift = !!d.state;
        if (d.offset != null) S.shiftPx = d.offset;
        break;
      case 'disableAll':
        S.disableAll = !!d.state;
        break;
      case 'notif':
        if (window.HUDNotify) window.HUDNotify(d.notifData || {});
        break;
      case 'insertStatus':
        if (d.data && d.data.id != null) S.status.custom[d.data.id] = { icon: d.data.icon || 'not-found', value: d.data.value || 0, color: d.data.color || '', id: d.data.id };
        break;
      case 'removeStatus':
        delete S.status.custom[d.id != null ? d.id : d.data && d.data.id];
        break;
      case 'updateStatus': {
        var sid = d.id != null ? d.id : d.data && d.data.id, cs = S.status.custom[sid];
        if (cs && d.data) { if (d.data.icon) cs.icon = d.data.icon; if (d.data.value !== undefined) cs.value = d.data.value; if (d.data.color) cs.color = d.data.color; }
        break;
      }
      case 'insertVehicleData':
        if (d.data && d.data.id != null) S.vehicle.custom[d.data.id] = { icon: d.data.icon || 'not-found', value: d.data.value || 0, id: d.data.id };
        break;
      case 'removeVehicleData':
        delete S.vehicle.custom[d.id != null ? d.id : d.data && d.data.id];
        break;
      case 'updateVehicleData': {
        var vid = d.id != null ? d.id : d.data && d.data.id, cv = S.vehicle.custom[vid];
        if (cv && d.data) { if (d.data.icon) cv.icon = d.data.icon; if (d.data.value !== undefined) cv.value = d.data.value; }
        break;
      }
      default:
        return;
    }
    S.emit();
  });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Escape' || e.code === 'Backspace') S.post('close');
  });
})();
