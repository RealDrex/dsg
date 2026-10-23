Job = { data = nil, running = false }

local STEPS <const> = { 'assigned', 'talked', 'hood', 'red', 'black', 'running', 'started', 'disconnected', 'stored' }
local STEP_INDEX = {}
for i, step in ipairs(STEPS) do STEP_INDEX[step] = i end

local depotPed, depotBlip
local areaBlip, targetBlip
local target = { vehicle = nil, ped = nil, callId = nil }

local function call() return Job.data and Job.data.call end

local function myVan()
    local netId = Job.data and Job.data.van
    if not netId or not NetworkDoesNetworkIdExist(netId) then return nil end
    local vehicle = NetworkGetEntityFromNetworkId(netId)
    return DoesEntityExist(vehicle) and vehicle or nil
end

local function removeBlip(blip)
    if blip and DoesBlipExist(blip) then RemoveBlip(blip) end
end

--- يطلب من السيرفر ينقل البلاغ للخطوة الجاية
function Job.step(step)
    local c = call()
    if not c then return false end
    if STEP_INDEX[c.step] >= STEP_INDEX[step] and step ~= 'started' then return true end

    local ok, result = lib.callback.await('rc2_batteryjob:server:step', false, c.id, step)
    if ok and c == call() then
        if step == 'started' and result and not result.success then
            c.step = 'black'
        else
            c.step = step
        end
    end
    return ok, result
end

--------------------------------------------------------------------------------
-- المقر
--------------------------------------------------------------------------------

local function startShift()
    local ok, err = lib.callback.await('rc2_batteryjob:server:startShift', false)
    if not ok then
        lib.notify({ description = locale('error_' .. tostring(err)), type = 'error' })
        return
    end
    lib.notify({ description = locale('shift_started'), type = 'success' })
end

local function endShift()
    if Cables.state() then
        lib.notify({ description = locale('store_cables_first'), type = 'error' })
        return
    end
    local ok, err = lib.callback.await('rc2_batteryjob:server:endShift', false)
    if not ok then
        lib.notify({ description = locale('error_' .. tostring(err)), type = 'error' })
    end
end

local function setupDepot()
    local d = Config.Depot
    lib.requestModel(d.ped.model)
    depotPed = CreatePed(4, d.ped.model, d.ped.coords.x, d.ped.coords.y, d.ped.coords.z - 1.0, d.ped.coords.w, false, true)
    SetEntityInvincible(depotPed, true)
    FreezeEntityPosition(depotPed, true)
    SetBlockingOfNonTemporaryEvents(depotPed, true)
    TaskStartScenarioInPlace(depotPed, d.ped.scenario, 0, true)
    SetModelAsNoLongerNeeded(d.ped.model)

    exports.ox_target:addLocalEntity(depotPed, {
        {
            name = 'battery_start',
            label = locale('start_shift'),
            icon = 'fa-solid fa-car-battery',
            canInteract = function() return not LocalPlayer.state.batteryShift end,
            onSelect = function() CreateThread(startShift) end,
        },
        {
            name = 'battery_end',
            label = locale('end_shift'),
            icon = 'fa-solid fa-flag-checkered',
            canInteract = function() return LocalPlayer.state.batteryShift end,
            onSelect = function() CreateThread(endShift) end,
        },
    })

    depotBlip = AddBlipForCoord(d.ped.coords.x, d.ped.coords.y, d.ped.coords.z)
    SetBlipSprite(depotBlip, d.blip.sprite)
    SetBlipColour(depotBlip, d.blip.color)
    SetBlipScale(depotBlip, d.blip.scale)
    SetBlipAsShortRange(depotBlip, true)
    BeginTextCommandSetBlipName('STRING')
    AddTextComponentSubstringPlayerName(d.blip.label)
    EndTextCommandSetBlipName(depotBlip)
end

--------------------------------------------------------------------------------
-- السيارة المعطلة + صاحبها
--------------------------------------------------------------------------------

local function findRoadsideSpot(center)
    local found, node, heading = GetClosestVehicleNodeWithHeading(center.x, center.y, center.z, 1, 3.0, 0)
    if not found then return nil end

    local hasEdge, edge = GetRoadBoundaryUsingHeading(node.x, node.y, node.z, heading)
    local spot = node
    if hasEdge then
        local dir = node - edge
        local len = #dir
        if len > 0.1 then spot = edge + dir / len * 1.3 end
    end

    return spot, heading
end

