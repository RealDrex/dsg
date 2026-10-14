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
cd ~/Desktop            # أو أي مكان فكّيت فيه الملف
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
npm run db:seed -w @bestprice/api     # ينشئ الجداول والبيانات التجريبية
npm run dev:api                       # الخادم على http://localhost:4000
```

اترك هذه النافذة مفتوحة. للتأكد افتح في المتصفح: http://localhost:4000/health

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

1. **غيّر الـ Bundle ID** لمعرّف خاص فيك، مثل `com.saud.bestprice`:
   - في `apps/mobile/app.json` عدّل `"bundleIdentifier": "app.bestprice.mobile"`.
   - ثم أعد التوليد: `npx expo prebuild --platform ios --clean`
2. اعرف IP جهاز الماك: **System Settings → Wi-Fi → Details** (مثال `192.168.1.20`). الجوال والماك لازم يكونون على نفس الشبكة.
3. في `apps/mobile/app.json` غيّر `"apiUrl": "http://localhost:4000"` إلى `"apiUrl": "http://192.168.1.20:4000"`.
4. وصّل الآيفون بالكيبل، وفعّل **Developer Mode** في الجوال (Settings → Privacy & Security → Developer Mode).
5. في Xcode: اضغط على مشروع **BestPrice** ← **Signing & Capabilities** ← فعّل **Automatically manage signing** ← اختر **Team** (يكفي حساب Apple ID عادي للتجربة على جوالك).
6. اختر جوالك من الأعلى واضغط ▶️.

> الكاميرا ومسح الباركود تشتغل على الجوال الحقيقي فقط، المحاكي ما فيه كاميرا. تقدر تجرّب بالإدخال اليدوي للرقم: `0197529846216`.

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
