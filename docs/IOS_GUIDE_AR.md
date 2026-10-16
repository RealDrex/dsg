# دليل تشغيل Best Price على Xcode ونشره في App Store

دليل للمبتدئين، خطوة بخطوة. كل أمر يُكتب في **Terminal** على جهاز الماك.

> **فكرة مهمة قبل البدء:** التطبيق مبني بـ **Expo / React Native**. يعني ما فيه مجلد `ios` جاهز داخل السورس، وأنت تولّده بأمر واحد (الخطوة 4)، وبعدها تفتحه في Xcode وتشتغل عادي. أي إعداد يخص iOS (الاسم، الأيقونة، الصلاحيات، Bundle ID) يتعدّل في `apps/mobile/app.json` وليس داخل Xcode، لأن مجلد `ios` يُعاد توليده.

---

## الخطوة 0: المتطلبات (مرة وحدة)

| المطلوب | من وين | ملاحظة |
|---|---|---|
| Xcode (آخر إصدار) | App Store على الماك | افتحه مرة بعد التثبيت ووافق على الشروط |
| Command Line Tools | `xcode-select --install` | |
| Node.js 22 (LTS) | https://nodejs.org (حمّل نسخة LTS للماك) | تأكد: `node -v` |
| CocoaPods | `brew install cocoapods` أو `sudo gem install cocoapods` | تأكد: `pod --version` |
| PostgreSQL | **Postgres.app** من https://postgresapp.com (أسهل خيار) | لتشغيل الخادم على جهازك |
| حساب Apple Developer | https://developer.apple.com/programs ‏(99$ سنويًا) | **للنشر فقط**. التجربة على المحاكي ما تحتاجه |

---

## الخطوة 1: فك ضغط السورس وتثبيت المكتبات

```bash
cd ~/Downloads
cd bestprice
npm install
```

## الخطوة 2: تشغيل قاعدة البيانات

1. افتح **Postgres.app** واضغط **Initialize** (يشتغل على المنفذ 5432).
2. أنشئ قاعدة البيانات:

```bash
/Applications/Postgres.app/Contents/Versions/latest/bin/psql -c "CREATE USER bestprice WITH PASSWORD 'bestprice' CREATEDB;" postgres
/Applications/Postgres.app/Contents/Versions/latest/bin/psql -c "CREATE DATABASE bestprice OWNER bestprice;" postgres
```

## الخطوة 3: تشغيل الخادم (API)

```bash
cp apps/api/.env.example apps/api/.env
open -e apps/api/.env
```

عدّل داخل الملف:
- `JWT_SECRET=` ← ضع نصًا عشوائيًا طويلًا (تقدر تولده بـ `openssl rand -base64 48`)
- `ADMIN_PASSWORD=` ← كلمة مرور قوية للوحة الإدارة (10 أحرف أو أكثر، ولا تحتوي كلمة admin)
- `ANTHROPIC_API_KEY=` ← اختياري: مفتاح Claude لتفعيل المساعد الذكي الكامل. بدونه يشتغل المستشار الاحتياطي.

بعدها:

```bash
npm run db:seed -w @bestprice/api
npm run dev:api
```

اترك هذه النافذة مفتوحة. للتأكد افتح في المتصفح: http://localhost:4000/health

### تفعيل المساعد الذكي والبحث عن أي منتج

