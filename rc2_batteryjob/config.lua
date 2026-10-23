Config = {}

-- يفعّل أوامر الضبط (/battery_edit) ويطبع معلومات إضافية
Config.Debug = false

Config.JobLabel = 'مساعدة البطاريات'

--------------------------------------------------------------------------------
-- المقر (بداية الشيفت)
--------------------------------------------------------------------------------
Config.Depot = {
    ped = {
        model = `s_m_m_autoshop_02`,
        coords = vec4(528.46, -1603.54, 29.32, 47.98),
        scenario = 'WORLD_HUMAN_CLIPBOARD',
    },
    blip = { sprite = 354, color = 47, scale = 0.8, label = 'مساعدة البطاريات' },
    vehicleSpawns = {
        vec4(533.1, -1595.16, 28.18, 319.42),
    },
    -- اللاعب لازم يكون قريب من المقر عشان ينهي الشيفت
    returnDistance = 40.0,
}

--------------------------------------------------------------------------------
-- مركبة الخدمة
-- كل موديل له مكان الشاشة والمنافذ (إحداثيات نسبية للمركبة)
-- x سالب = الجهة اليسرى | y موجب = قدام | z موجب = فوق
-- عدّلها داخل اللعبة بـ /battery_edit screen (مع Config.Debug = true)
--------------------------------------------------------------------------------
Config.ServiceVehicle = {
    model = 'burrito3',
    plate = 'BATT',     -- بداية اللوحة
    fuel = 100.0,
}

Config.ServiceVehicleLayouts = {
    [`burrito3`] = {
        screen = { offset = vec3(-1.045, -0.35, 0.55), width = 0.52, height = 0.39 },
        -- منفذ الموجب والسالب تحت الشاشة (مكان خروج الأسلاك)
        ports = { offset = vec3(-1.045, -0.35, 0.18), spacing = 0.16 },
    },
}

-- الشاشة الخارجية (DUI)
Config.Screen = {
    resolution = { w = 640, h = 480 },
    drawDistance = 18.0,     -- يرسم الشاشة لين هالمسافة
    interactDistance = 1.3,  -- مسافة استخدام الشاشة
    camDistance = 0.75,      -- بعد الكاميرا عن الشاشة وقت الاستخدام
    camFov = 42.0,
    bezel = 0.03,            -- سماكة الإطار
}

--------------------------------------------------------------------------------
-- الأسلاك
--------------------------------------------------------------------------------
Config.Cables = {
    -- موديل المشبك (غيّره لموديلك الخاص لما يجهز)
    clampModel = `prop_tool_pliers`,
    ropeType = 1,
    -- طول السلك (الزايد ينسدح على الأرض)
    ropeLength = 9.0,
    -- أقصى مسافة بين المنفذ واللاعب قبل ما ترجع الأسلاك للمركبة
    maxReach = 8.5,
    -- الأحمر باليد اليمنى والأسود باليسرى
    hands = {
        red   = { bone = 57005, offset = vec3(0.12, 0.02, -0.02), rot = vec3(-90.0, 0.0, 0.0) },
        black = { bone = 18905, offset = vec3(0.12, 0.02, 0.02),  rot = vec3(-90.0, 0.0, 0.0) },
    },
    -- مسافة السناب على القطب
    snapDistance = 0.09,
}

--------------------------------------------------------------------------------
-- البطارية داخل الكبوت
--------------------------------------------------------------------------------
Config.Battery = {
    model = `prop_car_battery_01`,
    -- أقطاب البطارية نسبةً لموديل البطارية
    terminals = {
        red   = vec3(0.075, 0.05, 0.12),
        black = vec3(-0.075, 0.05, 0.12),
    },
    -- مكان البطارية الافتراضي: نسبةً لعظمة engine في السيارة
    defaultOffset = vec3(0.32, 0.1, 0.12),
    -- لكل موديل مكان خاص (نسبةً لمركز السيارة) - /battery_edit battery
    perModel = {
        -- [`asea`] = vec3(0.35, 1.55, 0.35),
    },
}

-- السيارات المعطلة (لازم تكون محركها قدام)
Config.TargetVehicles = {
    'asea', 'premier', 'primo', 'stanier', 'washington', 'ingot', 'intruder', 'emperor',
}

