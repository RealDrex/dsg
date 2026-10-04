local cfg = Config.Stress

local framework = Config.Framework
if framework == 'auto' then
    if GetResourceState('qbx_core') == 'started' then framework = 'qbx'
    elseif GetResourceState('qb-core') == 'started' then framework = 'qb'
    elseif GetResourceState('es_extended') == 'started' then framework = 'esx'
    else framework = 'standalone' end
end

local QBCore = framework == 'qb' and exports['qb-core']:GetCoreObject() or nil

local function clamp(v) return math.max(0, math.min(100, v)) end

local function addStress(src, delta)
    delta = tonumber(delta)
    if not delta or delta == 0 then return end

    if framework == 'qb' or framework == 'qbx' then
        local player = framework == 'qb' and QBCore.Functions.GetPlayer(src) or exports.qbx_core:GetPlayer(src)
        if not player then return end
        local value = clamp((player.PlayerData.metadata.stress or 0) + delta)
        player.Functions.SetMetaData('stress', value)
        TriggerClientEvent('hud:client:UpdateStress', src, value)
    else
        -- esx / standalone: kept in the player state bag (not persisted)
        local state = Player(src).state
        state:set('stress', clamp((state.stress or 0) + delta), true)
    end
end

exports('AddStress', function(src, amount) addStress(src, math.abs(amount)) end)
exports('RemoveStress', function(src, amount) addStress(src, -math.abs(amount)) end)

if not cfg.enabled then return end

-- client requests are capped so a modified client can't push big values
local function onGain(amount)
    addStress(source, math.min(math.abs(tonumber(amount) or 0), 10))
end

local function onRelieve(amount)
    addStress(source, -math.min(math.abs(tonumber(amount) or 0), 100))
end

RegisterNetEvent('ot_hud:server:gainStress', onGain)
RegisterNetEvent('ot_hud:server:relieveStress', onRelieve)

if cfg.compatEvents then
    RegisterNetEvent('hud:server:GainStress', onGain)
    RegisterNetEvent('hud:server:RelieveStress', onRelieve)
end
