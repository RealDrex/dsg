# ot_hud

HUD لـ FiveM — الواجهة (UI) من تصميم **drex**، والـ Lua مربوط عليها بالكامل.

| القسم | الواجهة | الكود (Lua) |
|---|---|---|
| البوصلة | `html/js/compass.js` | `client/compass.lua` |
| الماب (إطار + الرادار داخله) | `html/js/minimap.js` | `client/main.lua` |
| بار اللاعب | `html/js/player.js` | `client/player.lua` |
| السلاح | `html/js/weapon.js` | `client/weapon.lua` |
| عداد السيارة | `html/js/vehicle.js` | `client/vehicle.lua` |
| الهيلي والطيارة | `html/js/aircraft.js` | `client/aircraft.lua` |
| الإشعارات | `html/js/notify.js` | `client/main.lua` |

كل الإعدادات في `config.lua`. الواجهة تتكيف تلقائياً مع أي دقة (1080p / 1440p / ultrawide).

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

- **البوصلة** (في السيارة افتراضياً): تتحرك بسلاسة، اسم الشارع، **بلبس GTA الحقيقية** بلونها في الخريطة.
  إذا كنت **قريب** من بليب (150م) ووجهت البوصلة عليه يطلع **"X Set waypoint"**.
- **الماب**: إطار مخصص، والرادار الأصلي ينحط داخله بالضبط على أي دقة، مع الاتجاهات واسم المنطقة والساعة (وقت اللعبة).
- **بار اللاعب**: الدم (سداسي)، الدرع، المايك (يتحرك وقت الكلام)، الأكل، الشرب، الستريس، والأكسجين / الـ Stamina وقت الحاجة.
- **السلاح**: الاسم، المخزن / الاحتياط، خانات الطلقات، الـ Durability.
- **السيارة**: السرعة، خط الـ RPM، البنزين (أو كهرباء)، القير، والأيقونات (مكينة، حزام، أنوار، قفل، كروز، NOS، Harness).
- **الطيارة / الهيلي**: Airspeed، الأفق الاصطناعي، الارتفاع، السرعة العمودية، THR / FUEL / ENG، العجلات.
- **إشعارات** بأصوات، و **Seatbelt + Cruise + Stress** مدمجين.

## الماب المربع (اختياري)

للحواف المربعة النظيفة: حط ملف `squaremap.ytd` (موجود في qb-hud داخل `stream/`) في `ot_hud/stream/`.
بدونه الماب يشتغل عادي.

## الأوامر والأزرار

| | |
|---|---|
| `/hud` | إخفاء / إظهار الهود |
| `/compass` | إخفاء / إظهار البوصلة |
| `X` | Set / Remove waypoint على البليب القريب اللي تطالعه |
| `B` | حزام الأمان |
| `Caps Lock` | الكروز |
| `/hudmap` | يطبع قيم الماب في F8 |

(الأزرار تتغير من إعدادات GTA → Key Bindings → FiveM)

## Exports

```lua
-- client
exports.ot_hud:toggleHud(state)                       -- true / false / nil (toggle)
exports.ot_hud:isHudVisible()
exports.ot_hud:notify('Vehicle stored', 'success', 5000) -- info / success / fail / warning / alert
exports.ot_hud:shiftHud(true, 420)                    -- يزحزح السرعة والسلاح لليسار لما يفتح جوال
exports.ot_hud:shiftHud(false)
exports.ot_hud:addStatus('drunk', 'stress', 40, '#a855f7')   -- خانة حالة إضافية
exports.ot_hud:updateStatus('drunk', 60)
exports.ot_hud:removeStatus('drunk')
exports.ot_hud:setStatus('hunger', 50)                -- hunger / thirst / stress
exports.ot_hud:setVoice({ talking = true })
exports.ot_hud:setSeatbelt(true)
exports.ot_hud:getSeatbelt()
exports.ot_hud:setCruise(false)
exports.ot_hud:setHarness(true, 100)
exports.ot_hud:setNitro(80, false)
exports.ot_hud:addCompassPoint('my_shop', { label = 'Shop', sprite = 52, color = '#ffffff', coords = vec3(25.7, -1347.3, 29.5) })
exports.ot_hud:removeCompassPoint('my_shop')

-- server
exports.ot_hud:AddStress(source, 5)
exports.ot_hud:RemoveStress(source, 5)
TriggerClientEvent('ot_hud:client:notify', source, 'Hello', 'info')
```

`sprite` = رقم البليب من https://docs.fivem.net/docs/game-references/blips/ (كل الصور داخل `html/assets/blips`).

## الأداء

- بدون `backdrop-filter` وبدون `filter` على العناصر.
- البوصلة تنبني مرة وحدة وتتحرك بـ transform واحد في كل فريم.
- قياس مكان الماب يصير بس لما يتغير شي (resize / ظهور الماب).

## المعاينة في المتصفح

افتح `html/index.html` في المتصفح: أزرار On foot / Car / Heli / Notify / Fire / Phone، و `X` للـ waypoint.
