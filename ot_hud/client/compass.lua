OT.Compass = {}

local cfg = Config.Compass
local promptCfg = cfg.prompt
local points = {}       -- static + exported points: id -> { label, sprite, color, coords }
local blipPoints = {}   -- map blips found by sprite
local aimed = nil       -- blip the player is looking at (prompt shown)
local pending = { id = nil, since = 0 }

local WAYPOINT_SPRITE = 8

for i, p in ipairs(cfg.points or {}) do
    points['cfg_' .. i] = { label = p.label, sprite = p.sprite or 1, color = p.color, coords = p.coords }
end

-- exports.ot_hud:addCompassPoint(id, { label = 'Shop', sprite = 52, color = '#ffffff', coords = vec3(...) })
local function addPoint(id, data)
    if not id or not data or not data.coords then return end
    points[id] = { label = data.label or tostring(id), sprite = data.sprite or 1, color = data.color, coords = data.coords }
end

local function removePoint(id)
    points[id] = nil
end

exports('addCompassPoint', addPoint)
exports('removeCompassPoint', removePoint)

-- ─────────────────────────── helpers ──────────────────────────────

local function norm(d)
    return (d + 540.0) % 360.0 - 180.0
end

-- compass heading: 0 = N, 90 = E (clockwise). GTA headings are counter-clockwise.
local function getHeading(ped)
    if cfg.base == 'camera' then
        return (360.0 - GetGameplayCamRot(0).z) % 360.0
    end
    return (360.0 - GetEntityHeading(ped)) % 360.0
end

local function bearing(dx, dy)
    return math.deg(math.atan(dx, dy)) % 360.0
end

local function getStreet(pos)
    local s1, s2 = GetStreetNameAtCoord(pos.x, pos.y, pos.z)
    local street = GetStreetNameFromHashKey(s1)
    local cross = s2 ~= 0 and GetStreetNameFromHashKey(s2) or ''
    if cross ~= '' then street = street .. ' & ' .. cross end
    return street, GetLabelText(GetNameOfZone(pos.x, pos.y, pos.z))
end

-- real in-game color of a blip ('#rrggbb'), nil for white blips (keep original image colors)
local function blipColor(blip)
    if not cfg.mapBlips.useBlipColor or GetBlipColour(blip) == 0 then return nil end
    local r, g, b = GetHudColour(GetBlipHudColour(blip))
    return ('#%02x%02x%02x'):format(r, g, b)
end

local function isEnabled()
    if not OT.compassVisible or cfg.show == 'never' then return false end
    if cfg.show == 'vehicle' and OT.vehicle == 0 then return false end
    if cfg.hideInAircraft and OT.isAircraft then return false end
    return true
end

-- ─────────────────────────── map blips scan ───────────────────────

CreateThread(function()
    if not cfg.mapBlips or not cfg.mapBlips.enabled then return end
    while true do
        local found = {}
        for sprite, label in pairs(cfg.mapBlips.sprites) do
            local blip = GetFirstBlipInfoId(sprite)
            local n = 0
            while DoesBlipExist(blip) do
                n = n + 1
                found[('blip_%d_%d'):format(sprite, n)] = {
                    label = label, sprite = sprite, color = blipColor(blip), coords = GetBlipInfoIdCoord(blip),
                }
                blip = GetNextBlipInfoId(sprite)
            end
        end
        blipPoints = found
        Wait(cfg.mapBlips.scanInterval or 5000)
    end
end)

-- ─────────────────────────── waypoint key ─────────────────────────

RegisterCommand('ot_hud_setwaypoint', function()
    if not aimed or not OT.shown then return end
    if aimed.active then
        SetWaypointOff()
    else
        SetNewWaypoint(aimed.coords.x, aimed.coords.y)
    end
end, false)

if promptCfg.enabled then
    RegisterKeyMapping('ot_hud_setwaypoint', Config.Labels.keyMaps.waypoint, 'keyboard', promptCfg.key)
end

