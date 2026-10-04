local cfg = Config.Stress
if not cfg.enabled then return end

local function rnd(range) return math.random(range[1], range[2]) end

local function ignored()
    local job = OT.getJob()
    return job ~= nil and cfg.ignoreJobs[job] == true
end

local function gain(amount)
    if ignored() then return end
    TriggerServerEvent('ot_hud:server:gainStress', amount)
end

-- ─────────────────────────── speeding ─────────────────────────────

if cfg.speeding.enabled then
    local SKIP = { [13] = true, [14] = true, [15] = true, [16] = true, [21] = true }
    CreateThread(function()
        while true do
            Wait(cfg.speeding.interval)
            local veh = OT.vehicle
            if veh ~= 0 and not SKIP[OT.vehClass] and GetPedInVehicleSeat(veh, -1) == OT.ped then
                local kmh = GetEntitySpeed(veh) * 3.6
                local limit = (OT.Vehicle.isBelted() and OT.vehClass ~= 8) and cfg.speeding.minSpeedBelted or cfg.speeding.minSpeedUnbelted
                if kmh >= limit then gain(rnd(cfg.speeding.amount)) end
            end
        end
    end)
end

-- ─────────────────────────── shooting ─────────────────────────────

if cfg.shooting.enabled then
    local whitelist = {}
    for _, w in ipairs(cfg.shooting.whitelist) do whitelist[w] = true end
    local cooldown = 0

    AddEventHandler('CEventGunShot', function(_, shooter)
        if shooter ~= PlayerPedId() then return end
        local now = GetGameTimer()
        if now < cooldown then return end
        cooldown = now + 1000
        if whitelist[GetSelectedPedWeapon(shooter)] then return end
        if math.random() <= cfg.shooting.chance then gain(rnd(cfg.shooting.amount)) end
    end)
end

-- ─────────────────────────── relief ───────────────────────────────

if cfg.relief.enabled then
    CreateThread(function()
        while true do
            Wait(cfg.relief.interval)
            if OT.loaded and OT.Player.getStress() > 0 then
                TriggerServerEvent('ot_hud:server:relieveStress', cfg.relief.amount)
            end
        end
    end)
end

-- ─────────────────────────── effects ──────────────────────────────

if cfg.effects.enabled then
    CreateThread(function()
        while true do
            local stress = OT.Player.getStress()
            local wait = 5000
            if stress >= cfg.effects.minStress then
                for _, lvl in ipairs(cfg.effects.levels) do
                    if stress >= lvl[1] and stress < lvl[2] then
                        TriggerScreenblurFadeIn(1000.0)
                        Wait(lvl[3])
                        TriggerScreenblurFadeOut(1000.0)
                        if stress >= 90 and IsPedOnFoot(OT.ped) and not IsPedSwimming(OT.ped) then
                            ShakeGameplayCam('SMALL_EXPLOSION_SHAKE', 0.08)
                        end
                        wait = lvl[4]
                        break
                    end
                end
            end
            Wait(wait)
        end
    end)
end
