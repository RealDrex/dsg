--[[
    الشاشة الخارجية على جنب مركبة الخدمة
    - صفحة HTML تنرسم كـ DUI على مستطيل ملصوق بجنب المركبة (DRAW_TEXTURED_POLY)
    - ما تحتاج موديل مخصص: المكان والمقاس من Config.ServiceVehicleLayouts
    - الاستخدام: كاميرا قدام الشاشة + الماوس، والضغط ينرسل للـ DUI
]]

Screen = { interacting = false }

local DRAW_TEXTURED_POLY <const> = 0x29280002282F1928
local TXD_NAME <const> = 'rc2_battery_screen'
local TXN_NAME <const> = 'screen'

local dui, duiReady
local activeVan, activeLayout
local res = Config.Screen.resolution

local function ensureDui()
    if dui then return end
    local url = ('nui://%s/web/screen/index.html'):format(cache.resource)
    dui = CreateDui(url, res.w, res.h)
    local txd = CreateRuntimeTxd(TXD_NAME)
    CreateRuntimeTextureFromDuiHandle(txd, TXN_NAME, GetDuiHandle(dui))
end

local function destroyDui()
    if dui then DestroyDui(dui) end
    dui, duiReady = nil, false
end

local function sendDui(data)
    if dui then SendDuiMessage(dui, json.encode(data)) end
end

function Screen.layout(vehicle)
    return Config.ServiceVehicleLayouts[GetEntityModel(vehicle)]
end

-- زوايا الشاشة بإحداثيات العالم + الاتجاه الخارج منها
-- الشاشة على الجهة اليسرى: الخارج = -X، يمين الواقف قدامها = -Y
local function screenGeometry(vehicle, offset, w, h)
    local c = offset
    local tl = Utils.toWorld(vehicle, vec3(c.x, c.y + w / 2, c.z + h / 2))
    local tr = Utils.toWorld(vehicle, vec3(c.x, c.y - w / 2, c.z + h / 2))
    local bl = Utils.toWorld(vehicle, vec3(c.x, c.y + w / 2, c.z - h / 2))
    local br = Utils.toWorld(vehicle, vec3(c.x, c.y - w / 2, c.z - h / 2))
    local normal = Utils.toWorldDir(vehicle, vec3(-1.0, 0.0, 0.0))
    return tl, tr, bl, br, normal
end

local function drawQuad(tl, tr, bl, br, r, g, b, a)
    DrawPoly(tl.x, tl.y, tl.z, bl.x, bl.y, bl.z, tr.x, tr.y, tr.z, r, g, b, a)
    DrawPoly(tr.x, tr.y, tr.z, bl.x, bl.y, bl.z, br.x, br.y, br.z, r, g, b, a)
    -- الاتجاه المعاكس عشان ما ينحذف بسبب culling
    DrawPoly(tl.x, tl.y, tl.z, tr.x, tr.y, tr.z, bl.x, bl.y, bl.z, r, g, b, a)
    DrawPoly(tr.x, tr.y, tr.z, br.x, br.y, br.z, bl.x, bl.y, bl.z, r, g, b, a)
end

local function drawTexturedTri(a, b, c, ua, va, ub, vb, uc, vc)
    Citizen.InvokeNative(DRAW_TEXTURED_POLY,
        a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z,
        255, 255, 255, 255, TXD_NAME, TXN_NAME,
        ua, va, 1.0, ub, vb, 1.0, uc, vc, 1.0)
end

local function drawScreen(vehicle, layout)
    local s = layout.screen
    local bezel = Config.Screen.bezel

    -- الإطار (ورا الشاشة بشوي)
    local inner = vec3(s.offset.x + 0.004, s.offset.y, s.offset.z)
    local btl, btr, bbl, bbr = screenGeometry(vehicle, inner, s.width + bezel * 2, s.height + bezel * 2)
    drawQuad(btl, btr, bbl, bbr, 18, 18, 20, 255)

    -- الشاشة نفسها
    local tl, tr, bl, br = screenGeometry(vehicle, s.offset, s.width, s.height)
    drawTexturedTri(tl, bl, tr, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0)
    drawTexturedTri(tr, bl, br, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0)
    drawTexturedTri(tl, tr, bl, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0)
    drawTexturedTri(tr, br, bl, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0)

    -- لوحة المنافذ (+ / -)
    local p = layout.ports
    local panel = vec3(p.offset.x + 0.004, p.offset.y, p.offset.z)
    local ptl, ptr, pbl, pbr = screenGeometry(vehicle, panel, p.spacing * 2 + 0.06, 0.14)
    drawQuad(ptl, ptr, pbl, pbr, 22, 22, 24, 255)

    local size = 0.05
    local red = vec3(p.offset.x, p.offset.y + p.spacing / 2, p.offset.z)
    local black = vec3(p.offset.x, p.offset.y - p.spacing / 2, p.offset.z)
    local rtl, rtr, rbl, rbr = screenGeometry(vehicle, red, size, size)
    drawQuad(rtl, rtr, rbl, rbr, 200, 30, 30, 255)
    local ktl, ktr, kbl, kbr = screenGeometry(vehicle, black, size, size)
    drawQuad(ktl, ktr, kbl, kbr, 40, 40, 40, 255)
end

-- مكان خروج السلك من المنفذ (بالعالم)
function Screen.portCoords(vehicle, color)
    local layout = Screen.layout(vehicle)
    if not layout then return GetEntityCoords(vehicle) end
    local p = layout.ports
    local y = color == 'red' and p.offset.y + p.spacing / 2 or p.offset.y - p.spacing / 2
    return Utils.toWorld(vehicle, vec3(p.offset.x - 0.03, y, p.offset.z))
end

