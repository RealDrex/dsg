OT = {
    ready = false,          -- NUI handshake done
    shown = false,          -- HUD currently rendered
    visible = true,         -- user toggle (/hud)
    loaded = false,         -- character loaded
    framework = 'standalone',
    inventory = 'none',
    core = nil,
    ped = PlayerPedId(),
    playerId = PlayerId(),
    vehicle = 0,
    vehClass = -1,
    isAircraft = false,
    minimapVisible = false,
}

-- ───────────────────────────── helpers ─────────────────────────────

function OT.clamp(v, min, max)
    v = tonumber(v) or 0
    if v < min then return min end
    if v > max then return max end
    return v
end

function OT.pct(v)
    return math.floor(OT.clamp(v, 0, 100) + 0.5)
end

function OT.send(action, data)
    data = data or {}
    data.action = action
    SendNUIMessage(data)
end

-- ─────────────────────────── framework ────────────────────────────

local function started(name)
    return GetResourceState(name) == 'started'
end

do
    local fw = Config.Framework
    if fw == 'auto' then
        if started('qbx_core') then fw = 'qbx'
        elseif started('qb-core') then fw = 'qb'
        elseif started('es_extended') then fw = 'esx'
        else fw = 'standalone' end
    end
    OT.framework = fw

    if fw == 'qb' then
        OT.core = exports['qb-core']:GetCoreObject()
    elseif fw == 'esx' then
        OT.core = exports['es_extended']:getSharedObject()
    end

    local inv = Config.Inventory
    if inv == 'auto' then
        if started('ox_inventory') then inv = 'ox'
        elseif fw == 'qb' or fw == 'qbx' then inv = 'qb'
        else inv = 'none' end
    end
    OT.inventory = inv
end

function OT.getPlayerData()
    if OT.framework == 'qb' then
        return OT.core.Functions.GetPlayerData()
    elseif OT.framework == 'qbx' then
        return exports.qbx_core:GetPlayerData()
    elseif OT.framework == 'esx' then
        return OT.core.GetPlayerData()
    end
end

function OT.getJob()
    local pd = OT.getPlayerData()
    return pd and pd.job and pd.job.name or nil
end

-- ─────────────────────────── loaded state ─────────────────────────

local loadedCallbacks = {}