بدون مفتاح، المساعد يشتغل بأسلوب احتياطي بسيط، والبحث يغطي المنتجات الموجودة في الكتالوج فقط (ويطلع لك تنبيه أصفر بهذا). مع المفتاح:
- **البحث الحي**: تكتب أي منتج (ماك M4، ستريم ديك، شنطة، سيارة…) واضغط «بحث» في الكيبورد، والتطبيق يدوّر في محركات البحث ويوريك وش يسوي لحظة بلحظة (عمليات البحث والمواقع اللي وصل لها بشعاراتها).
- النتيجة: المنتج بصورته من صفحة المتجر وشعار الشركة المصنعة، وكل البائعين بأسعارهم: المتاجر المعروفة (جرير، أمازون…) بشعاراتها، والبائعين غير المعروفين ببادج «⚠️ بائع غير معروف»، والمتاجر الخارجية (علي إكسبريس…) بسعر محوّل للريال مع السعر الأصلي، وقسم **المستعمل** (حراج، السوق المفتوح…) مع زر «اسأل المساعد عن المستعمل».
- **البحث بالصورة**: من شاشة الكاميرا اختر «صورة» أو «المعرض»، أو زر الصورة في البحث، والتطبيق يتعرف على المنتج ويدوّر عليه ويقترح بدائل مشابهة (ما يعرض منتجات مقلدة، لأنها ممنوعة نظامًا وتسبب رفض التطبيق من أبل).
- المساعد يفهم أي سؤال ويرد بذكاء فعلي.

الخطوات:
1. ادخل https://console.anthropic.com وسجّل، ثم **Billing** واشحن رصيد بسيط (تقديريًا كل بحث عن منتج جديد يكلّف من 5 إلى 20 سنت حسب طول البحث، والنتائج تنحفظ 24 ساعة فتكرار نفس البحث مجاني. حط حد صرف من إعدادات الحساب).
2. **API Keys** ← **Create Key** ← انسخ المفتاح.
3. افتح `apps/api/.env` وحطّه بعد `ANTHROPIC_API_KEY=` (بدون مسافات أو علامات تنصيص)، واحفظ.
4. في نفس الملف غيّر `SEED_DEMO_DATA=true` إلى `SEED_DEMO_DATA=false` عشان تختفي الأسعار التجريبية وتشوف الأسعار الحقيقية بس.
5. أوقف الخادم بـ `Ctrl + C` وشغّله من جديد: `npm run dev:api`. لازم يطلع في السجل: `assistant mode: ai`.
6. تأكد: افتح في المتصفح http://localhost:4000/health ولازم يطلع `"discovery":true`.

**صور المنتجات والشعارات:** تشتغل بدون أي إعداد إضافي. شعارات الشركات الكبيرة (Apple، Samsung، Sony، Toyota، Elgato، AliExpress، eBay، IKEA… أكثر من 45 شركة) مدمجة داخل التطبيق نفسه وتطلع فورًا حتى بدون إنترنت. وأول ما يشتغل الخادم يجيب شعار كل متجر وصورة حقيقية لكل منتج ما له صورة، ويحفظها، ويكتب في السجل سطر مثل: `warm-up: 24/24 store logos, 27/29 product photos found`. الصور تنسحب من صفحات المتاجر، وإذا ما لقى صورة يدوّر في ويكيبيديا، والشعارات تنسحب من أيقونة كل موقع. وإذا تبغى تغطية أقوى، فيه مفتاحين اختياريين في `apps/api/.env`:
- `BRAVE_SEARCH_API_KEY`: بحث صور حقيقي عن أي منتج. سجّل في https://brave.com/search/api/ (فيه رصيد مجاني شهري) وانسخ المفتاح.
- `LOGO_DEV_TOKEN`: شعارات شركات بجودة عالية. سجّل في https://www.logo.dev وانسخ الـ Publishable key.
بعد إضافتهم أعد تشغيل الخادم.

> البحث الواحد ياخذ تقريبًا 15 إلى 40 ثانية لأنه يبحث فعليًا في الإنترنت ويقرأ صفحات المنتجات. تقدر تخليه أعمق (وأبطأ) بتغيير `DISCOVERY_MODEL=claude-opus-5-5` و `DISCOVERY_EFFORT=medium`.

> المفتاح سرّي: لا ترسله لأحد ولا تحطه داخل التطبيق نفسه. مكانه الخادم فقط.

## الخطوة 4: توليد مشروع Xcode

افتح نافذة Terminal جديدة:

```bash
cd ~/Desktop/bestprice/apps/mobile
npx expo prebuild --platform ios
```

هذا ينشئ مجلد `apps/mobile/ios` ويثبّت الـ Pods تلقائيًا.

