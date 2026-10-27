OT.Vehicle = {}

local cfg = Config.Vehicle
local seatbelt, cruise, cruiseSpeed = false, false, 0.0
local NO_BELT = { [8] = true, [13] = true, [14] = true, [15] = true, [16] = true, [21] = true }

local electric = {}
for _, model in ipairs(cfg.electric or {}) do electric[model] = true end

-- ─────────────────────────── fuel ─────────────────────────────────

local fuelSystem = cfg.fuel
if fuelSystem == 'auto' then
    fuelSystem = 'native'
    for _, res in ipairs({ 'ox_fuel', 'LegacyFuel', 'cdn-fuel', 'ps-fuel', 'lc_fuel' }) do
        if GetResourceState(res) == 'started' then fuelSystem = res break end
    end
end

local function getFuel(veh)
    if fuelSystem == 'ox_fuel' then
        return Entity(veh).state.fuel or GetVehicleFuelLevel(veh)
    elseif fuelSystem ~= 'native' then
        local ok, value = pcall(function() return exports[fuelSystem]:GetFuel(veh) end)
        if ok and value then return value end
    end
    return GetVehicleFuelLevel(veh)
end

-- ─────────────────────────── seatbelt ─────────────────────────────

local function setSeatbelt(state)
    seatbelt = state and true or false
    if Config.Seatbelt.enabled then
        SetPedConfigFlag(PlayerPedId(), 32, not seatbelt) -- 32 = can fly through windscreen
    end
end

local function setCruise(state, veh)
    cruise = state and true or false
    cruiseSpeed = cruise and GetEntitySpeed(veh or OT.vehicle) or 0.0
end

exports('setSeatbelt', setSeatbelt)
exports('getSeatbelt', function() return seatbelt end)
exports('setCruise', function(state) setCruise(state) end)

-- external seatbelt / cruise scripts (qb-smallresources, etc.)
RegisterNetEvent('seatbelt:client:ToggleSeatbelt', function()
    if not Config.Seatbelt.enabled then setSeatbelt(not seatbelt) end
end)
RegisterNetEvent('seatbelt:client:ToggleCruise', function()
    if not Config.Cruise.enabled then cruise = not cruise end
end)

if Config.Seatbelt.enabled then
    RegisterCommand('ot_hud_seatbelt', function()
        local veh = OT.vehicle
        if veh == 0 or NO_BELT[GetVehicleClass(veh)] then return end
        setSeatbelt(not seatbelt)
        PlaySoundFrontend(-1, seatbelt and 'Faster_Click' or 'Back', seatbelt and 'RESPAWN_ONLINE_SOUNDSET' or 'HUD_FRONTEND_DEFAULT_SOUNDSET', true)
    end, false)
    RegisterKeyMapping('ot_hud_seatbelt', Config.Labels.keyMaps.seatbelt, 'keyboard', Config.Seatbelt.key)

    CreateThread(function()
        while true do
            local veh = OT.vehicle
            if veh ~= 0 then
                if not seatbelt then
                    SetFlyThroughWindscreenParams(Config.Seatbelt.ejectSpeed, 1.0, 17.0, 10.0)
                end
                if seatbelt and Config.Seatbelt.blockExit then
                    DisableControlAction(0, 75, true)
                    Wait(0)
                else
                    Wait(250)
                end
            else
                Wait(500)
            end
        end
    end)
end