local function talkToCustomer()
    local c = call()
    if not c or c.step ~= 'assigned' or not target.ped then return end

    if Utils.requestControl(target.ped) then ClearPedTasks(target.ped) end
    Dialog.conversation(target.ped, c.customer, {
        {
            text = locale('customer_line_1'),
            speech = 'GENERIC_CURSE_MED',
            options = {
                { label = locale('player_what_happened'), next = 2 },
                { label = locale('player_relax'), next = 3 },
            },
        },
        {
            text = locale('customer_line_2'),
            options = { { label = locale('player_battery'), next = 3 } },
        },
        {
            text = locale('customer_line_3'),
            options = { { label = locale('player_ok') } },
        },
    })
    TaskStartScenarioInPlace(target.ped, Config.Anims.customerIdle, 0, true)

    if Job.step('talked') then
        lib.notify({ description = locale('open_hood_hint'), type = 'inform' })
    end
end

local function setupTarget(c)
    if target.callId == c.id then return end

    local vehicle = Utils.waitForNet(c.vehicleNet)
    local ped = Utils.waitForNet(c.pedNet)
    if not vehicle or not ped then return end

    target = { vehicle = vehicle, ped = ped, callId = c.id }

    if Utils.requestControl(vehicle) then
        SetVehicleEngineOn(vehicle, false, true, true)
        SetVehicleUndriveable(vehicle, true)
        SetVehicleDoorsLocked(vehicle, 2)
        SetVehicleIndicatorLights(vehicle, 0, true)
        SetVehicleIndicatorLights(vehicle, 1, true)
        SetVehicleHasBeenOwnedByPlayer(vehicle, false)
    end

    if Utils.requestControl(ped) then
        SetBlockingOfNonTemporaryEvents(ped, true)
        SetPedFleeAttributes(ped, 0, false)
        SetPedCanRagdoll(ped, false)
        SetEntityInvincible(ped, true)
        TaskStartScenarioInPlace(ped, Config.Anims.customerIdle, 0, true)
    end

    exports.ox_target:addLocalEntity(ped, {
        {
            name = 'battery_talk',
            label = locale('talk_customer'),
            icon = 'fa-solid fa-comments',
            canInteract = function() return call() and call().step == 'assigned' end,
            onSelect = function() CreateThread(talkToCustomer) end,
        },
    })

    removeBlip(areaBlip)
    targetBlip = AddBlipForEntity(vehicle)
    SetBlipSprite(targetBlip, 380)
    SetBlipColour(targetBlip, 47)
    SetBlipRoute(targetBlip, true)
    SetBlipRouteColour(targetBlip, 47)

    if Cables.state() then Cables.set({ target = c.vehicleNet }) end
end

local function clearTarget(leave)
    local vehicle, ped = target.vehicle, target.ped
    target = { vehicle = nil, ped = nil, callId = nil }
    removeBlip(targetBlip)
    removeBlip(areaBlip)
    targetBlip, areaBlip = nil, nil

    if ped and DoesEntityExist(ped) then
        exports.ox_target:removeLocalEntity(ped, 'battery_talk')
    end

    if leave and vehicle and DoesEntityExist(vehicle) and ped and DoesEntityExist(ped) then
        CreateThread(function()
            if Utils.requestControl(vehicle) then
                SetVehicleDoorShut(vehicle, 4, false)
                SetVehicleIndicatorLights(vehicle, 0, false)
                SetVehicleIndicatorLights(vehicle, 1, false)
                SetVehicleDoorsLocked(vehicle, 1)
            end
            if Utils.requestControl(ped) then
                ClearPedTasks(ped)
                TaskEnterVehicle(ped, vehicle, 10000, -1, 1.0, 1, 0)
                local deadline = GetGameTimer() + 10000
                while GetVehiclePedIsIn(ped, false) ~= vehicle and GetGameTimer() < deadline do Wait(250) end
                TaskVehicleDriveWander(ped, vehicle, 17.0, 786603)
                SetPedKeepTask(ped, true)
            end
        end)
    end
end

local function watchCall(c)
    removeBlip(areaBlip)
    local coords = c.coords
    areaBlip = AddBlipForRadius(coords.x, coords.y, coords.z, 120.0)
    SetBlipColour(areaBlip, 47)
    SetBlipAlpha(areaBlip, 120)
    SetNewWaypoint(coords.x, coords.y)

    CreateThread(function()
        while call() and call().id == c.id and not call().vehicleNet do
            if #(GetEntityCoords(cache.ped) - vec3(coords.x, coords.y, coords.z)) < Config.SpawnDistance then
                local spot, heading = findRoadsideSpot(coords)
                if spot then
                    local ok, vehNet, pedNet = lib.callback.await('rc2_batteryjob:server:spawnTarget', false, c.id, spot, heading)
                    if ok and call() and call().id == c.id then
                        call().vehicleNet, call().pedNet = vehNet, pedNet
                        setupTarget(call())
                        lib.notify({ description = locale('target_found'), type = 'inform' })
                        return
                    end
                end
                Wait(3000)
            end
            Wait(1000)
        end
    end)
