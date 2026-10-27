/* ot-hud — by drex */
/* Weapon HUD: name, mag / total, magazine segments, durability */
(function () {
  var S = window.HUD, el = document.getElementById('weapon'), MAXSEG = 12;
  el.innerHTML = '<div class="wp-top"><span class="wp-name"></span><div class="wp-ammo"><span class="wp-mag"></span><span class="wp-total"></span></div></div>' +
    '<div class="wp-rounds"></div><div class="wp-dur"><div class="bar"><div></div></div><span></span></div>';
  var name = el.querySelector('.wp-name'), mag = el.querySelector('.wp-mag'), total = el.querySelector('.wp-total');
  var rounds = el.querySelector('.wp-rounds'), dur = el.querySelector('.wp-dur'), durFill = dur.querySelector('.bar > div'), durTxt = dur.querySelector('span');
  var segCount = 0;

  S.subscribe(function () {
    var w = S.weapon;
    if (!w) return;
    var cap = Math.max(1, w.magCapacity || 1), n = Math.min(cap, MAXSEG);
    if (n !== segCount) {
      rounds.innerHTML = '<i></i>'.repeat(n);
      rounds.style.gridTemplateColumns = 'repeat(' + n + ',1fr)';
      segCount = n;
    }
    var filled = Math.ceil((w.magContent / cap) * n), low = w.magContent <= Math.max(1, Math.floor(cap * 0.25));
    rounds.querySelectorAll('i').forEach(function (s, i) { s.classList.toggle('on', i < filled); });
    rounds.classList.toggle('low', low);
    name.textContent = w.name || 'Weapon';
    mag.textContent = w.magContent;
    mag.classList.toggle('low', low);
    total.textContent = '/ ' + w.totalAmmo;
    dur.style.display = w.durability.active ? '' : 'none';
    durFill.style.width = w.durability.value + '%';
    durTxt.textContent = 'DUR ' + Math.round(w.durability.value) + '%';
  });
})();