function Screen.centerCoords(vehicle)
    local layout = Screen.layout(vehicle)
    if not layout then return end
    return Utils.toWorld(vehicle, layout.screen.offset)
end

local function pushVanState(vehicle)
    local state = Entity(vehicle).state.batteryScreen or { mode = 'idle' }
    sendDui({ type = 'state', data = state })
end

-- يختار أقرب مركبة خدمة ويجهز لها الـ DUI
CreateThread(function()
    while true do
        local pedCoords = GetEntityCoords(cache.ped)
        local nearest, nearestDist

        for _, vehicle in ipairs(GetGamePool('CVehicle')) do
            if Entity(vehicle).state.batteryVan and Screen.layout(vehicle) then
                local dist = #(pedCoords - GetEntityCoords(vehicle))
                if dist < Config.Screen.drawDistance and (not nearestDist or dist < nearestDist) then
                    nearest, nearestDist = vehicle, dist
                end
            end
        end

        if nearest and nearest ~= activeVan then
            ensureDui()
            activeVan, activeLayout = nearest, Screen.layout(nearest)
            pushVanState(nearest)
        elseif not nearest and activeVan then
            activeVan, activeLayout = nil, nil
            destroyDui()
        end

        Wait(1000)
    end
end)

CreateThread(function()
    while true do
        if activeVan and DoesEntityExist(activeVan) and dui then
            local center = Utils.toWorld(activeVan, activeLayout.screen.offset)
            local normal = Utils.toWorldDir(activeVan, vec3(-1.0, 0.0, 0.0))
            local camPos = GetFinalRenderedCamCoord()
            local toCam = camPos - center
            -- يرسم بس لو الكاميرا قدام الشاشة
            if toCam.x * normal.x + toCam.y * normal.y + toCam.z * normal.z > 0 then
                drawScreen(activeVan, activeLayout)
            end
            Wait(0)
        else
            Wait(500)
        end
    end
end)

AddStateBagChangeHandler('batteryScreen', nil, function(bagName, _, value)
    local entity = GetEntityFromStateBagName(bagName)
    if entity ~= 0 and entity == activeVan then
        sendDui({ type = 'state', data = value or { mode = 'idle' } })
    end
end)

RegisterNUICallback('screen:ready', function(_, cb)
    duiReady = true
    if activeVan then pushVanState(activeVan) end
    cb({})
end)

--------------------------------------------------------------------------------
-- استخدام الشاشة بالماوس
--------------------------------------------------------------------------------

local function cursorToDui(vehicle, layout, cursorX, cursorY)
    local s = layout.screen
    local center = Utils.toWorld(vehicle, s.offset)
    local normal = Utils.toWorldDir(vehicle, vec3(-1.0, 0.0, 0.0))
    local origin, dir = CamMode.ray(cursorX, cursorY)
    local hit = Utils.rayPlane(origin, dir, center, normal)
    if not hit then return end

    local localHit = GetOffsetFromEntityGivenWorldCoords(vehicle, hit.x, hit.y, hit.z)
    local u = ((s.offset.y + s.width / 2) - localHit.y) / s.width
    local v = ((s.offset.z + s.height / 2) - localHit.z) / s.height
    if u < 0 or u > 1 or v < 0 or v > 1 then return end

    return math.floor(u * res.w), math.floor(v * res.h)
end

function Screen.interact(vehicle)
    local layout = Screen.layout(vehicle)
    if not layout or Screen.interacting then return end
    if vehicle ~= activeVan then return end

    Screen.interacting = true
    Screen.vehicle = vehicle

    local center = Utils.toWorld(vehicle, layout.screen.offset)
    local normal = Utils.toWorldDir(vehicle, vec3(-1.0, 0.0, 0.0))
    local camPos = center + normal * Config.Screen.camDistance

    -- اللاعب يمشي ويوقف قدام الشاشة
    local pedZ = GetEntityCoords(cache.ped).z
    local standPos = center + normal * 0.55
    TaskGoStraightToCoord(cache.ped, standPos.x, standPos.y, pedZ, 1.0, 2000, GetHeadingFromVector_2d(-normal.x, -normal.y), 0.1)
    Wait(1200)
    SetEntityHeading(cache.ped, GetHeadingFromVector_2d(-normal.x, -normal.y))
    Utils.playAnim(cache.ped, Config.Anims.screen)

    CamMode.start(camPos, center, Config.Screen.camFov)
    lib.showTextUI(locale('screen_controls'), { position = 'left-center' })
    sendDui({ type = 'focus', value = true })

    while Screen.interacting do
        CamMode.frame()
        local cx, cy = CamMode.cursor()
        local px, py = cursorToDui(vehicle, layout, cx, cy)

        if px then
            SendDuiMouseMove(dui, px, py)
            if CamMode.clicked() then SendDuiMouseDown(dui, 'left') end
            if CamMode.released() then SendDuiMouseUp(dui, 'left') end
        end

        -- بديل للضغط: Enter يشغل زر البدء مباشرة
        if IsDisabledControlJustPressed(0, 191) then
            CreateThread(Job.startAssist)
        end

        if CamMode.exitPressed() or not DoesEntityExist(vehicle) then
            break
        end

        Wait(0)
    end

    sendDui({ type = 'focus', value = false })
    lib.hideTextUI()
    CamMode.stop()
    Utils.stopAnim(cache.ped, Config.Anims.screen)
    Screen.interacting = false
    Screen.vehicle = nil
end

function Screen.close()
    Screen.interacting = false
end

-- زر "بدء المساعدة" داخل صفحة الشاشة
RegisterNUICallback('screen:start', function(_, cb)
    cb({})
    if Screen.interacting then CreateThread(Job.startAssist) end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource ~= cache.resource then return end
    if CamMode.active then CamMode.stop() end
    destroyDui()
end)