end

--------------------------------------------------------------------------------
-- خطوات الشغل
--------------------------------------------------------------------------------

function Job.takeCables()
    local van = myVan()
    if not van or Cables.state() then return end

    TaskTurnPedToFaceEntity(cache.ped, van, 600)
    Wait(600)
    Utils.playAnimWait(Config.Anims.takeCables)

    local c = call()
    Cables.set({ van = Job.data.van, target = c and c.vehicleNet or nil, red = 'hand', black = 'hand' })
end

function Job.storeCables()
    local state = Cables.state()
    if not state or state.red ~= 'hand' or state.black ~= 'hand' then return end

    Utils.stopAnim(cache.ped, Config.Anims.holdCables)
    Utils.playAnimWait(Config.Anims.storeCables)

    local c = call()
    if c and c.step == 'disconnected' then
        local ok = Job.step('stored')
        if not ok then
            lib.notify({ description = locale('error_generic'), type = 'error' })
            return
        end
    end

    Cables.clear()
end

function Job.cablesYanked()
    Cables.clear()
    Utils.stopAnim(cache.ped, Config.Anims.holdCables)
    lib.notify({ description = locale('cables_too_far'), type = 'error' })
end

function Job.openHood()
    local c = call()
    if not c or c.step ~= 'talked' or not target.vehicle then return end

    Utils.playAnim(cache.ped, Config.Anims.hood)
    Wait(1500)
    if Utils.requestControl(target.vehicle) then
        SetVehicleDoorOpen(target.vehicle, 4, false, false)
    end
    Utils.stopAnim(cache.ped, Config.Anims.hood)

    Job.step('hood')
end

function Job.connect()
    local c = call()
    if not c or not target.vehicle then return end

    if not Cables.holding() then
        lib.notify({ description = locale('need_cables'), type = 'error' })
        return
    end

    local van = myVan()
    local battery = GetEntityCoords(Battery.get(target.vehicle))
    if not van or #(Screen.portCoords(van, 'red') - battery) > Config.Cables.maxReach then
        lib.notify({ description = locale('van_too_far'), type = 'error' })
        return
    end

    local done = Cables.connect(target.vehicle, function(color)
        return Job.step(color)
    end)

    if done then
        lib.notify({ description = locale('cables_connected'), type = 'success' })
    end
end

function Job.startAssist()
    local c = call()
    if Job.running or not c then return end

    if c.step ~= 'black' then
        lib.notify({ description = locale('not_ready'), type = 'error' })
        return
    end

    local ok, info = Job.step('running')
    if not ok then
        lib.notify({ description = locale('error_generic'), type = 'error' })
        return
    end

    Job.running = true
    Wait(info.duration * 1000 + 300)

    local done, result = Job.step('started')
    Job.running = false
    if not done then return end

    if not result.success then
        lib.notify({ description = locale('assist_failed'), type = 'error' })
        return
    end

    if target.vehicle and Utils.requestControl(target.vehicle) then
        SetVehicleUndriveable(target.vehicle, false)
        SetVehicleEngineOn(target.vehicle, true, false, true)
        SetVehicleIndicatorLights(target.vehicle, 0, false)
        SetVehicleIndicatorLights(target.vehicle, 1, false)
    end

    if target.ped then
        PlayPedAmbientSpeechNative(target.ped, 'GENERIC_THANKS', 'SPEECH_PARAMS_FORCE_NORMAL', 0)
        lib.notify({ title = c.customer, description = locale('customer_thanks'), type = 'success' })
    end

    Screen.close()
    lib.notify({ description = locale('disconnect_hint'), type = 'inform' })
end

function Job.disconnect()
    local c = call()
    if not c or c.step ~= 'started' or not target.vehicle then return end

    if Cables.disconnect(target.vehicle) and Job.step('disconnected') then
        if Utils.requestControl(target.vehicle) then
            SetVehicleDoorShut(target.vehicle, 4, false)
        end
        lib.notify({ description = locale('store_hint'), type = 'inform' })
    end
end

--------------------------------------------------------------------------------
-- نقاط التفاعل
--------------------------------------------------------------------------------

local function hoodCoords()
    if not target.vehicle or not DoesEntityExist(target.vehicle) then return nil end
    local _, max = GetModelDimensions(GetEntityModel(target.vehicle))
    return Utils.toWorld(target.vehicle, vec3(0.0, max.y + 0.45, 0.0))
end

local function vanPort()
    local van = myVan()
    return van and Screen.portCoords(van, 'red')
end

Prompts.add('battery_take', {
    distance = 1.2,
    label = locale('take_cables'),
    coords = vanPort,
    canShow = function() return not Cables.state() end,
    onSelect = Job.takeCables,
})