## الخطوة 5: التشغيل على المحاكي (Simulator)

**الطريقة الأسهل:**

```bash
npx expo run:ios
```

يبني التطبيق ويفتح المحاكي تلقائيًا.

**أو من Xcode:**
1. شغّل مخدّم الكود في Terminal: `npx expo start` (اتركه مفتوحًا).
2. افتح `apps/mobile/ios/BestPrice.xcworkspace` ‏(**xcworkspace** وليس xcodeproj).
3. من الأعلى اختر جهاز محاكي (مثلًا iPhone 16 Pro) واضغط ▶️.

## الخطوة 6: التشغيل على جوالك الآيفون

التطبيق ينزل على جوالك وينبني بنسخة **Release**، يعني يشتغل لحاله بدون Metro. الجوال يكلّم الخادم اللي على الماك، فلازم:
- الماك والجوال على **نفس شبكة الواي فاي**.
- الخادم شغّال (`npm run dev:api`) وقت ما تستخدم التطبيق.

### أ) تجهيز الآيفون (مرة وحدة)
1. وصّل الآيفون بالماك بالكيبل. إذا طلع في الجوال «Trust This Computer?» اضغط **Trust** واكتب رمز الجوال.
2. افتح Xcode مرة وحدة والجوال موصول، وانتظر لين يخلص «Preparing iPhone…» من نافذة **Window ← Devices and Simulators**.
3. في الجوال: **Settings ← Privacy & Security ← Developer Mode** ← فعّله. الجوال بيعيد التشغيل، وبعدها اختر **Turn On**.
   (خيار Developer Mode ما يظهر إلا بعد ما توصّل الجوال بـ Xcode مرة.)

### ب) حساب أبل في Xcode (مرة وحدة)
1. Xcode ← **Settings** ← **Accounts** ← زر **+** ← **Apple ID** ← سجّل بحسابك العادي.
   حساب Apple ID المجاني يكفي للتجربة على جوالك (التطبيق يشتغل 7 أيام ثم تعيد تنزيله بنفس الأمر). حساب المطوّر المدفوع (99$ بالسنة) يخليه سنة، ولازم له للنشر.

### ج) معرّف خاص للتطبيق (مرة وحدة)
1. المعرّف مضبوط مسبقًا على `com.saudalhubais.bestprice` في `apps/mobile/app.json` (تغيّره بس لو Xcode قال إنه مستخدم).
2. في Terminal:
   ```
   cd ~/Downloads/bestprice/apps/mobile
   npx expo prebuild --platform ios --clean
   ```
3. افتح المشروع في Xcode:
   ```
   open ios/BestPrice.xcworkspace
   ```
   من اليسار اضغط **BestPrice** (الأيقونة الزرقاء) ← **Signing & Capabilities** ← فعّل **Automatically manage signing** ← في **Team** اختر اسمك **(Personal Team)**. لو طلع خطأ أحمر عن الـ Bundle Identifier غيّره لاسم ثاني مميز. سكّر Xcode.

### د) إعداد الخادم ليوصل له الجوال
1. اعرف IP الماك:
   ```
   ipconfig getifaddr en0
   ```
   بيطلع رقم مثل `192.168.100.246`.
2. افتح `apps/api/.env` وغيّر:
   `PUBLIC_BASE_URL=http://localhost:4000`
   إلى (بالرقم اللي طلع لك):
   `PUBLIC_BASE_URL=http://192.168.100.246:4000`
   (هذا عشان الشعارات وروابط «اشترِ» تشتغل من الجوال.)
3. أعد تشغيل الخادم: `Ctrl + C` ثم `npm run dev:api`.
4. تأكد من الجوال: افتح Safari في الآيفون واكتب `http://192.168.100.246:4000/health`. لازم يطلع `{"ok":true ...}`.
   ما فتح؟ في الماك: **System Settings ← Network ← Firewall** إما تطفيه أو تسمح لـ **node** باستقبال الاتصالات، وتأكد إن الجوال على نفس الواي فاي (مو بيانات الجوال).

