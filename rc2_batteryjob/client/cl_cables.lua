--[[
    Cables and battery
    - everything here is local per client (not networked) and synced through state bags:
        Player(id).state.batteryCables = { van = netId, target = netId, red = 'hand'|'terminal', black = ... }
        Entity(veh).state.batteryTarget  = stalled vehicle (gets a battery prop under the hood)
    - a cable is a real rope from the van port to the clamp
]]

Cables = { override = false }
Battery = { keep = {} } -- keep: vehicles whose battery prop must not be cleaned up (edit tool)

local cfg = Config.Cables
local renders = {}   -- [serverId] = { red = prop, black = prop, ropes = {}, state = {} }
local batteries = {} -- [vehicle] = prop

--------------------------------------------------------------------------------
-- Battery under the hood
--------------------------------------------------------------------------------

local function batteryLocalOffset(vehicle)
    local custom = Config.Battery.perModel[GetEntityModel(vehicle)]
    if custom then return custom end

    local bone = GetEntityBoneIndexByName(vehicle, 'engine')
    if bone ~= -1 then
        local world = GetWorldPositionOfEntityBone(vehicle, bone)
        local base = GetOffsetFromEntityGivenWorldCoords(vehicle, world.x, world.y, world.z)
        return base + Config.Battery.defaultOffset
    end

    local _, max = GetModelDimensions(GetEntityModel(vehicle))
    return vec3(0.35, max.y - 0.6, 0.3)
end

function Battery.offset(vehicle)
    return batteryLocalOffset(vehicle)
end

function Battery.get(vehicle)
    local prop = batteries[vehicle]
    if prop and DoesEntityExist(prop) then return prop end

    local offset = batteryLocalOffset(vehicle)
    prop = Utils.createLocalProp(Config.Battery.model, Utils.toWorld(vehicle, offset))
    AttachEntityToEntity(prop, vehicle, 0, offset.x, offset.y, offset.z, 0.0, 0.0, 0.0, false, false, false, false, 2, true)
    batteries[vehicle] = prop
    return prop
end

-- Rebuilds the battery prop (after moving it with the edit tool)
function Battery.refresh(vehicle)
    Utils.deleteEntity(batteries[vehicle])
    batteries[vehicle] = nil
    return Battery.get(vehicle)
end

function Battery.terminal(vehicle, color)
    local prop = Battery.get(vehicle)
    local t = Config.Battery.terminals[color]
    return GetOffsetFromEntityInWorldCoords(prop, t.x, t.y, t.z), prop, t
end

CreateThread(function()
    while true do
        local pedCoords = GetEntityCoords(cache.ped)
        local seen = {}

        for _, vehicle in ipairs(GetGamePool('CVehicle')) do
            if Entity(vehicle).state.batteryTarget and #(pedCoords - GetEntityCoords(vehicle)) < 60.0 then
                Battery.get(vehicle)
                seen[vehicle] = true
            end
        end

        for vehicle, prop in pairs(batteries) do
            if (not seen[vehicle] and not Battery.keep[vehicle]) or not DoesEntityExist(vehicle) then
                Utils.deleteEntity(prop)
                batteries[vehicle] = nil
            end
        end

        Wait(1000)
    end
end)

--------------------------------------------------------------------------------
-- Cable rendering for every player
--------------------------------------------------------------------------------

local function loadRopeTextures()
    if RopeAreTexturesLoaded() then return end
    RopeLoadTextures()
    local deadline = GetGameTimer() + 3000
    while not RopeAreTexturesLoaded() and GetGameTimer() < deadline do Wait(0) end
end

local function attachToHand(prop, ped, color)
    local h = cfg.hands[color]
    AttachEntityToEntity(prop, ped, GetPedBoneIndex(ped, h.bone),
        h.offset.x, h.offset.y, h.offset.z, h.rot.x, h.rot.y, h.rot.z,
        true, true, false, true, 1, true)
end

function Cables.attachToTerminal(prop, vehicle, color)
    local _, battery, t = Battery.terminal(vehicle, color)
    DetachEntity(prop, false, false)
    AttachEntityToEntity(prop, battery, 0, t.x, t.y, t.z + 0.02, 0.0, 90.0, 0.0, false, false, false, false, 2, true)
end