function OT.onLoaded(cb)
    loadedCallbacks[#loadedCallbacks + 1] = cb
    if OT.loaded then CreateThread(cb) end
end

local function setLoaded(state)
    OT.loaded = state
    if state then
        for _, cb in ipairs(loadedCallbacks) do CreateThread(cb) end
    end
end

RegisterNetEvent('QBCore:Client:OnPlayerLoaded', function() setLoaded(true) end)
RegisterNetEvent('QBCore:Client:OnPlayerUnload', function() setLoaded(false) end)
RegisterNetEvent('esx:playerLoaded', function() setLoaded(true) end)
RegisterNetEvent('esx:onPlayerLogout', function() setLoaded(false) end)

CreateThread(function()
    if OT.framework == 'standalone' then
        setLoaded(true)
    elseif OT.framework == 'esx' then
        if OT.core.IsPlayerLoaded() then setLoaded(true) end
    elseif LocalPlayer.state.isLoggedIn then
        setLoaded(true)
    end
end)

-- ─────────────────────────── NUI handshake ────────────────────────

local function visibilityMode(v)
    if v == 'never' then return 'off' end
    return v
end

RegisterNUICallback('ready', function(_, cb)
    OT.ready = true
    local L, dirs = Config.Labels, Config.Labels.directions
    cb({
        Config = {
            colors = Config.Colors,
            speedometerUnit = Config.Vehicle.unit,
            uiScale = Config.UI.scale,
            clock12h = Config.UI.clock12h,
            invertRoll = Config.Aircraft.invertRoll,
            visibility = {
                compass = visibilityMode(Config.Compass.show),
                map = Config.Minimap.show == 'native' and 'off' or visibilityMode(Config.Minimap.show),
            },
        },
        Labels = {
            Compass = {
                north = dirs[1], northEast = dirs[2], east = dirs[3], southEast = dirs[4],
                south = dirs[5], southWest = dirs[6], west = dirs[7], northWest = dirs[8],
                key = Config.Compass.prompt.key,
                setWaypoint = L.setWaypoint,
                removeWaypoint = L.removeWaypoint,
            },
        },
        Perms = {},
    })
end)

RegisterNUICallback('settings:update', function(_, cb) cb('ok') end)
RegisterNUICallback('compass:focus', function(_, cb) cb('ok') end) -- focus is decided in Lua
RegisterNUICallback('close', function(_, cb)
    SetNuiFocus(false, false)
    cb('ok')
end)

-- ─────────────────────────── visibility ───────────────────────────

local function shouldShow()
    if not OT.visible then return false end
    if Config.HideUntilLoaded and not OT.loaded then return false end
    if Config.HideInPauseMenu and (IsPauseMenuActive() or IsScreenFadedOut()) then return false end
    return true
end

-- ─────────────────────────── main loop ────────────────────────────

CreateThread(function()
    while not OT.ready do Wait(250) end

    local lastShown = nil
    while true do
        local ped = PlayerPedId()
        local veh = GetVehiclePedIsIn(ped, false)
        OT.ped = ped
        OT.vehicle = veh
        OT.vehClass = veh ~= 0 and GetVehicleClass(veh) or -1
        OT.isAircraft = OT.vehClass == 15 or OT.vehClass == 16

        local show = shouldShow()
        OT.shown = show
        if show ~= lastShown then
            lastShown = show
            OT.send('disableAll', { state = not show })
        end

        if show then
            OT.send('update', {
                statusData = OT.Player.collect(),
                micData = OT.Player.collectMic(),
                weaponData = OT.Weapon.collect(),
                vehicleData = OT.Vehicle.collect(),
                compassData = OT.Compass.collect(),
                weatherData = { hour = GetClockHours(), minute = GetClockMinutes(), day = GetClockDayOfWeek() },
            })
            Wait(Config.UpdateInterval)
        else
            Wait(500)
        end
    end
end)

-- ─────────────────────────── minimap ──────────────────────────────
-- The UI measures the hole of its map frame (0..1 screen fractions) and sends it here,
-- so the native radar sits exactly inside the frame on any resolution.

local mapRect, appliedRect = nil, nil

RegisterNUICallback('minimap:rect', function(data, cb)
    if data and data.w and data.h then mapRect = data end
    cb('ok')
end)

local lastMapValues = nil
local editBlur = nil        -- live copy of Config.Minimap.blur while /hudmapedit is open
local squareLoaded, squareTried = false, false

-- optional square mask texture: put squaremap.ytd (e.g. from qb-hud) in ot_hud/stream/
-- tried once only: when the file is missing we must not wait on every re-apply
local function loadSquareTexture()
    if squareTried or not Config.Minimap.squareTexture then return end
    squareTried = true
    RequestStreamedTextureDict('squaremap', false)
    local timeout = GetGameTimer() + 1500
    while not HasStreamedTextureDictLoaded('squaremap') and GetGameTimer() < timeout do Wait(0) end
    if HasStreamedTextureDictLoaded('squaremap') then
        AddReplaceTexture('platform:/textures/graphics', 'radarmasksm', 'squaremap', 'radarmasksm')
        AddReplaceTexture('platform:/textures/graphics', 'radarmask1g', 'squaremap', 'radarmasksm')
        squareLoaded = true
    end
end

local function applyMinimap(r)
    loadSquareTexture()

    -- screen size in pixels (the UI sends it; fall back to the game's resolution)
    local W, H = r.resX, r.resY
    if not W or not H or W <= 0 or H <= 0 then W, H = GetActiveScreenResolution() end

    -- GTA lays out HUD components inside a centered 16:9 area on wider screens
    -- (ultrawide). Convert the UI's pixel rect into that space.
    local hudW, originX = W, 0.0
    if W / H > 16 / 9 + 0.01 then
        hudW = H * 16 / 9
        originX = (W - hudW) * 0.5
    end

    local left, top = r.x * W, r.y * H
    local w = (r.w * W) / hudW
    local h = r.h

    -- 'L','B' alignment is relative to the safe zone
    local off = (1.0 - GetSafeZoneSize()) * 0.5
    local o = Config.Minimap.offset or {}
    local x = (left - originX) / hudW - off + (o.x or 0.0)
    local y = top / H - (1.0 - h) + off + (o.y or 0.0)

    -- 'minimap'      = player arrow + blips  -> exactly the frame hole
    -- 'minimap_blur' = the drawn map itself  -> bigger than the hole (multipliers of it, same idea as qb-hud)
    -- 'minimap_mask' = clips the blips       -> qb-hud values
    local b = editBlur or Config.Minimap.blur
    local bx, by, bw, bh = x + b.x * w, y + b.y * h, w * b.w, h * b.h
    local m = Config.Minimap.mask

    SetMinimapClipType(0)
    SetMinimapComponentPosition('minimap', 'L', 'B', x, y, w, h)
    SetMinimapComponentPosition('minimap_mask', 'L', 'B', x + m.x, m.y, m.w, m.h)
    SetMinimapComponentPosition('minimap_blur', 'L', 'B', bx, by, bw, bh)
    SetBlipAlpha(GetNorthRadarBlip(), 0)

    lastMapValues = { W = W, H = H, x = x, y = y, w = w, h = h, square = squareLoaded }
    -- toggling the big map forces the radar to pick up the new position
    SetBigmapActive(true, false)
    Wait(0)
    SetBigmapActive(false, false)
end

-- /hudmap -> prints the current values in F8
RegisterCommand('hudmap', function()
    local v, b = lastMapValues, editBlur or Config.Minimap.blur
    if not v then return print('[ot_hud] minimap not placed yet (get in a vehicle)') end
    print(('[ot_hud] screen %dx%d | minimap x=%.4f y=%.4f w=%.4f h=%.4f | squaremap texture: %s'):format(
        v.W, v.H, v.x, v.y, v.w, v.h, v.square and 'yes' or 'no'))
    print(('[ot_hud] Config.Minimap.blur = { x = %.3f, y = %.3f, w = %.3f, h = %.3f }'):format(b.x, b.y, b.w, b.h))
end, false)

-- /hudmapedit -> line the drawn map up with the frame using the keyboard (in a vehicle):
--   arrows = move the map   |   SHIFT + arrows = stretch / shrink   |   ENTER = done (prints the config line)
RegisterCommand('hudmapedit', function()
    if editBlur then return end
    if OT.vehicle == 0 then
        OT.send('notif', { notifData = { message = 'Get in a vehicle first', type = 'warning' } })
        return
    end
    local c = Config.Minimap.blur
    editBlur = { x = c.x, y = c.y, w = c.w, h = c.h }
    OT.send('notif', { notifData = { message = 'Map edit: arrows move, SHIFT + arrows resize, ENTER to finish', type = 'info', duration = 8000 } })

    CreateThread(function()
        local step, last = 0.005, 0
        while editBlur do
            for _, k in ipairs({ 172, 173, 174, 175, 191, 201, 21 }) do DisableControlAction(0, k, true) end
            local now = GetGameTimer()
            if now - last > 60 then
                local shift = IsDisabledControlPressed(0, 21)
                local up, down = IsDisabledControlPressed(0, 172), IsDisabledControlPressed(0, 173)
                local left, right = IsDisabledControlPressed(0, 174), IsDisabledControlPressed(0, 175)
                local changed = up or down or left or right
                if shift then
                    if right then editBlur.w = editBlur.w + step * 2 end
                    if left then editBlur.w = math.max(0.1, editBlur.w - step * 2) end
                    if up then editBlur.h = editBlur.h + step * 2 end
                    if down then editBlur.h = math.max(0.1, editBlur.h - step * 2) end
                else
                    if right then editBlur.x = editBlur.x + step end
                    if left then editBlur.x = editBlur.x - step end
                    if up then editBlur.y = editBlur.y - step end
                    if down then editBlur.y = editBlur.y + step end
                end
                if changed then last = now; appliedRect = nil end
            end
            if IsDisabledControlJustPressed(0, 191) or IsDisabledControlJustPressed(0, 201) then
                Config.Minimap.blur = editBlur
                local line = ('Config.Minimap.blur = { x = %.3f, y = %.3f, w = %.3f, h = %.3f }'):format(editBlur.x, editBlur.y, editBlur.w, editBlur.h)
                editBlur = nil
                print('[ot_hud] put this in config.lua -> ' .. line)
                OT.send('notif', { notifData = { message = 'Saved for this session. F8 has the line for config.lua', type = 'success', duration = 8000 } })
            end
            Wait(0)
        end
    end)
end, false)

CreateThread(function()
    if Config.Minimap.show == 'native' then return end

    local scaleform = nil
    if Config.Minimap.hideHealthArmour then
        scaleform = RequestScaleformMovie('minimap')
        local timeout = GetGameTimer() + 5000
        while not HasScaleformMovieLoaded(scaleform) and GetGameTimer() < timeout do Wait(0) end
    end

    while true do
        local mode = Config.Minimap.show
        local want = OT.shown and (mode == 'always' or (mode == 'vehicle' and OT.vehicle ~= 0))
        -- enforce every tick, not only on change: spawn / multicharacter scripts turn the radar back on
        if IsRadarHidden() == want then DisplayRadar(want) end
        OT.minimapVisible = want

        if want and mapRect and mapRect ~= appliedRect then
            appliedRect = mapRect
            applyMinimap(mapRect)
        end

        if want and scaleform then
            BeginScaleformMovieMethod(scaleform, 'SETUP_HEALTH_ARMOUR')
            ScaleformMovieMethodAddParamInt(3)
            EndScaleformMovieMethod()
            Wait(0)
        else
            Wait(want and 100 or 250)
        end
    end
end)

-- ─────────────────────────── native HUD ───────────────────────────

CreateThread(function()
    local list = Config.HideNativeComponents
    if not list or #list == 0 then return end
    while true do
        if OT.shown then
            for i = 1, #list do HideHudComponentThisFrame(list[i]) end
            Wait(0)
        else
            Wait(250)
        end
    end
end)

-- ─────────────────────────── commands / exports ───────────────────

local function setHudVisible(state)
    if state == nil then state = not OT.visible end
    OT.visible = state and true or false
end

if Config.Commands.toggleHud then
    RegisterCommand(Config.Commands.toggleHud, function() setHudVisible() end, false)
end

if Config.Commands.toggleCompass then
    RegisterCommand(Config.Commands.toggleCompass, function()
        OT.compassHidden = not OT.compassHidden
        OT.send('command:trigger', { command = 'compass' })
    end, false)
end

exports('toggleHud', setHudVisible)
exports('isHudVisible', function() return OT.shown end)

-- notifications: exports.ot_hud:notify('Vehicle stored', 'success', 5000)
-- types: info, success, fail, warning, alert
local function notify(message, nType, duration, icon)
    if type(message) == 'table' then
        OT.send('notif', { notifData = message })
        return
    end
    OT.send('notif', { notifData = { message = message, type = nType or 'info', duration = duration, icon = icon } })
end
exports('notify', notify)
RegisterNetEvent('ot_hud:client:notify', notify)

-- extra status tiles: exports.ot_hud:addStatus('drunk', 'stress', 40, '#a855f7')
exports('addStatus', function(id, icon, value, color)
    OT.send('insertStatus', { data = { id = id, icon = icon, value = value, color = color } })
end)
exports('updateStatus', function(id, value, icon, color)
    OT.send('updateStatus', { id = id, data = { value = value, icon = icon, color = color } })
end)
exports('removeStatus', function(id)
    OT.send('removeStatus', { id = id })
end)

-- slide the right side (speedometer / weapon) when a phone or another UI opens
-- exports.ot_hud:shiftHud(true, 420)  /  exports.ot_hud:shiftHud(false)
local manualShift, manualOffset = false, nil

local function shiftHud(state, offset)
    manualShift = state and true or false
    manualOffset = offset
end
exports('shiftHud', shiftHud)
RegisterNetEvent('ot_hud:client:shift', shiftHud)

-- automatic: a phone (or any UI) that takes the mouse slides the speedometer / weapon to the left
local function phoneOpen()
    for _, e in ipairs(Config.Shift.exports or {}) do
        local res, fn = e[1], e[2]
        if GetResourceState(res) == 'started' then
            local ok, open = pcall(function() return exports[res][fn]() end)
            if ok and open then return true end
        end
    end
    return false
end

CreateThread(function()
    while not OT.ready do Wait(250) end
    local last = nil
    while true do
        local shift = manualShift
            or (Config.Shift.onNuiFocus and IsNuiFocused())
            or phoneOpen()
        if shift ~= last then
            last = shift
            OT.send('hud:shift', { state = shift, offset = manualOffset or Config.Shift.offset })
        end
        Wait(200)
    end
end)
