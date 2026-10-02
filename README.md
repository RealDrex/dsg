<div align="center">

<img src="assets/banner.png" alt="Sword" width="100%">

# ⚔️ Sword Bot

**بوت سستم متكامل لسيرفر Sword** — إدارة، حماية، تذاكر، لفلات، رتب، لوقات + موقع للبوت.

</div>

---

## 🧩 البلوقنات

| | البلوقن | الأوامر | وش يسوي |
|---|---|---|---|
| ⚙️ | إعدادات البوت `@Bot Settings` | `/help` `/plugins` `/ping` `/botinfo` `/serverinfo` `/userinfo` `/avatar` | قائمة أوامر بقائمة اختيار وشعار Sword، تشغيل/إيقاف أي بلوقن |
| 🛡️ | الحماية `@Protection Plugin` | `/protection` | مضاد سبام، روابط، منشن، كلمات ممنوعة، رايد، تخريب (Anti-Nuke)، بوتات + وايت ليست |
| 👤 | الإدارة `@Admin Plugin` | `/ban` `/unban` `/kick` `/timeout` `/untimeout` `/warn` `/warnings` `/history` `/clear` `/lock` `/unlock` `/hide` `/show` `/slowmode` `/nick` `/role` `/say` | عقوبات بأرقام قضايا، عقوبة تلقائية عند عدد تحذيرات |
| 👋 | الترحيب `@Welcome Plugin` | `/welcome` | ترحيب ببانر Sword، رسالة خاص، رسالة مغادرة |
| 📋 | اللوقات `@Logs Plugin` | `/logs` | رسائل، أعضاء، إدارة، رومات ورتب، فويس، حماية — و`/logs setup` يسوي كل الرومات تلقائياً |
| 📈 | الرانك والتفاعل `@Activity Plugin` | `/rank` `/top` `/levels` | XP بالرسائل والفويس، رتب مكافآت، توب |
| ✅ | الرولات التلقائية `@Autorole Plugin` | `/autorole` | رتب للأعضاء الجدد وللبوتات |
| 🎭 | الرياكشن والسلكت رول `@Rolesassigner Plugin` | `/reactionrole` `/rolepanel` | رتب بالرياكشن، بانلات أزرار أو قائمة اختيار |
| 🎫 | التذاكر `@Tickets Plugin` | `/ticket` | بانل بشعار Sword، أنواع، استلام، إغلاق، ترانسكربت HTML بثيم السيرفر |
| 💬 | الرد والرياكشن والخطوط `@Autoactions Plugin` | `/autoreply` `/autoreact` `/autoline` | ردود تلقائية، رياكشن تلقائي، خط السيف بعد كل رسالة |
| 📊 | العدادات `@Counters Plugin` | `/counter` | رومات تعرض الأعضاء/البوتات/الفويس/البوستات |
| 🎨 | علبة الألوان `@Colors Plugin` | `/colors` | 20 لون جاهز وبانل اختيار لون الاسم |

> المجموع: **39 أمر سلاش** و **106 أمر فرعي** — اكتب `/help` داخل السيرفر عشان تشوفها كلها مرتبة.

---

## 🚀 التشغيل

### 1) سوّ البوت في ديسكورد
1. ادخل [Discord Developer Portal](https://discord.com/developers/applications) ← **New Application** ← سمّه `Sword`.
2. من **Bot**: انسخ التوكن، وحط صورة البوت `assets/logo-round.png`.
3. فعّل الـ **Privileged Gateway Intents** الثلاثة: `Server Members` و `Message Content` (و `Presence` اختياري).
4. من **OAuth2 → URL Generator**: اختر `bot` + `applications.commands` وصلاحية `Administrator`، وادخل البوت سيرفرك.
5. **مهم:** ارفع رتبة البوت لأعلى الرتب في السيرفر (عشان يقدر يعاقب ويعطي رتب).

### 2) جهّز المشروع (يحتاج Node.js 22.5 أو أحدث)
```bash
npm install
cp .env.example .env     # وعبّي DISCORD_TOKEN و CLIENT_ID و GUILD_ID
npm run check            # يتأكد إن كل الأوامر سليمة
npm run deploy           # يسجل الأوامر في سيرفرك
npm start                # يشغل البوت + الموقع
```

الموقع يشتغل على `http://localhost:3000` (تقدر تغير البورت من `.env`).
تبي تشوف الموقع بس بدون البوت؟ `npm run web`

---

## ⚡ إعداد سريع داخل السيرفر

```
/logs setup                                  ← يسوي كاتقوري لوقات كاملة
/ticket setup category:… staff:@الدعم logs:#ترانسكربت
/ticket panel channel:#التذاكر               ← بانل التذاكر بشعار Sword
/welcome channel channel:#الترحيب
/protection panel                            ← فعّل الحمايات اللي تبيها
/protection whitelist add target:@المشرفين   ← استثناء من مضاد التخريب
/autorole add role:@عضو for:الأعضاء
/colors setup  ثم  /colors panel
/levels reward add level:10 role:@متفاعل
/counter create type:كل الأعضاء
/autoline add channel:#الصور                 ← خط السيف بعد كل رسالة
```

---

## 🗂️ هيكل المشروع

```
assets/              شعار Sword والبانرات وخط السيف
src/
  index.js           تشغيل البوت
  deploy.js          تسجيل الأوامر
  core/              الثيم، قاعدة البيانات، الإعدادات، تحميل البلوقنات
  plugins/<name>/    كل بلوقن في مجلد مستقل (أوامر + أحداث + أزرار)
  web/               الموقع (Express) + الواجهة
scripts/check.js     فحص كل الأوامر بدون اتصال بديسكورد
```

**إضافة بلوقن جديد:** سوّ مجلد في `src/plugins/` فيه `index.js` يصدّر `{ id, name, nameAr, emoji, description, defaults, commands, events, components }` — ويظهر تلقائياً في `/help` و `/plugins` والموقع.

البيانات محفوظة في `data/sword.db` (SQLite مدمج في Node، ما يحتاج تثبيت شي).