Config.CustomerPeds = {
    `a_m_m_business_01`, `a_f_y_business_02`, `a_m_y_hipster_01`, `a_f_m_bevhills_01`,
    `a_m_m_eastsa_01`, `a_f_y_tourist_01`, `a_m_y_genstreet_01`, `a_f_m_downtown_01`,
}

Config.CustomerNames = {
    'خالد', 'سارة', 'فهد', 'نورة', 'عبدالله', 'ريم', 'سلطان', 'منيرة', 'ماجد', 'هند',
}

--------------------------------------------------------------------------------
-- مناطق البلاغات
-- السكربت يختار أقرب طريق لهالنقطة ويوقف السيارة على جنب
--------------------------------------------------------------------------------
Config.CallAreas = {
    { label = 'ليجن سكوير',   coords = vec3(215.0, -930.0, 30.0) },
    { label = 'روكفورد',       coords = vec3(-560.0, -210.0, 37.0) },
    { label = 'ميرور بارك',    coords = vec3(1150.0, -460.0, 66.0) },
    { label = 'فسبوتشي',       coords = vec3(-1280.0, -1130.0, 6.0) },
    { label = 'ديفيس',         coords = vec3(400.0, -1600.0, 29.0) },
    { label = 'لا ميسا',       coords = vec3(820.0, -1040.0, 26.0) },
    { label = 'ليتل سول',      coords = vec3(-700.0, -930.0, 19.0) },
    { label = 'ستربري',        coords = vec3(130.0, -1300.0, 29.0) },
}
-- أقصى بعد مسموح بين نقطة البلاغ وموقع السيارة الفعلي
Config.CallAreaRadius = 180.0
-- السيارة تنزل لما يقرب اللاعب هالمسافة
Config.SpawnDistance = 180.0

--------------------------------------------------------------------------------
-- الشغل والفلوس
--------------------------------------------------------------------------------
Config.Payment = { min = 450, max = 650, account = 'bank' }
Config.CallCooldown = { min = 15, max = 40 } -- ثواني قبل البلاغ الجاي
Config.AssistDuration = 12                   -- مدة الشحن بالثواني
Config.FailChance = 0.15                      -- احتمال فشل التشغيل (يعيد المحاولة)
Config.MaxDistanceFromTarget = 8.0            -- لازم يكون قريب من السيارة لكل خطوة

-- العقود (تظهر في التابلت)
Config.Contracts = {
    { id = 'starter', label = 'عقد المبتدئ', description = 'أنجز 3 بلاغات خلال 30 دقيقة', calls = 3, time = 30, bonus = 600 },
    { id = 'city',    label = 'عقد المدينة', description = 'أنجز 6 بلاغات خلال 60 دقيقة', calls = 6, time = 60, bonus = 1600 },
    { id = 'marathon', label = 'ماراثون الطريق', description = 'أنجز 10 بلاغات خلال 90 دقيقة', calls = 10, time = 90, bonus = 3200 },
}

--------------------------------------------------------------------------------
-- الأنميشنات
--------------------------------------------------------------------------------
Config.Anims = {
    takeCables  = { dict = 'pickup_object', clip = 'pickup_low', flag = 0, duration = 1200 },
    storeCables = { dict = 'pickup_object', clip = 'putdown_low', flag = 0, duration = 1200 },
    holdCables  = { dict = 'anim@heists@box_carry@', clip = 'idle', flag = 49 },
    hood        = { dict = 'mini@repair', clip = 'fixing_a_player', flag = 1 },
    screen      = { dict = 'amb@prop_human_atm@male@idle_a', clip = 'idle_a', flag = 1 },
    customerIdle = 'WORLD_HUMAN_STAND_IMPATIENT',
}

--------------------------------------------------------------------------------
-- مفاتيح المركبة - عدلها حسب سكربت المفاتيح عندك (server side)
--------------------------------------------------------------------------------
Config.GiveKeys = function(source, vehicle)
    if GetResourceState('qbx_vehiclekeys') == 'started' then
        exports.qbx_vehiclekeys:GiveKeys(source, vehicle, true)
    end
end
