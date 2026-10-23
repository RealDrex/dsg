--[[
    أداة ضبط الأماكن داخل اللعبة (Config.Debug = true)
    /battery_edit screen   -> مكان الشاشة على مركبة الخدمة
    /battery_edit ports    -> مكان منافذ الأسلاك
    /battery_edit battery  -> مكان البطارية داخل كبوت أقرب سيارة

    الأسهم ← → قدام/ورا | ↑ ↓ فوق/تحت | PageUp/PageDown داخل/برا
    Shift = خطوة صغيرة | Enter = حفظ وطباعة السطر للكونفق
]]

if not Config.Debug then return end

local editing = false

local function nearestVehicle(filter)
    local pedCoords = GetEntityCoords(cache.ped)
    local best, bestDist
    for _, vehicle in ipairs(GetGamePool('CVehicle')) do
        if filter(vehicle) then
            local dist = #(pedCoords - GetEntityCoords(vehicle))
            if dist < 10.0 and (not bestDist or dist < bestDist) then best, bestDist = vehicle, dist end
        end
    end
    return best
end

local function fmt(v)
    return ('vec3(%.3f, %.3f, %.3f)'):format(v.x, v.y, v.z)
end

local function editLoop(getOffset, setOffset, onDone)
    editing = true
    lib.showTextUI('← → قدام/ورا  \n↑ ↓ فوق/تحت  \nPgUp/PgDn داخل/برا  \nShift دقيق | Enter حفظ', { position = 'left-center' })

    while editing do
        local step = IsControlPressed(0, 21) and 0.002 or 0.01
        local o = getOffset()
        local d = vec3(0.0, 0.0, 0.0)

        if IsControlPressed(0, 174) then d = d + vec3(0.0, step, 0.0) end
        if IsControlPressed(0, 175) then d = d - vec3(0.0, step, 0.0) end
        if IsControlPressed(0, 172) then d = d + vec3(0.0, 0.0, step) end
        if IsControlPressed(0, 173) then d = d - vec3(0.0, 0.0, step) end
        if IsControlPressed(0, 10) then d = d + vec3(step, 0.0, 0.0) end
        if IsControlPressed(0, 11) then d = d - vec3(step, 0.0, 0.0) end

        for _, c in ipairs({ 172, 173, 174, 175, 10, 11 }) do DisableControlAction(0, c, true) end

        if #d > 0 then setOffset(o + d) end

        if IsControlJustPressed(0, 191) then
            editing = false
            onDone(getOffset())
        end
        Wait(0)
    end

    lib.hideTextUI()
end

RegisterCommand('battery_edit', function(_, args)
    if editing then editing = false return end
    local mode = args[1] or 'screen'

    if mode == 'screen' or mode == 'ports' then
        local van = nearestVehicle(function(v) return Entity(v).state.batteryVan and Screen.layout(v) end)
        if not van then return lib.notify({ description = 'ابدأ الشيفت وقف جنب مركبة الخدمة', type = 'error' }) end

        local layout = Screen.layout(van)
        local part = layout[mode == 'screen' and 'screen' or 'ports']
        editLoop(function() return part.offset end, function(o) part.offset = o end, function(o)
            local line = ('%s.offset = %s'):format(mode, fmt(o))
            print(('[rc2_batteryjob] %s (model %s)'):format(line, GetEntityModel(van)))
            lib.setClipboard(line)
            lib.notify({ description = 'انطبع في F8 وانسخ: ' .. line, type = 'success' })
        end)
    elseif mode == 'battery' then
        local vehicle = nearestVehicle(function(v) return v ~= cache.vehicle and not Entity(v).state.batteryVan end)
        if not vehicle then return lib.notify({ description = 'ما فيه سيارة قريبة', type = 'error' }) end

        local model = GetEntityModel(vehicle)
        Battery.keep[vehicle] = true
        SetVehicleDoorOpen(vehicle, 4, false, false)
        Config.Battery.perModel[model] = Battery.offset(vehicle)
        Battery.refresh(vehicle)

        editLoop(function() return Config.Battery.perModel[model] end, function(o)
            Config.Battery.perModel[model] = o
            Battery.refresh(vehicle)
        end, function(o)
            local name = GetDisplayNameFromVehicleModel(model):lower()
            local line = ('[`%s`] = %s,'):format(name, fmt(o))
            print('[rc2_batteryjob] Config.Battery.perModel ' .. line)
            lib.setClipboard(line)
            lib.notify({ description = 'انطبع في F8 وانسخ: ' .. line, type = 'success' })
        end)
        Battery.keep[vehicle] = nil
    end
end, false)
