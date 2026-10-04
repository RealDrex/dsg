OT = {
    ready = false,          -- NUI handshake done
    shown = false,          -- HUD currently rendered
    visible = true,         -- user toggle (/hud)
    compassVisible = true,  -- user toggle (/compass)
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

RegisterNUICallback('ready', function(_, cb)
    OT.ready = true
    cb({
        ui = Config.UI,
        layout = Config.Layout,
        colors = Config.Colors,
        labels = Config.Labels,
        player = {
            stats = Config.Player.stats,
            lowThreshold = Config.Player.lowThreshold,
            stressDanger = Config.Player.stressDanger,
        },
        weapon = {
            maxSegments = Config.Weapon.maxSegments,
            lowAmmo = Config.Weapon.lowAmmo,
        },
        vehicle = {
            unit = Config.Vehicle.unit,
            redline = Config.Vehicle.redline,
            lowFuel = Config.Vehicle.lowFuel,
            beltWarningSpeed = Config.Vehicle.beltWarningSpeed,
        },
        aircraft = {
            invertRoll = Config.Aircraft.invertRoll,
            pitchScale = Config.Aircraft.pitchScale,
            lowFuel = Config.Aircraft.lowFuel,
        },
        compass = {
            key = Config.Compass.prompt.key,
        },
    })
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
            OT.send('visible', { state = show })
        end

        if show then
            OT.send('update', {
                player = OT.Player.collect(),
                weapon = OT.Weapon.collect(),
                vehicle = OT.Vehicle.collect(),
                aircraft = OT.Aircraft.collect(),
                minimap = OT.minimapVisible,
            })
            Wait(Config.UpdateInterval)
        else
            Wait(500)
        end
    end
end)

-- ─────────────────────────── minimap ──────────────────────────────

CreateThread(function()
    if Config.Minimap.show == 'native' then return end
    while true do
        local mode = Config.Minimap.show
        local want = OT.shown and (mode == 'always' or (mode == 'vehicle' and OT.vehicle ~= 0))
        DisplayRadar(want)
        OT.minimapVisible = want
        Wait(250)
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
        OT.compassVisible = not OT.compassVisible
    end, false)
end

exports('toggleHud', setHudVisible)
exports('isHudVisible', function() return OT.shown end)