Prompts.add('battery_store', {
    distance = 1.2,
    label = locale('store_cables'),
    coords = vanPort,
    canShow = function()
        local s = Cables.state()
        return s and s.red == 'hand' and s.black == 'hand'
    end,
    onSelect = Job.storeCables,
})

Prompts.add('battery_screen', {
    distance = Config.Screen.interactDistance,
    label = locale('use_screen'),
    coords = function()
        local van = myVan()
        return van and Screen.centerCoords(van)
    end,
    canShow = function() return not Screen.interacting end,
    onSelect = function() Screen.interact(myVan()) end,
})

Prompts.add('battery_hood', {
    distance = 1.6,
    label = locale('open_hood'),
    coords = hoodCoords,
    canShow = function() return call() and call().step == 'talked' end,
    onSelect = Job.openHood,
})

Prompts.add('battery_connect', {
    distance = 1.6,
    label = locale('connect_cables'),
    coords = hoodCoords,
    canShow = function() return call() and (call().step == 'hood' or call().step == 'red') end,
    onSelect = Job.connect,
})

Prompts.add('battery_disconnect', {
    distance = 1.6,
    label = locale('disconnect_cables'),
    coords = hoodCoords,
    canShow = function() return call() and call().step == 'started' end,
    onSelect = Job.disconnect,
})

--------------------------------------------------------------------------------
-- أحداث السيرفر
--------------------------------------------------------------------------------

local function sendToTablet(state)
    if GetResourceState('rc2_tablet') == 'started' then
        exports.rc2_tablet:sendAppMessage('batteryjob', { type = 'state', data = state })
    end
end

RegisterNetEvent('rc2_batteryjob:client:state', function(state)
    local previous = call()
    Job.data = state

    -- البلاغ تغير (انلغى/انتهى)
    if previous and (not state.call or state.call.id ~= previous.id) and target.callId == previous.id then
        clearTarget(false)
    end

    sendToTablet(state)
end)

RegisterNetEvent('rc2_batteryjob:client:newCall', function(c)
    if not Job.data then Job.data = {} end
    Job.data.call = c
    lib.notify({ title = c.customer, description = locale('new_call', c.area), type = 'inform' })
    PlaySoundFrontend(-1, 'Text_Arrive_Tone', 'Phone_SoundSet_Default', true)
    watchCall(c)
end)

RegisterNetEvent('rc2_batteryjob:client:callFinished', function()
    clearTarget(true)
end)

RegisterNetEvent('rc2_batteryjob:client:shiftEnded', function()
    clearTarget(false)
    if Cables.state() then Cables.clear() end
    Utils.stopAnim(cache.ped, Config.Anims.holdCables)
    Job.data = nil
    lib.notify({ description = locale('shift_ended'), type = 'inform' })
end)

--------------------------------------------------------------------------------
-- تطبيق التابلت
--------------------------------------------------------------------------------

RegisterNUICallback('app:getState', function(_, cb)
    cb(lib.callback.await('rc2_batteryjob:server:getState', false))
end)

RegisterNUICallback('app:acceptContract', function(data, cb)
    local ok, err = lib.callback.await('rc2_batteryjob:server:acceptContract', false, data.id)
    cb({ ok = ok, error = err and locale('error_' .. err) })
end)

RegisterNUICallback('app:cancelContract', function(_, cb)
    cb({ ok = lib.callback.await('rc2_batteryjob:server:cancelContract', false) })
end)

RegisterNUICallback('app:cancelCall', function(_, cb)
    if Cables.state() then
        cb({ ok = false, error = locale('store_cables_first') })
        return
    end
    cb({ ok = lib.callback.await('rc2_batteryjob:server:cancelCall', false) })
end)

RegisterNUICallback('app:waypoint', function(data, cb)
    local coords
    if data.target == 'call' and call() then
        coords = target.vehicle and GetEntityCoords(target.vehicle) or call().coords
    else
        coords = Config.Depot.ped.coords
    end
    SetNewWaypoint(coords.x, coords.y)
    cb({ ok = true })
end)

--------------------------------------------------------------------------------
-- تشغيل
--------------------------------------------------------------------------------

CreateThread(function()
    setupDepot()

    -- لو السكربت انعاد تشغيله والشيفت شغال
    local state = lib.callback.await('rc2_batteryjob:server:getState', false)
    if state and state.onShift then
        Job.data = state
        if state.call then
            if state.call.vehicleNet then setupTarget(state.call) else watchCall(state.call) end
        end
    end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource ~= cache.resource then return end
    Utils.deleteEntity(depotPed)
    removeBlip(depotBlip)
    removeBlip(areaBlip)
    removeBlip(targetBlip)
end)
