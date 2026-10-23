Utils = {}

function Utils.playAnim(ped, anim)
    if not anim then return end
    lib.requestAnimDict(anim.dict)
    TaskPlayAnim(ped, anim.dict, anim.clip, 3.0, 3.0, anim.duration or -1, anim.flag or 49, 0, false, false, false)
end

function Utils.stopAnim(ped, anim)
    if not anim then return end
    StopAnimTask(ped, anim.dict, anim.clip, 2.0)
end

-- Plays an anim for its duration and waits
function Utils.playAnimWait(anim)
    Utils.playAnim(cache.ped, anim)
    Wait(anim.duration or 1000)
    Utils.stopAnim(cache.ped, anim)
end

function Utils.requestControl(entity, timeout)
    if not entity or not DoesEntityExist(entity) then return false end
    if NetworkHasControlOfEntity(entity) then return true end

    local deadline = GetGameTimer() + (timeout or 2000)
    while not NetworkHasControlOfEntity(entity) and GetGameTimer() < deadline do
        NetworkRequestControlOfEntity(entity)
        Wait(50)
    end

    return NetworkHasControlOfEntity(entity)
end

function Utils.waitForNet(netId, timeout)
    local deadline = GetGameTimer() + (timeout or 5000)
    while not NetworkDoesNetworkIdExist(netId) and GetGameTimer() < deadline do
        Wait(50)
    end
    if not NetworkDoesNetworkIdExist(netId) then return nil end
    return NetworkGetEntityFromNetworkId(netId)
end

function Utils.createLocalProp(model, coords)
    lib.requestModel(model)
    local prop = CreateObject(model, coords.x, coords.y, coords.z, false, false, false)
    SetEntityCollision(prop, false, false)
    SetModelAsNoLongerNeeded(model)
    return prop
end

function Utils.deleteEntity(entity)
    if entity and DoesEntityExist(entity) then
        DeleteEntity(entity)
    end
end

-- Converts a point/direction from entity space to world space
function Utils.toWorld(entity, offset)
    return GetOffsetFromEntityInWorldCoords(entity, offset.x, offset.y, offset.z)
end

function Utils.toWorldDir(entity, dir)
    local origin = GetEntityCoords(entity)
    return Utils.toWorld(entity, dir) - origin
end

function Utils.sparks(coords)
    lib.requestNamedPtfxAsset('core')
    UseParticleFxAsset('core')
    StartParticleFxNonLoopedAtCoord('ent_sht_electrical_box', coords.x, coords.y, coords.z, 0.0, 0.0, 0.0, 0.4, false, false, false)
end

--------------------------------------------------------------------------------
-- Simple [E] prompt (text + distance) for points that have no entity to target
--------------------------------------------------------------------------------

Prompts = {}
local prompts = {}
local shownText

function Prompts.add(id, data)
    prompts[id] = data
end

function Prompts.remove(id)
    prompts[id] = nil
end

local function hideText()
    if shownText then
        lib.hideTextUI()
        shownText = nil
    end
end

CreateThread(function()
    while true do
        local sleep = 400
        local best, bestDist

        if not CamMode.active then
            local pedCoords = GetEntityCoords(cache.ped)
            for _, prompt in pairs(prompts) do
                if not prompt.canShow or prompt.canShow() then
                    local coords = prompt.coords()
                    if coords then
                        local dist = #(pedCoords - coords)
                        if dist < 15.0 then sleep = 0 end
                        if dist <= prompt.distance and (not bestDist or dist < bestDist) then
                            best, bestDist = prompt, dist
                        end
                    end
                end
            end
        end

        if best then
            local text = ('[E] %s'):format(type(best.label) == 'function' and best.label() or best.label)
            if shownText ~= text then
                lib.showTextUI(text, { position = 'left-center' })
                shownText = text
            end
            if IsControlJustReleased(0, 38) and not cache.vehicle then
                hideText()
                best.onSelect()
            end
        else
            hideText()
        end

        Wait(sleep)
    end
end)

