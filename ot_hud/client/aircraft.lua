OT.Aircraft = {}

local cfg = Config.Aircraft
local hasThrottleNative = GetVehicleThrottleOffset ~= nil

-- returned inside vehicleData.aircraft (nil when not in a heli / plane)
function OT.Aircraft.collect()
    if not cfg.enabled or not OT.isAircraft then return nil end
    local veh = OT.vehicle

    local alt = cfg.altitude == 'agl' and GetEntityHeightAboveGround(veh) or GetEntityCoords(veh).z

    local throttle = 0.0
    if GetIsVehicleEngineRunning(veh) then
        throttle = hasThrottleNative and math.abs(GetVehicleThrottleOffset(veh)) or GetVehicleCurrentRpm(veh)
    end

    local gearDown = nil -- nil = no landing gear (helis): the badge is hidden
    if OT.vehClass == 16 then
        local state = GetLandingGearState(veh) -- 0 deployed, 1 closing, 2 opening, 3 retracted
        gearDown = state ~= 3
    end

    return {
        airspeed = math.floor(GetEntitySpeed(veh) * 1.943844),   -- knots
        altitude = math.floor(alt * 3.28084),                     -- feet
        verticalSpeed = math.floor(GetEntityVelocity(veh).z * 196.8504), -- feet / min
        pitch = GetEntityPitch(veh),
        roll = GetEntityRoll(veh),
        throttle = OT.pct(throttle * 100),
        gearDown = gearDown,
    }
end