-- Pick the blip the compass is pointed at. It must be close (prompt.maxDistance),
-- inside prompt.angle and stay aimed for prompt.aimTime ms. Once shown it gets a
-- little extra angle so it doesn't flicker while the camera moves slightly.
local function updateAim(list, heading, now)
    if not promptCfg.enabled or (promptCfg.onFootOnly and OT.vehicle ~= 0) then
        aimed, pending.id = nil, nil
        return
    end

    local best, bestAngle, current = nil, nil, nil
    for _, p in ipairs(list) do
        if p.id ~= '__waypoint' and p.dist <= promptCfg.maxDistance then
            local a = math.abs(norm(p.bearing - heading))
            if aimed and p.id == aimed.id and a <= promptCfg.angle * 1.6 then current = p end
            if a <= promptCfg.angle and (not bestAngle or a < bestAngle) then
                best, bestAngle = p, a
            end
        end
    end

    if current then
        aimed = current
        return
    end

    aimed = nil
    if not best then
        pending.id = nil
    elseif pending.id ~= best.id then
        pending.id, pending.since = best.id, now
    elseif now - pending.since >= promptCfg.aimTime then
        aimed = best
    end
end

-- ─────────────────────────── main loop ────────────────────────────

CreateThread(function()
    while not OT.ready do Wait(250) end

    local street, zone, lastStreet, wasEnabled = '', '', 0, nil

    while true do
        local enabled = OT.shown and isEnabled()
        if enabled ~= wasEnabled then
            wasEnabled = enabled
            if not enabled then
                aimed, pending.id = nil, nil
                OT.send('compass', { hidden = true })
            end
        end

        if enabled then
            local ped = OT.ped
            local pos = GetEntityCoords(ped)
            local heading = getHeading(ped)
            local now = GetGameTimer()

            if now - lastStreet > 500 then
                lastStreet = now
                street, zone = getStreet(pos)
            end

            -- current GPS waypoint (set by us or from the map)
            local wp = nil
            if IsWaypointActive() then
                local b = GetFirstBlipInfoId(WAYPOINT_SPRITE)
                if DoesBlipExist(b) then wp = GetBlipInfoIdCoord(b) end
            end

            local list, wpPoint = {}, nil
            local function consider(id, p)
                local dx, dy = p.coords.x - pos.x, p.coords.y - pos.y
                local dist = math.sqrt(dx * dx + dy * dy)
                local active = wp ~= nil and math.abs(p.coords.x - wp.x) < 3.0 and math.abs(p.coords.y - wp.y) < 3.0
                if active or dist <= cfg.maxDistance then
                    local item = {
                        id = id, label = p.label, sprite = p.sprite, color = p.color, coords = p.coords,
                        bearing = bearing(dx, dy), dist = math.floor(dist + 0.5), active = active,
                    }
                    list[#list + 1] = item
                    if active and not wpPoint then wpPoint = item end
                end
            end

            for id, p in pairs(points) do consider(id, p) end
            for id, p in pairs(blipPoints) do consider(id, p) end

            if wp and not wpPoint then
                consider('__waypoint', { label = Config.Labels.waypoint, sprite = WAYPOINT_SPRITE, coords = wp })
                wpPoint = list[#list]
            end

            table.sort(list, function(a, b)
                if a.active ~= b.active then return a.active end
                return a.dist < b.dist
            end)

            updateAim(list, heading, now)

            local out = {}
            for i = 1, math.min(#list, cfg.maxPoints) do
                local p = list[i]
                out[i] = {
                    id = p.id, sprite = p.sprite, color = p.color, bearing = p.bearing, active = p.active,
                    aimed = aimed ~= nil and aimed.id == p.id,
                }
            end

            OT.send('compass', {
                heading = heading,
                street = street,
                zone = cfg.showZone and zone or nil,
                points = out,
                waypoint = wpPoint and { label = wpPoint.label, dist = wpPoint.dist } or nil,
                prompt = aimed and {
                    label = aimed.label, dist = aimed.dist, sprite = aimed.sprite, color = aimed.color, active = aimed.active,
                } or nil,
            })
        end

        Wait(enabled and cfg.updateInterval or 500)
    end
end)
