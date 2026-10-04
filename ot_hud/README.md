# ot_hud

HUD كامل جديد لـ FiveM مبني على تصميم **HUD Final**، مقسوم إلى أقسام مستقلة:

| القسم | الواجهة (UI) | الكود (Lua) |
|---|---|---|
| البوصلة | `html/js/compass.js` | `client/compass.lua` |
| بار اللاعب | `html/js/player.js` | `client/player.lua` |
| السلاح | `html/js/weapon.js` | `client/weapon.lua` |
| عداد السيارة | `html/js/vehicle.js` | `client/vehicle.lua` |
| الهيلي والطيارة | `html/js/aircraft.js` | `client/aircraft.lua` |

كل الإعدادات في `config.lua`.

## التركيب

1. انسخ مجلد `ot_hud` إلى `resources`.
2. أضف في `server.cfg`:
   ```
   ensure ot_hud
   ```
3. أوقف أي HUD ثاني (مثل `qb-hud` أو `ayc-hud`) وأي سكربت seatbelt ثاني إذا كان `Config.Seatbelt.enabled = true`.

يدعم تلقائياً: **qb-core / qbx_core / es_extended / standalone**، و **ox_inventory / qb-inventory**،
و **ox_fuel / LegacyFuel / cdn-fuel / ps-fuel / lc_fuel**، و **pma-voice**.

## المميزات

- **البوصلة**: شريط درجات ناعم (يتحرك بسلاسة)، اسم الشارع، أيقونات الأماكن (كراج، بنزينة، بيت، مستشفى…)
  تُسحب تلقائياً من بلبس الخريطة أو من الكونفق، ولما تطالع مكان يطلع لك **"E Set waypoint"** وتحط/تشيل الـ GPS عليه.
  يعرض الـ Waypoint الحالي والمسافة.
- **بار اللاعب**: الدم، الدرع (8 خانات)، الصوت (يضيء وقت الكلام / الراديو)، الأكل، الشرب، الستريس،
  و Stamina / Oxygen تطلع بس وقت الحاجة.
- **السلاح**: النوع، الاسم، المخزن / الاحتياط، خانات الطلقات، الـ Durability، تنبيه **RELOADING**.
- **السيارة**: السرعة، القير (يحمر عند الـ redline)، 16 بار RPM، المكينة / البودي / البنزين (أو كهرباء)،
  الأنوار، الكروز، حزام الأمان (يرمش إذا ما لبسته وأنت ماشي)، القفل.
- **الطيارة / الهيلي**: Airspeed (KTS)، الأفق الاصطناعي، الارتفاع (FT)، السرعة العمودية (FPM)، THR / FUEL / ENG،
  حالة العجلات للطيارة و صحة الـ Rotor للهيلي.
- **Seatbelt + Cruise** مدمجين (يمكن تعطيلهم واستخدام سكربتك).
- **Stress** (سرعة، إطلاق نار، تخفيف مع الوقت، تأثيرات blur).

## الأوامر والأزرار

| | |
|---|---|
| `/hud` | إخفاء / إظهار الهود |
| `/compass` | إخفاء / إظهار البوصلة |
| `E` | Set / Remove waypoint على المكان اللي تطالعه |
| `B` | حزام الأمان |
| `Caps Lock` | الكروز |

(الأزرار تتغير من إعدادات GTA → Key Bindings → FiveM)

## Exports

```lua
-- client
exports.ot_hud:toggleHud(state)                 -- true / false / nil (toggle)
exports.ot_hud:isHudVisible()
exports.ot_hud:setStatus('hunger', 50)          -- hunger / thirst / stress
exports.ot_hud:setVoice({ talking = true })
exports.ot_hud:setSeatbelt(true)
exports.ot_hud:getSeatbelt()
exports.ot_hud:setCruise(false)
exports.ot_hud:addCompassPoint('my_shop', { label = 'Shop', icon = 'store', coords = vec3(25.7, -1347.3, 29.5) })
exports.ot_hud:removeCompassPoint('my_shop')

-- server
exports.ot_hud:AddStress(source, 5)
exports.ot_hud:RemoveStress(source, 5)
```

أيقونات البوصلة المتاحة: `garage`, `gas`, `home`, `pin`, `hospital`, `police`, `store`, `bank`.

## المعاينة في المتصفح

افتح `html/index.html` في المتصفح لمعاينة الهود بدون اللعبة:
`1` مشي، `2` سيارة، `3` طيارة، `W` سلاح، `F` إطلاق، `R` ريلود، `B` حزام، `E` waypoint.