### هـ) تنزيل التطبيق على الجوال
الجوال موصول بالكيبل ومفتوح القفل، ومن مجلد المشروع الرئيسي:
```
cd ~/Downloads/bestprice
npm run ios:phone
```
الأمر يعرف IP الماك تلقائيًا ويبني التطبيق وينزّله. أول مرة ياخذ 5 إلى 15 دقيقة. إذا سألك عن الجهاز اختر الآيفون.

### و) أول فتح للتطبيق في الجوال
1. إذا طلع «Untrusted Developer»: **Settings ← General ← VPN & Device Management** ← اضغط على حسابك ← **Trust**.
2. افتح التطبيق، وإذا سألك «يبغى يوصل للأجهزة على شبكتك المحلية» اختر **Allow** (عشان يوصل للخادم على الماك).
3. وافق على الكاميرا لما تفتح الماسح. الباركود والبحث بالصورة يشتغلون على الجوال الحقيقي.

### مشاكل شائعة على الجوال
| المشكلة | الحل |
|---|---|
| التطبيق يفتح بس يقول ما فيه اتصال | الخادم مو شغّال، أو الماك والجوال على شبكتين مختلفتين، أو الجدار الناري. جرّب رابط `/health` من Safari الجوال. |
| تغيّر IP الماك (بعد ما تعيد تشغيل الراوتر) | عدّل `PUBLIC_BASE_URL` في `.env` وأعد `npm run ios:phone`. |
| «No profiles for … were found» | ارجع للخطوة (ج-3) واختر الـ Team. |
| «Device is busy» أو ما يشوف الجوال | افصل الكيبل ورجّعه، وافتح قفل الجوال، وانتظر Xcode يخلص التجهيز. |
| بعد 7 أيام التطبيق ما يفتح | عادي مع الحساب المجاني: شغّل `npm run ios:phone` مرة ثانية. |
| تبغى بدون كيبل | Xcode ← Window ← Devices and Simulators ← اختر الجوال ← فعّل **Connect via network**. بعدها يكفي نفس الواي فاي. |

> التطبيق على جوالك يعتمد على الخادم اللي على الماك. عشان يشتغل في أي مكان (برا البيت) لازم نرفع الخادم على سيرفر في الإنترنت بـ HTTPS، وهذي خطوة النشر الجاية.

---

## النشر في App Store

### أ) قبل النشر: متطلبات لازم تكتمل

1. **خادم على الإنترنت بعنوان HTTPS**. الآيفون في النسخة المنشورة ما يقبل اتصال غير مشفّر. خيارات سهلة لاستضافة الخادم مع قاعدة بيانات: Render أو Railway أو Fly.io (يوجد `Dockerfile` جاهز في `apps/api`). اتبع قائمة التحقق في `docs/SECURITY.md`.
2. **أسعار حقيقية بدل التجريبية.** Apple ترفض التطبيقات اللي محتواها تجريبي أو ناقص. اربط مصادر أسعار حقيقية (`docs/DATA_SOURCES.md`) وأوقف المصادر التجريبية من لوحة الإدارة.
3. **سياسة خصوصية** منشورة على رابط (عربي وإنجليزي).
4. غيّر في `app.json`:
   - `"apiUrl"` إلى عنوان خادمك، مثل `"https://api.yourdomain.com"`.
   - `"bundleIdentifier"` إلى معرّفك النهائي.
   - `"version"` (مثل `1.0.0`). كل رفع جديد يحتاج رقم Build أعلى.
   - ثم: `npx expo prebuild --platform ios --clean`

### ب) إنشاء التطبيق في App Store Connect

1. ادخل https://appstoreconnect.apple.com ← **Apps** ← **+** ← **New App**.
2. Platform: iOS، الاسم: **Best Price** (إذا محجوز جرّب «Best Price – مقارنة الأسعار»)، اللغة الأساسية: **Arabic**، الـ Bundle ID: نفس اللي في `app.json` (سجّله أولًا في developer.apple.com ← Identifiers إذا ما ظهر).

### ج) الرفع من Xcode