--------------------------------------------------------------------------------
-- Camera + mouse cursor for interacting with world objects without NUI
-- Ray math adapted from objectInteractions (MIT - whoisdelta)
--------------------------------------------------------------------------------

CamMode = { active = false }

local DISABLED_CONTROLS <const> = {
    1, 2, 24, 25, 237, 238, 140, 141, 142, 257, 263, 264,
    21, 22, 30, 31, 32, 33, 34, 35, 36, 44, 37, 199, 200, 177, 194, 202,
}

local cam

function CamMode.start(pos, lookAt, fov)
    if cam then CamMode.stop() end

    cam = CreateCamWithParams('DEFAULT_SCRIPTED_CAMERA', pos.x, pos.y, pos.z, 0.0, 0.0, 0.0, fov or 50.0, false, 0)
    PointCamAtCoord(cam, lookAt.x, lookAt.y, lookAt.z)
    SetCamActive(cam, true)
    RenderScriptCams(true, true, 500, true, true)
    CamMode.active = true
    CamMode.cam = cam
end

function CamMode.stop()
    if cam then
        RenderScriptCams(false, true, 500, true, true)
        DestroyCam(cam, false)
    end
    cam = nil
    CamMode.cam = nil
    CamMode.active = false
end

-- Call every frame while the camera is active
function CamMode.frame()
    for i = 1, #DISABLED_CONTROLS do
        DisableControlAction(0, DISABLED_CONTROLS[i], true)
    end
    DisablePlayerFiring(cache.playerId, true)
    SetMouseCursorThisFrame()
end

function CamMode.cursor()
    return GetDisabledControlNormal(0, 239), GetDisabledControlNormal(0, 240)
end

function CamMode.clicked()
    return IsDisabledControlJustPressed(0, 24)
end

function CamMode.released()
    return IsDisabledControlJustReleased(0, 24)
end

function CamMode.exitPressed()
    return IsDisabledControlJustPressed(0, 177) or IsDisabledControlJustPressed(0, 194) or IsDisabledControlJustPressed(0, 200)
end

-- Ray from the camera through the cursor
function CamMode.ray(screenX, screenY)
    local camPos = GetCamCoord(cam)
    local camRot = GetCamRot(cam, 2)
    local fov = GetCamFov(cam)
    local aspect = GetScreenAspectRatio(false)
    local pitch, yaw = math.rad(camRot.x), math.rad(camRot.z)
    local tFov = math.tan(math.rad(fov * 0.5))
    local ndcX = (screenX - 0.5) * 2.0 * aspect
    local ndcY = -(screenY - 0.5) * 2.0

    local fwd = vec3(-math.sin(yaw) * math.abs(math.cos(pitch)), math.cos(yaw) * math.abs(math.cos(pitch)), math.sin(pitch))
    local right = vec3(math.cos(yaw), math.sin(yaw), 0.0)
    local up = vec3(right.y * fwd.z, -right.x * fwd.z, right.x * fwd.y - right.y * fwd.x)

    local dir = fwd + right * (ndcX * tFov) + up * (ndcY * tFov)
    return camPos, dir / #dir
end

-- Ray / plane intersection
function Utils.rayPlane(origin, dir, planePoint, normal)
    local denom = dir.x * normal.x + dir.y * normal.y + dir.z * normal.z
    if math.abs(denom) < 1e-5 then return nil end
    local d = planePoint - origin
    local t = (d.x * normal.x + d.y * normal.y + d.z * normal.z) / denom
    if t < 0 then return nil end
    return origin + dir * t
end

-- Screen-space distance between the cursor and a world point
function Utils.screenDistance(cursorX, cursorY, coords)
    local onScreen, sx, sy = GetScreenCoordFromWorldCoord(coords.x, coords.y, coords.z)
    if not onScreen then return math.huge end
    return math.sqrt((sx - cursorX) ^ 2 + (sy - cursorY) ^ 2)
end