if Config.Cruise.enabled then
    RegisterCommand('ot_hud_cruise', function()
        local ped, veh = PlayerPedId(), OT.vehicle
        if veh == 0 or GetPedInVehicleSeat(veh, -1) ~= ped or OT.isAircraft then return end
        if cruise then
            setCruise(false)
        elseif GetEntitySpeed(veh) >= Config.Cruise.minSpeed then
            setCruise(true, veh)
        end
    end, false)
    RegisterKeyMapping('ot_hud_cruise', Config.Labels.keyMaps.cruise, 'keyboard', Config.Cruise.key)

    CreateThread(function()
        while true do
            if cruise then
                local ped, veh = PlayerPedId(), OT.vehicle
                if veh == 0 or GetPedInVehicleSeat(veh, -1) ~= ped
                    or IsControlPressed(0, 72) or IsControlPressed(0, 76) then
                    setCruise(false)
                else
                    local speed = GetEntitySpeed(veh)
                    if IsControlPressed(0, 71) then
                        if speed > cruiseSpeed then cruiseSpeed = speed end
                    elseif IsVehicleOnAllWheels(veh) and speed < cruiseSpeed then
                        SetVehicleForwardSpeed(veh, cruiseSpeed)
                    end
                end
                Wait(0)
            else
                Wait(250)
            end
        end
    end)
end

-- reset when leaving the vehicle
CreateThread(function()
    local last = 0
    while true do
        local veh = OT.vehicle
        if veh ~= last then
            if last ~= 0 then
                if seatbelt and Config.Seatbelt.enabled then setSeatbelt(false) end
                cruise, cruiseSpeed = false, 0.0
            end
            last = veh
        end
        Wait(250)
    end
end)

function OT.Vehicle.isBelted()
    return seatbelt
end

-- ─────────────────────────── harness / nitro (qb / qbx scripts) ───

local harness, nitro = { active = false, durability = 0 }, { active = false, level = 0 }

RegisterNetEvent('hud:client:UpdateHarness', function(hp)
    hp = tonumber(hp) or 0
    harness.active, harness.durability = hp > 0, OT.pct(hp)
end)

RegisterNetEvent('hud:client:UpdateNitrous', function(_, level, active)
    nitro.level, nitro.active = OT.pct(level), active and true or false
end)

exports('setHarness', function(active, durability)
    harness.active, harness.durability = active and true or false, OT.pct(durability or 100)
end)
exports('setNitro', function(level, active)
    nitro.level, nitro.active = OT.pct(level), active and true or false
end)

-- ─────────────────────────── collect ──────────────────────────────

local ON_FOOT = { onFoot = true } -- no `speed` key = not in a vehicle for the UI

function OT.Vehicle.collect()
    local veh = OT.vehicle
    if not cfg.enabled or veh == 0 then return ON_FOOT end

    local class = OT.vehClass
    local speedMs = GetEntitySpeed(veh)
    local running = GetIsVehicleEngineRunning(veh)

    local gear
    if speedMs < 0.5 then
        gear = 0
    elseif GetEntitySpeedVector(veh, true).y < -0.5 then
        gear = -1
    else
        gear = GetVehicleCurrentGear(veh)
        if gear == 0 then gear = -1 end
    end

    local _, lightsOn, highBeams = GetVehicleLightsState(veh)
    local lights = 'off'
    if highBeams == 1 then lights = 'high' elseif lightsOn == 1 then lights = 'low' end

    local isElectric = electric[GetEntityModel(veh)] == true or class == 13

    local hasHarness = harness.active or LocalPlayer.state.harness == true

    return {
        speed = math.floor(speedMs * (cfg.unit == 'mph' and 2.236936 or 3.6)),
        RPM = (running and class ~= 13) and OT.pct(GetVehicleCurrentRpm(veh) * 100) or 0,
        gear = gear,
        maxGear = GetVehicleHighGear(veh),
        fuel = { type = isElectric and 'electric' or 'gasoline', level = OT.pct(getFuel(veh)) },
        engine = { active = running, durability = OT.pct(GetVehicleEngineHealth(veh) / 10) },
        body = OT.pct(GetVehicleBodyHealth(veh) / 10),
        seatbelt = seatbelt,
        locked = GetVehicleDoorLockStatus(veh) >= 2,
        lights = lights,
        cruiseControl = cruise,
        harness = { active = hasHarness, durability = hasHarness and math.max(harness.durability, 1) or 0 },
        NOS = { active = nitro.active or nitro.level > 0, level = nitro.level },
        aircraft = OT.Aircraft.collect() or false,
    }
end
