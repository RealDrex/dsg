/* ot-hud — by drex */
/* GTA blip sprites from https://docs.fivem.net/docs/game-references/blips/
   Send `sprite` (number from GetBlipSprite) or `spriteName` ('radar_garage') in compassData.blips.
   Images are shipped locally in ./assets/blips/<sprite id>.png (no internet needed). */
(function () {
  var N = {
    1: 'level', 8: 'waypoint', 38: 'raceflag', 40: 'safehouse', 50: 'crim_carsteal', 51: 'crim_drugs', 52: 'crim_holdups',
    56: 'cop_patrol', 59: 'heist', 60: 'police_station', 61: 'hospital', 64: 'helicopter', 67: 'security_van', 68: 'tow_truck',
    71: 'barber', 72: 'car_mod_shop', 73: 'clothes_store', 75: 'tattoo', 77: 'lester_family', 80: 'jewelry_heist',
    85: 'vinewood_tours', 90: 'flight_school', 93: 'bar', 94: 'base_jump', 100: 'car_wash', 108: 'financier_strand',
    109: 'golf', 110: 'gun_shop', 119: 'shooting_range', 121: 'strip_club', 135: 'cinema', 136: 'music_venue',
    137: 'police_station_blue', 138: 'airport', 140: 'weed_stash', 141: 'hunting', 143: 'objective_blue', 147: 'arms_dealing',
    153: 'weapon_health', 162: 'poi', 175: 'weapon_armour', 184: 'camera', 198: 'taxi', 225: 'gang_vehicle',
    267: 'property', 272: 'cash_pickup', 280: 'friend', 306: 'cratedrop', 309: 'race', 310: 'deathmatch', 315: 'race_land',
    316: 'race_sea', 317: 'tow', 318: 'garbage', 326: 'getaway_car', 350: 'property_for_sale', 351: 'gang_attack_package',
    354: 'boost', 356: 'dock', 357: 'garage', 358: 'golf_flag', 359: 'hangar', 360: 'helipad', 361: 'jerry_can', 362: 'mask',
    369: 'garage_for_sale', 374: 'business', 377: 'parachute', 402: 'repair', 407: 'info_icon', 410: 'boat', 416: 'rp',
    421: 'tank', 423: 'player_plane', 427: 'player_boat', 446: 'bennys', 455: 'yacht', 473: 'warehouse', 475: 'office',
    477: 'truck', 478: 'contraband', 479: 'trailer', 481: 'cargobob', 492: 'biker_clubhouse', 496: 'production_weed',
    497: 'production_crack', 499: 'production_meth', 500: 'production_money', 501: 'package', 512: 'quad', 513: 'bus',
    514: 'drugs_package', 521: 'laptop', 523: 'sports_car', 524: 'warehouse_vehicle', 527: 'junkyard', 545: 'steeringwheel',
    546: 'trophy', 556: 'supplies', 557: 'property_bunker'
  };
  window.BLIP_NAMES = N;
  // name -> sprite id, for `spriteName` support
  var BY_NAME = {};
  Object.keys(N).forEach(function (id) { BY_NAME['radar_' + N[id]] = +id; });
  // animated sprites are shipped as .gif, everything else as .png (./assets/blips/<id>.<ext>)
  var GIF = { 0: 1, 2: 1, 3: 1, 11: 1, 12: 1, 13: 1, 14: 1, 15: 1, 41: 1, 42: 1, 161: 1, 353: 1, 422: 1 };
  window.blipSrc = function (sprite) { return './assets/blips/' + sprite + (GIF[sprite] ? '.gif' : '.png'); };
  window.blipIcon = function (b) {
    var id = b.sprite != null ? +b.sprite : (b.spriteName ? BY_NAME[b.spriteName.indexOf('radar_') === 0 ? b.spriteName : 'radar_' + b.spriteName] : null);
    if (id == null || isNaN(id)) return window.svgIcon(b.icon || 'pin');
    // tinted with the real in-game blip colour (mask = cheap, no filter)
    if (b.color && /^#[0-9a-f]{6}$/i.test(b.color)) {
      return '<span class="bimg tint" style="background-color:' + b.color + ';-webkit-mask-image:url(' + window.blipSrc(id) + ')"></span>';
    }
    return '<img class="bimg" src="' + window.blipSrc(id) + '" onerror="this.style.visibility=\'hidden\'">';
  };
})();
