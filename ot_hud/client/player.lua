OT.Player = {}

local status = { hunger = 100, thirst = 100, stress = 0 }
local voice = { level = 2, max = Config.Voice.levels or 3, talking = false, radio = false, radioTalking = false }
local maxUnderwater = 10.0

function OT.Player.getStress()
    return status.stress
end

local function setStatus(key, value)
    value = tonumber(value)
    if value == nil then return end
    status[key] = OT.clamp(value, 0, 100)
end
OT.Player.setStatus = setStatus

local function fromMetadata(md)
    if not md then return end
    if md.hunger ~= nil then setStatus('hunger', md.hunger) end
    if md.thirst ~= nil then setStatus('thirst', md.thirst) end
    if md.stress ~= nil then setStatus('stress', md.stress) end
end

-- ─────────────────────────── qb / qbx ─────────────────────────────

RegisterNetEvent('hud:client:UpdateNeeds', function(hunger, thirst)
    setStatus('hunger', hunger)
    setStatus('thirst', thirst)
end)

RegisterNetEvent('hud:client:UpdateStress', function(stress)
    setStatus('stress', stress)
end)

RegisterNetEvent('QBCore:Player:SetPlayerData', function(pd)
    if pd then fromMetadata(pd.metadata) end
end)

-- qbx (and our own esx/standalone stress) push values through state bags
local bagName = ('player:%s'):format(GetPlayerServerId(PlayerId()))
for _, key in ipairs({ 'hunger', 'thirst', 'stress' }) do
    AddStateBagChangeHandler(key, bagName, function(_, _, value)
        if value ~= nil then setStatus(key, value) end
    end)
end

-- ─────────────────────────── esx ──────────────────────────────────

RegisterNetEvent('esx_status:onTick', function(list)
    for _, v in ipairs(list or {}) do
        if v.name == 'hunger' or v.name == 'thirst' or v.name == 'stress' then
            setStatus(v.name, v.percent)
        end
    end
end)

OT.onLoaded(function()
    Wait(1000)
    local pd = OT.getPlayerData()
    if pd then fromMetadata(pd.metadata) end
    local st = LocalPlayer.state
    if st.hunger then setStatus('hunger', st.hunger) end
    if st.thirst then setStatus('thirst', st.thirst) end
    if st.stress then setStatus('stress', st.stress) end
end)

exports('setStatus', setStatus)

-- ─────────────────────────── voice (pma-voice) ────────────────────

AddEventHandler('pma-voice:radioActive', function(active)
    voice.radioTalking = active and true or false
end)

exports('setVoice', function(data)
    for k, v in pairs(data or {}) do voice[k] = v end
end)

local function updateVoice()
    voice.talking = NetworkIsPlayerTalking(OT.playerId)
    local prox = LocalPlayer.state.proximity
    if prox and prox.index then voice.level = prox.index end
    local channel = LocalPlayer.state.radioChannel
    voice.radio = channel ~= nil and channel ~= 0
end

-- ─────────────────────────── collect ──────────────────────────────

function OT.Player.collect()
    local ped, pid = OT.ped, OT.playerId

    local maxHealth = GetEntityMaxHealth(ped) - 100
    local health = maxHealth > 0 and (GetEntityHealth(ped) - 100) / maxHealth * 100 or 0
    if IsEntityDead(ped) then health = 0 end

    updateVoice()

    local data = {
        health = OT.pct(health),
        armor = OT.pct(GetPedArmour(ped)),
        hunger = OT.pct(status.hunger),
        thirst = OT.pct(status.thirst),
        stress = OT.pct(status.stress),
        voice = {
            value = OT.pct(voice.level / math.max(voice.max, 1) * 100),
            talking = voice.talking,
            radio = voice.radio,
            radioTalking = voice.radioTalking,
        },
    }

    if Config.Player.showStamina then
        local used = GetPlayerSprintStaminaRemaining(pid) -- returns "used" stamina (0 = full)
        if used > 0.5 then data.stamina = OT.pct(100 - used) end
    end

    if Config.Player.showOxygen then
        local remaining = GetPlayerUnderwaterTimeRemaining(pid)
        if remaining > maxUnderwater then maxUnderwater = remaining end
        if IsPedSwimmingUnderWater(ped) then
            data.oxygen = OT.pct(remaining / maxUnderwater * 100)
        end
    end

    return data
end
