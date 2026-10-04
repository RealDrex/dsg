OT.Aircraft = {}

local cfg = Config.Aircraft
local hasThrottleNative = GetVehicleThrottleOffset ~= nil

local function gearState(veh)
    local s = GetLandingGearState(veh) -- 0 deployed, 1 closing, 2 opening, 3 retracted
    if s == 0 then return 'down' end
    if s == 3 then return 'up' end
    return 'moving'
end

function OT.Aircraft.collect()
    if not cfg.enabled or not OT.isAircraft then return nil end
    local veh = OT.vehicle
    local isHeli = OT.vehClass == 15

    local pos = GetEntityCoords(veh)
    local vel = GetEntityVelocity(veh)
    local alt = cfg.altitude == 'agl' and GetEntityHeightAboveGround(veh) or pos.z

    local throttle = 0.0
    if GetIsVehicleEngineRunning(veh) then
        if hasThrottleNative then
            throttle = math.abs(GetVehicleThrottleOffset(veh))
        else
            throttle = GetVehicleCurrentRpm(veh)
        end
    end

    local data = {
        heli = isHeli,
        speed = math.floor(GetEntitySpeed(veh) * 1.943844),          -- knots
        alt = math.floor(alt * 3.28084),                              -- feet
        vs = math.floor(vel.z * 196.8504),                            -- feet / min
        roll = GetEntityRoll(veh),
        pitch = GetEntityPitch(veh),
        throttle = OT.pct(throttle * 100),
        fuel = OT.pct(GetVehicleFuelLevel(veh)),
        engine = OT.pct(GetVehicleEngineHealth(veh) / 10),
    }

    if isHeli then
        data.rotor = OT.pct(GetHeliMainRotorHealth(veh) / 10)
    else
        data.gear = gearState(veh)
    end

    return data
end
