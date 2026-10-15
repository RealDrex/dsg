Config = {}

-- اسم الآيتم في ox_inventory (لازم يكون معرّف في ox_inventory/data/items.lua)
Config.Item = 'tablet'

-- أمر لفتح التابلت (false لإلغائه). إذا RequireItem = true لازم يكون معه الآيتم
Config.Command = 'tablet'
Config.RequireItem = true

-- زر لفتح التابلت (false لإلغائه). اللاعب يقدر يغيّره من إعدادات اللعبة
Config.Keybind = false -- مثال: 'F5'

-- البروب والأنميشن وقت فتح التابلت
Config.Prop = {
    model = `prop_cs_tablet`,
    bone = 28422,
    offset = vec3(-0.05, 0.0, 0.0),
    rotation = vec3(0.0, 0.0, 0.0),
}

Config.Anim = {
    dict = 'amb@code_human_in_bus_passenger_idles@female@tablet@base',
    clip = 'base',
}

-- ألوان الواجهة (تنرسل للتابلت ولكل تطبيق داخله)
Config.Theme = {
    color1 = '#ff5a1f', -- اللون الأساسي
    color2 = '#1c1c1e',
    color3 = '#ffffff',
}

--[[
    التطبيقات
    كل تطبيق = ريسورس مستقل له واجهة خاصة فيه (iframe داخل التابلت).

    identifier : معرف فريد للتطبيق
    name       : الاسم اللي يظهر تحت الأيقونة
    image      : صورة الأيقونة (من web/build/apps) أو رابط
    color      : لون الخلفية إذا ما فيه صورة
    resource   : اسم ريسورس التطبيق. إذا مو شغال، التطبيق ما يظهر
    ui         : رابط واجهة التطبيق (https://cfx-nui-<resource>/<path>)
    jobs       : اختياري - { police = 0, ambulance = 2 } (الوظيفة = أقل رتبة)
    gangs      : اختياري - نفس فكرة jobs بس للعصابات
    onDuty     : اختياري - true = لازم يكون أون ديوتي
]]
Config.Apps = {
    {
        identifier = 'jobs',
        name = 'الوظائف',
        image = 'apps/jobs.png',
        color = '#1c1c1e',
        resource = 'rc2_jobs',
        ui = 'https://cfx-nui-rc2_jobs/web/build/index.html',
    },

    -- تطبيقات تنضاف مع الوقت (الأيقونات موجودة جاهزة في web/build/apps):
    -- { identifier = 'mdt',        name = 'MDT',      image = 'apps/mdt.png',        resource = 'rc2_mdt',        ui = 'https://cfx-nui-rc2_mdt/web/build/index.html', jobs = { police = 0 }, onDuty = true },
    -- { identifier = 'hotel',      name = 'الفندق',   image = 'apps/hotel.png',      resource = 'rc2_hotel',      ui = 'https://cfx-nui-rc2_hotel/web/build/index.html' },
    -- { identifier = 'furniture',  name = 'الأثاث',   image = 'apps/furniture.png',  resource = 'rc2_furniture',  ui = 'https://cfx-nui-rc2_furniture/web/build/index.html' },
    -- { identifier = 'managment',  name = 'الإدارة',  image = 'apps/managment.png',  resource = 'rc2_managment',  ui = 'https://cfx-nui-rc2_managment/web/build/index.html' },
    -- { identifier = 'supply',     name = 'التوريد',  image = 'apps/supply.png',     resource = 'rc2_supply',     ui = 'https://cfx-nui-rc2_supply/web/build/index.html' },
    -- { identifier = 'skilltree',  name = 'المهارات', image = 'apps/skilltree.png',  resource = 'rc2_skilltree',  ui = 'https://cfx-nui-rc2_skilltree/web/build/index.html' },
}
