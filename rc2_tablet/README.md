# rc2_tablet

التابلت مجرد **لانشر** (شاشة رئيسية + إشعارات + إعدادات). كل تطبيق (الوظائف، العقار، MDT...) هو ريسورس مستقل له واجهة خاصة فيه، يفتح داخل التابلت كـ iframe.

## المتطلبات

- `qbx_core`
- `ox_lib`
- `oxmysql`
- `ox_inventory`

## التركيب

1. انسخ `rc2_tablet` لمجلد الريسورسات وأضف `ensure rc2_tablet` بعد `qbx_core` و `ox_lib` و `ox_inventory`.
2. عرّف الآيتم في `ox_inventory/data/items.lua`:

```lua
['tablet'] = {
    label = 'Tablet',
    weight = 500,
    stack = false,
    close = true,
    client = { export = 'rc2_tablet.useTablet' },
},
```

3. اللغة تتبع `setr ox:locale "ar"` في `server.cfg`.

## إضافة تطبيق

**الطريقة 1 – من الكونفق** (`config.lua` → `Config.Apps`):

```lua
{
    identifier = 'jobs',
    name = 'الوظائف',
    image = 'apps/jobs.png',
    resource = 'rc2_jobs', -- إذا الريسورس مو شغال التطبيق يختفي
    ui = 'https://cfx-nui-rc2_jobs/web/build/index.html',
    jobs = { police = 0 }, -- اختياري
    onDuty = true,         -- اختياري
}
```

**الطريقة 2 – من ريسورس التطبيق نفسه (server):**

```lua
exports.rc2_tablet:RegisterApp({
    identifier = 'jobs',
    name = 'الوظائف',
    image = 'apps/jobs.png',
    ui = ('https://cfx-nui-%s/web/build/index.html'):format(GetCurrentResourceName()),
})
```

ينحذف تلقائياً لما الريسورس يطفي.

## التواصل بين واجهة التطبيق والتابلت

داخل واجهة التطبيق (الـ iframe):

```js
// إغلاق التطبيق
window.parent.postMessage({ action: 'phone:close' }, '*')

// إشعار
window.parent.postMessage({ action: 'phone:notify', data: { title: 'الوظائف', message: 'تم قبولك' } }, '*')

// استقبال رسائل من اللوا + الألوان
window.addEventListener('message', (e) => {
    if (e.data.action === 'phone:message') { /* e.data.data */ }
    if (e.data.action === 'phone:theme')   { /* e.data.data.color1 ... */ }
})

// NUI callbacks تروح لريسورس التطبيق نفسه
fetch('https://rc2_jobs/getJobs', { method: 'POST', body: JSON.stringify({}) })
```

## Exports

**Client**

| Export | الوصف |
|---|---|
| `open()` / `close()` / `isOpen()` | فتح / إغلاق التابلت |
| `openApp(id)` / `closeApp(id)` | فتح تطبيق معيّن |
| `notify(data)` | إشعار `{ title, message, icon, iconColor, image, app }` |
| `sendAppMessage(id, data)` | رسالة لواجهة التطبيق |
| `refreshApps()` | تحديث قائمة التطبيقات |

**Server**

| Export | الوصف |
|---|---|
| `RegisterApp(app)` / `RemoveApp(id)` | إضافة / حذف تطبيق |
| `Notify(source, data)` | إشعار على تابلت لاعب |
| `SendAppMessage(source, id, data)` | رسالة لواجهة التطبيق عند لاعب |
| `CanUseApp(source, id)` | يتحقق إن اللاعب مسموح له بالتطبيق |
| `GetAppsFor(source)` | التطبيقات المتاحة للاعب |

**Events (client)**: `rc2_tablet:client:opened`، `rc2_tablet:client:closed`، `rc2_tablet:client:appOpened (id)`، `rc2_tablet:client:appClosed (id)`