local function placeClamp(render, color, ped)
    local prop = render[color]
    local where = render.state[color]
    local target = render.state.target and NetworkDoesNetworkIdExist(render.state.target)
        and NetworkGetEntityFromNetworkId(render.state.target)

    if where == 'terminal' and target and DoesEntityExist(target) then
        Cables.attachToTerminal(prop, target, color)
    else
        DetachEntity(prop, false, false)
        attachToHand(prop, ped, color)
    end
end

local function createRope(van, color, prop)
    loadRopeTextures()
    local port = Screen.portCoords(van, color)
    local clamp = GetEntityCoords(prop)
    local rope = AddRope(port.x, port.y, port.z, 0.0, 0.0, 0.0, cfg.ropeLength, cfg.ropeType,
        cfg.ropeLength, 0.0, 1.0, false, false, false, 1.0, true)
    AttachEntitiesToRope(rope, van, prop, port.x, port.y, port.z, clamp.x, clamp.y, clamp.z,
        cfg.ropeLength, false, false, nil, nil)
    ActivatePhysics(prop)
    return rope
end

local function destroyRender(serverId)
    local render = renders[serverId]
    if not render then return end

    for _, rope in pairs(render.ropes) do
        if DoesRopeExist(rope) then DeleteRope(rope) end
    end
    Utils.deleteEntity(render.red)
    Utils.deleteEntity(render.black)
    renders[serverId] = nil
end

local function sameState(a, b)
    return a.red == b.red and a.black == b.black and a.target == b.target and a.van == b.van
end

local function updateRender(serverId, ped, state)
    local van = NetworkDoesNetworkIdExist(state.van) and NetworkGetEntityFromNetworkId(state.van)
    if not van or not DoesEntityExist(van) then
        destroyRender(serverId)
        return
    end

    local render = renders[serverId]
    if render and render.van ~= van then
        destroyRender(serverId)
        render = nil
    end

    if not render then
        local coords = GetEntityCoords(ped)
        render = {
            van = van,
            state = state,
            red = Utils.createLocalProp(cfg.clampModel, coords),
            black = Utils.createLocalProp(cfg.clampModel, coords),
            ropes = {},
        }
        renders[serverId] = render
        placeClamp(render, 'red', ped)
        placeClamp(render, 'black', ped)
        render.ropes.red = createRope(van, 'red', render.red)
        render.ropes.black = createRope(van, 'black', render.black)
        return
    end

    -- Local player is placing clamps with the mouse: leave them alone
    if serverId == cache.serverId and Cables.override then return end

    if not sameState(render.state, state) then
        render.state = state
        placeClamp(render, 'red', ped)
        placeClamp(render, 'black', ped)
    end
end

CreateThread(function()
    while true do
        local myCoords = GetEntityCoords(cache.ped)
        local active = {}

        for _, playerId in ipairs(GetActivePlayers()) do
            local serverId = GetPlayerServerId(playerId)
            local state = Player(serverId).state.batteryCables
            local ped = GetPlayerPed(playerId)

            if state and ped ~= 0 and #(myCoords - GetEntityCoords(ped)) < 80.0 then
                active[serverId] = true
                updateRender(serverId, ped, state)
            end
        end

        for serverId in pairs(renders) do
            if not active[serverId] then destroyRender(serverId) end
        end

        Wait(250)
    end
end)

--------------------------------------------------------------------------------
-- Local player state
--------------------------------------------------------------------------------

function Cables.state()
    return LocalPlayer.state.batteryCables
end

function Cables.set(changes)
    local state = Cables.state() or {}
    for k, v in pairs(changes) do state[k] = v end
    LocalPlayer.state:set('batteryCables', state, true)
end

function Cables.clear()
    LocalPlayer.state:set('batteryCables', nil, true)
end

function Cables.holding()
    local state = Cables.state()
    return state and (state.red == 'hand' or state.black == 'hand')
end

function Cables.localClamps()
    local render = renders[cache.serverId]
    return render and render.red, render and render.black
end

