local isOpen = false
local uiReady = false
local tabletProp

local function hexToRgb(hex)
    hex = hex:gsub('#', '')
    return ('%d, %d, %d'):format(tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16))
end

local function sendTheme()
    local colors = {}
    for i = 1, 3 do
        local hex = Config.Theme['color' .. i]
        colors['color' .. i] = hex
        colors['color' .. i .. 'Rgb'] = hexToRgb(hex)
    end
    SendNUIMessage({ action = 'theme', colors = colors })
end

local function sendLocale()
    local lang = GetConvar('ox:locale', 'en')
    local file = LoadResourceFile(cache.resource, ('locales/%s.json'):format(lang))
        or LoadResourceFile(cache.resource, 'locales/en.json')
    local strings = file and json.decode(file) or {}

    SendNUIMessage({
        action = 'setLocale',
        data = { strings = strings.ui or {}, rtl = lang == 'ar', lang = lang },
    })
end

local function refreshApps()
    if not uiReady then return end
    SendNUIMessage({ action = 'setApps', data = lib.callback.await('rc2_tablet:server:getApps', false) })
end

local function attachProp()
    local ped = cache.ped
    lib.requestModel(Config.Prop.model)

    local coords = GetEntityCoords(ped)
    tabletProp = CreateObject(Config.Prop.model, coords.x, coords.y, coords.z + 0.2, true, true, false)
    local off, rot = Config.Prop.offset, Config.Prop.rotation
    AttachEntityToEntity(tabletProp, ped, GetPedBoneIndex(ped, Config.Prop.bone),
        off.x, off.y, off.z, rot.x, rot.y, rot.z, true, true, false, true, 1, true)
    SetModelAsNoLongerNeeded(Config.Prop.model)
end

local function removeProp()
    if tabletProp and DoesEntityExist(tabletProp) then
        DeleteEntity(tabletProp)
    end
    tabletProp = nil
end

local function playAnim()
    lib.requestAnimDict(Config.Anim.dict)
    TaskPlayAnim(cache.ped, Config.Anim.dict, Config.Anim.clip, 3.0, 3.0, -1, 49, 0, false, false, false)
end

local function canOpen()
    if isOpen or IsPauseMenuActive() then return false end
    if IsEntityDead(cache.ped) or LocalPlayer.state.isDead then return false end

    local metadata = QBX.PlayerData and QBX.PlayerData.metadata
    if metadata and (metadata.isdead or metadata.inlaststand or metadata.ishandcuffed) then
        return false
    end

    return true
end

local function close()
    if not isOpen then return end
    isOpen = false

    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'setVisible', data = false })

    StopAnimTask(cache.ped, Config.Anim.dict, Config.Anim.clip, 1.0)
    RemoveAnimDict(Config.Anim.dict)
    removeProp()

    LocalPlayer.state:set('tabletOpen', false, true)
    TriggerEvent('rc2_tablet:client:closed')
end

local function open()
    if not canOpen() then return false end
    isOpen = true

    refreshApps()
    SetNuiFocus(true, true)
    SendNUIMessage({ action = 'setVisible', data = true })

    attachProp()
    playAnim()

    LocalPlayer.state:set('tabletOpen', true, true)
    TriggerEvent('rc2_tablet:client:opened')

    -- Restarts the anim if interrupted and closes the tablet if the player dies
    CreateThread(function()
        while isOpen do
            if IsEntityDead(cache.ped) then
                close()
                break
            end
            if not IsEntityPlayingAnim(cache.ped, Config.Anim.dict, Config.Anim.clip, 3) then
                playAnim()
            end
            Wait(500)
        end
    end)

    return true
end

local function hasTablet()
    if not Config.RequireItem then return true end
    return exports.ox_inventory:GetItemCount(Config.Item) > 0
end

local function toggle()
    if isOpen then return close() end
    if not hasTablet() then return end
    open()
end

-- NUI callbacks -------------------------------------------------------------

RegisterNUICallback('uiReady', function(_, cb)
    uiReady = true
    sendLocale()
    sendTheme()
    cb(lib.callback.await('rc2_tablet:server:getApps', false) or {})
end)

RegisterNUICallback('close', function(_, cb)
    close()
    cb({})
end)

RegisterNUICallback('appOpened', function(data, cb)
    TriggerEvent('rc2_tablet:client:appOpened', data.identifier)
    cb({})
end)

RegisterNUICallback('appClosed', function(data, cb)
    TriggerEvent('rc2_tablet:client:appClosed', data.identifier)
    cb({})
end)

-- Events --------------------------------------------------------------------

RegisterNetEvent('rc2_tablet:client:open', function()
    if hasTablet() then open() end
end)

RegisterNetEvent('rc2_tablet:client:close', close)
RegisterNetEvent('rc2_tablet:client:refreshApps', refreshApps)

RegisterNetEvent('rc2_tablet:client:removeApp', function(identifier)
    SendNUIMessage({ action = 'removeApp', data = identifier })
end)

local function notify(data)
    SendNUIMessage({ action = 'notify', data = data })
end

local function sendAppMessage(identifier, data)
    SendNUIMessage({ action = 'appMessage', app = identifier, data = data })
end

local function openApp(identifier)
    if not isOpen and not open() then return end
    SendNUIMessage({ action = 'openApp', data = identifier })
end

local function closeApp(identifier)
    SendNUIMessage({ action = 'closeApp', data = identifier })
end

RegisterNetEvent('rc2_tablet:client:notify', notify)
RegisterNetEvent('rc2_tablet:client:appMessage', sendAppMessage)

-- Skills app ----------------------------------------------------------------

RegisterNUICallback('skills:get', function(_, cb)
    cb(lib.callback.await('rc2_tablet:server:skills:get', false) or {})
end)

RegisterNUICallback('skills:upgrade', function(data, cb)
    local ok, trees = lib.callback.await('rc2_tablet:server:skills:upgrade', false, data.tree, data.skill)
    cb({ ok = ok, trees = trees })
end)

RegisterNetEvent('rc2_tablet:client:skillsUpdated', function()
    sendAppMessage('skills', { type = 'refresh' })
end)

-- Refresh apps when job / gang / duty changes
RegisterNetEvent('QBCore:Client:OnPlayerLoaded', refreshApps)
RegisterNetEvent('QBCore:Client:OnJobUpdate', refreshApps)
RegisterNetEvent('QBCore:Client:OnGangUpdate', refreshApps)
RegisterNetEvent('QBCore:Client:SetDuty', refreshApps)

RegisterNetEvent('QBCore:Client:OnPlayerUnload', close)

AddEventHandler('onResourceStop', function(resource)
    if resource ~= cache.resource then return end
    if isOpen then
        SetNuiFocus(false, false)
        StopAnimTask(cache.ped, Config.Anim.dict, Config.Anim.clip, 1.0)
    end
    removeProp()
end)

-- Command / keybind ---------------------------------------------------------

if Config.Command then
    RegisterCommand(Config.Command, toggle, false)
end

if Config.Keybind then
    lib.addKeybind({
        name = 'rc2_tablet',
        description = 'Open tablet',
        defaultKey = Config.Keybind,
        onPressed = toggle,
    })
end

-- Exports -------------------------------------------------------------------

-- ox_inventory: client = { export = 'rc2_tablet.useTablet' }
exports('useTablet', function()
    toggle()
end)

exports('open', open)
exports('close', close)
exports('isOpen', function() return isOpen end)
exports('openApp', openApp)
exports('closeApp', closeApp)
exports('notify', notify)
exports('sendAppMessage', sendAppMessage)
exports('refreshApps', refreshApps)