1. في Xcode اختر **Any iOS Device (arm64)** من قائمة الأجهزة.
2. **Signing & Capabilities** ← اختر فريق حساب المطوّر المدفوع.
3. من القائمة: **Product → Archive**.
4. بعد الانتهاء تفتح نافذة **Organizer** ← **Distribute App** ← **App Store Connect** ← **Upload**.
5. بعد 10–30 دقيقة يظهر الـ Build في App Store Connect ← **TestFlight**. جرّبه على جوالك وجوالات أصدقائك قبل الإرسال للمراجعة.

### د) تعبئة صفحة المتجر

- **Screenshots:** مطلوبة لمقاس 6.9 إنش (1320×2868). خذها من المحاكي iPhone 16 Pro Max بـ ⌘S.
- **الوصف والكلمات المفتاحية** (عربي وإنجليزي): مقارنة أسعار، باركود، أرخص سعر، مساعد تسوق، تنبيهات أسعار.
- **Privacy Policy URL**.
- **App Privacy** (أسئلة البيانات). الإجابات حسب الكود الحالي:
  - *Contact Info → Email*: نعم، فقط عند إنشاء حساب (App Functionality، مرتبط بالمستخدم).
  - *Identifiers → User ID*: نعم (App Functionality).
  - *Search History* و*Product Interaction*: نعم (App Functionality، مرتبط بالمستخدم، والمستخدم يقدر يمسحها).
  - *Location*: **لا يُجمع**، لأنه يُرسل لحظيًا لحساب المسافة ولا يُحفظ.
  - *Tracking*: **لا**. لا يوجد تتبع إعلاني ولا مكتبات طرف ثالث.
- **Encryption:** محسومة مسبقًا (`ITSAppUsesNonExemptEncryption = false`).
- **App Review Information:** اكتب للمراجع أن التطبيق يعمل بدون تسجيل (وضع الضيف)، وأن حذف الحساب متاح من «حسابي ← الخصوصية ← حذف الحساب نهائيًا»، وضع باركود تجريبي لمنتج موجود في الكتالوج.

### هـ) نقاط تحمي من الرفض (موجودة مسبقًا في الكود)

- ✅ حذف الحساب من داخل التطبيق (شرط Apple).
- ✅ استخدام التطبيق بدون إجبار على التسجيل.
- ✅ رسائل صلاحيات واضحة بالعربي والإنجليزي للكاميرا والموقع والصور فقط. حذفت الصلاحيات غير المستخدمة (المايك، Face ID، الموقع في الخلفية، الحركة).
- ✅ طلب إذن الإشعارات عند أول متابعة سعر فقط، وليس عند فتح التطبيق.
- ✅ الإعلانات مُعلّمة ومنفصلة.
- ⚠️ **لازم** أسعار حقيقية وخادم HTTPS قبل الإرسال.

---

## مشاكل شائعة

| المشكلة | الحل |
|---|---|
| `pod: command not found` | ثبّت CocoaPods (الخطوة 0) ثم `cd apps/mobile/ios && pod install` |
| Xcode يقول No such module / خطأ Pods | تأكد أنك فتحت **BestPrice.xcworkspace** وليس xcodeproj |
| التطبيق يفتح بشاشة «تعذّر الاتصال» | الخادم ما يشتغل (الخطوة 3)، أو `apiUrl` خطأ، أو الجوال على شبكة ثانية |
| `Signing for "BestPrice" requires a development team` | Signing & Capabilities ← اختر Team |
| غيّرت شيئًا في app.json ولم يظهر | `npx expo prebuild --platform ios --clean` ثم ابنِ من جديد |
| خطأ بعد تحديث المكتبات | احذف `node_modules` و`apps/mobile/ios` ثم `npm install` و`npx expo prebuild -p ios` |

## بديل بدون Xcode: البناء السحابي (EAS)

إذا تعبت من Xcode، Expo يقدر يبني ويرفع للـ App Store من السحابة:

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios
```

(عدّل عنوان الخادم في `eas.json` قبل البناء.)
