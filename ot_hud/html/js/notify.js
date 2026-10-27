/* ot-hud — by drex */
/* Notifications — same notifData shape as the original: { message, type, icon, color, muted, duration } */
(function () {
  var el = document.getElementById('notifications');
  var TYPES = {
    info: { icon: 'notif-info', color: '#60a5fa', sound: 'info' },
    success: { icon: 'notif-success', color: '#4ade80', sound: 'success' },
    fail: { icon: 'notif-fail', color: '#f87171', sound: 'fail' },
    error: { icon: 'notif-fail', color: '#f87171', sound: 'fail' },
    warning: { icon: 'notif-warning', color: '#fbbf24', sound: 'warn' },
    alert: { icon: 'notif-alert', color: '#fde047', sound: 'alert' },
  };
  var cache = {};
  function play(name) {
    try {
      var a = cache[name] || (cache[name] = new Audio('./assets/sounds/notifications/' + name + '.mp3'));
      a.currentTime = 0; a.volume = 0.5; a.play().catch(function () {});
    } catch (e) {}
  }
  window.HUDNotify = function (n) {
    var t = TYPES[n.type] || TYPES.info, color = n.color || t.color, dur = n.duration || 5000;
    var d = document.createElement('div');
    d.className = 'notif';
    d.style.setProperty('--c', color);
    d.innerHTML = window.svgIcon(n.icon || t.icon) + '<span></span>';
    d.lastChild.textContent = n.message || 'An error occurred.';
    el.appendChild(d);
    if (!n.muted) play(t.sound);
    setTimeout(function () { d.classList.add('out'); setTimeout(function () { d.remove(); }, 220); }, dur);
  };
})();