-- Holding cables: keep the anim, block entering vehicles, return them if too far
CreateThread(function()
    while true do
        local state = Cables.state()
        if state and not Cables.override then
            if Cables.holding() then
                local anim = Config.Anims.holdCables
                if not IsEntityPlayingAnim(cache.ped, anim.dict, anim.clip, 3) and not CamMode.active then
                    Utils.playAnim(cache.ped, anim)
                end
            end

            local van = NetworkDoesNetworkIdExist(state.van) and NetworkGetEntityFromNetworkId(state.van)
            if van and DoesEntityExist(van) then
                local pedCoords = GetEntityCoords(cache.ped)
                if Cables.holding() and #(pedCoords - Screen.portCoords(van, 'red')) > cfg.maxReach then
                    Job.cablesYanked()
                end
            else
                Cables.clear()
            end

            for _ = 1, 25 do
                DisableControlAction(0, 23, true) -- enter vehicle
                DisableControlAction(0, 24, true) -- attack
                DisableControlAction(0, 25, true)
                DisableControlAction(0, 22, true) -- jump
                Wait(0)
            end
        else
            Wait(500)
        end
    end
end)

--------------------------------------------------------------------------------
-- Connecting / removing clamps with the mouse in the engine bay
--------------------------------------------------------------------------------

local function bayCamera(vehicle)
    local battery = GetEntityCoords(Battery.get(vehicle))
    local fwd = Utils.toWorldDir(vehicle, vec3(0.0, 1.0, 0.0))
    local camPos = battery + fwd * 0.65 + vec3(0.0, 0.0, 0.7)
    return camPos, battery
end

local function stagingCoords(vehicle, color)
    local battery = GetEntityCoords(Battery.get(vehicle))
    local right = Utils.toWorldDir(vehicle, vec3(1.0, 0.0, 0.0))
    local side = color == 'red' and 1 or -1
    return battery + right * (0.22 * side) + vec3(0.0, 0.0, 0.16)
end

local function drawTerminalMarkers(vehicle)
    local red = Battery.terminal(vehicle, 'red')
    local black = Battery.terminal(vehicle, 'black')
    DrawMarker(28, red.x, red.y, red.z, 0, 0, 0, 0, 0, 0, 0.018, 0.018, 0.018, 220, 40, 40, 160, false, false, 2, false, nil, nil, false)
    DrawMarker(28, black.x, black.y, black.z, 0, 0, 0, 0, 0, 0, 0.018, 0.018, 0.018, 30, 30, 30, 200, false, false, 2, false, nil, nil, false)
end

local function hoveredClamp(cursorX, cursorY, clamps)
    local best, bestDist
    for color, prop in pairs(clamps) do
        local dist = Utils.screenDistance(cursorX, cursorY, GetEntityCoords(prop))
        if dist < 0.04 and (not bestDist or dist < bestDist) then
            best, bestDist = color, dist
        end
    end
    return best
end

local function beginBay(vehicle)
    local camPos, lookAt = bayCamera(vehicle)
    local pedCoords = GetEntityCoords(cache.ped)
    TaskTurnPedToFaceCoord(cache.ped, lookAt.x, lookAt.y, lookAt.z, 800)
    Wait(800)
    Utils.playAnim(cache.ped, Config.Anims.hood)
    CamMode.start(camPos, lookAt, 50.0)
    Cables.override = true
    return pedCoords
end

local function endBay()
    lib.hideTextUI()
    CamMode.stop()
    Utils.stopAnim(cache.ped, Config.Anims.hood)
    Cables.override = false
end

--- Places the clamps on the terminals. Returns true when both are connected
---@param onConnect fun(color: string): boolean  validated by the server
function Cables.connect(vehicle, onConnect)
    local red, black = Cables.localClamps()
    if not red or not black then return false end

    local state = Cables.state()
    local clamps = {}
    if state.red ~= 'terminal' then clamps.red = red end
    if state.black ~= 'terminal' then clamps.black = black end

    beginBay(vehicle)
    for color, prop in pairs(clamps) do
        DetachEntity(prop, false, false)
        local pos = stagingCoords(vehicle, color)
        SetEntityCoordsNoOffset(prop, pos.x, pos.y, pos.z, false, false, false)
        SetEntityRotation(prop, 0.0, 90.0, 0.0, 2, true)
        FreezeEntityPosition(prop, true)
    end

    lib.showTextUI(locale('bay_controls'), { position = 'left-center' })

    local dragging, depth

    while next(clamps) do
        CamMode.frame()
        drawTerminalMarkers(vehicle)

        local cx, cy = CamMode.cursor()
        local hovered = dragging or hoveredClamp(cx, cy, clamps)

        for color, prop in pairs(clamps) do
            SetEntityDrawOutline(prop, color == hovered)
        end
        if hovered == 'red' then
            SetEntityDrawOutlineColor(255, 80, 80, 255)
        elseif hovered == 'black' then
            SetEntityDrawOutlineColor(120, 200, 255, 255)
        end

        if not dragging and hovered and CamMode.clicked() then
            dragging = hovered
            depth = #(GetEntityCoords(clamps[dragging]) - GetCamCoord(CamMode.cam))
        end

        if dragging then
            local origin, dir = CamMode.ray(cx, cy)
            local pos = origin + dir * depth
            SetEntityCoordsNoOffset(clamps[dragging], pos.x, pos.y, pos.z, false, false, false)

            if CamMode.released() then
                local prop = clamps[dragging]
                local clampPos = GetEntityCoords(prop)
                local own = Battery.terminal(vehicle, dragging)
                local otherColor = dragging == 'red' and 'black' or 'red'
                local other = Battery.terminal(vehicle, otherColor)

                if #(clampPos - other) < cfg.snapDistance then
                    -- wrong terminal
                    Utils.sparks(other)
                    lib.notify({ description = locale('wrong_terminal'), type = 'error' })
                    local back = stagingCoords(vehicle, dragging)
                    SetEntityCoordsNoOffset(prop, back.x, back.y, back.z, false, false, false)
                elseif #(clampPos - own) < cfg.snapDistance then
                    if dragging == 'black' and clamps.red then
                        Utils.sparks(own)
                        lib.notify({ description = locale('positive_first'), type = 'error' })
                        local back = stagingCoords(vehicle, dragging)
                        SetEntityCoordsNoOffset(prop, back.x, back.y, back.z, false, false, false)
                    elseif onConnect(dragging) then
                        SetEntityDrawOutline(prop, false)
                        FreezeEntityPosition(prop, false)
                        Cables.attachToTerminal(prop, vehicle, dragging)
                        Cables.set({ [dragging] = 'terminal' })
                        PlaySoundFrontend(-1, 'CONFIRM_BEEP', 'HUD_MINI_GAME_SOUNDSET', true)
                        clamps[dragging] = nil
                    end
                end

                dragging = nil
            end
        end

        if CamMode.exitPressed() then break end
        Wait(0)
    end

    -- Anything not connected goes back to the hands
    local ped = cache.ped
    for color, prop in pairs(clamps) do
        SetEntityDrawOutline(prop, false)
        FreezeEntityPosition(prop, false)
        attachToHand(prop, ped, color)
    end

    endBay()
    return next(clamps) == nil
end

--- Removes the clamps (negative first). Returns true when both are removed
function Cables.disconnect(vehicle)
    local red, black = Cables.localClamps()
    if not red or not black then return false end

    local attached = { red = red, black = black }
    beginBay(vehicle)
    lib.showTextUI(locale('bay_disconnect_controls'), { position = 'left-center' })

    while next(attached) do
        CamMode.frame()
        local cx, cy = CamMode.cursor()
        local hovered = hoveredClamp(cx, cy, attached)

        for color, prop in pairs(attached) do
            SetEntityDrawOutline(prop, color == hovered)
        end

        if hovered and CamMode.clicked() then
            if hovered == 'red' and attached.black then
                lib.notify({ description = locale('negative_first'), type = 'error' })
            else
                local prop = attached[hovered]
                SetEntityDrawOutline(prop, false)
                attachToHand(prop, cache.ped, hovered)
                Cables.set({ [hovered] = 'hand' })
                PlaySoundFrontend(-1, 'CONFIRM_BEEP', 'HUD_MINI_GAME_SOUNDSET', true)
                attached[hovered] = nil
            end
        end

        if CamMode.exitPressed() then break end
        Wait(0)
    end

    for _, prop in pairs(attached) do SetEntityDrawOutline(prop, false) end
    endBay()
    return next(attached) == nil
end

AddEventHandler('onResourceStop', function(resource)
    if resource ~= cache.resource then return end
    for serverId in pairs(renders) do destroyRender(serverId) end
    for _, prop in pairs(batteries) do Utils.deleteEntity(prop) end
    if LocalPlayer.state.batteryCables then Cables.clear() end
end)
