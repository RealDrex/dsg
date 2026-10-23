--[[
    All job and payment logic lives here. The client asks, the server validates:
    - every step must arrive in order
    - the player must be close to the stalled vehicle
    - the charge duration is timed by the server
    - each call pays out only once
]]

local STEPS = {
    'assigned',   -- call received
    'talked',     -- talked to the customer
    'hood',       -- hood opened
    'red',        -- positive connected
    'black',      -- negative connected (ready)
    'running',    -- charging
    'started',    -- vehicle started
    'disconnected', -- cables disconnected
    'stored',     -- cables stored (pays out)
}

local STEP_INDEX = {}
for i, step in ipairs(STEPS) do STEP_INDEX[step] = i end

---@type table<number, table>
local shifts = {}
local callCounter = 0

--------------------------------------------------------------------------------
-- Database
--------------------------------------------------------------------------------

MySQL.ready(function()
    MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS `drx_batteryjob_stats` (
            `citizenid` VARCHAR(50) NOT NULL,
            `calls` INT NOT NULL DEFAULT 0,
            `earned` INT NOT NULL DEFAULT 0,
            `contracts` INT NOT NULL DEFAULT 0,
            PRIMARY KEY (`citizenid`)
        )
    ]])
end)

local function getCitizenId(src)
    local player = exports.qbx_core:GetPlayer(src)
    return player and player.PlayerData.citizenid
end

local function loadStats(citizenid)
    local row = MySQL.single.await('SELECT calls, earned, contracts FROM drx_batteryjob_stats WHERE citizenid = ?', { citizenid })
    return row or { calls = 0, earned = 0, contracts = 0 }
end

local function addStats(citizenid, calls, earned, contracts)
    MySQL.prepare([[
        INSERT INTO drx_batteryjob_stats (citizenid, calls, earned, contracts) VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE calls = calls + VALUES(calls), earned = earned + VALUES(earned), contracts = contracts + VALUES(contracts)
    ]], { citizenid, calls, earned, contracts })
end

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

local function notify(src, description, type)
    exports.qbx_core:Notify(src, description, type or 'inform')
end

local function tabletNotify(src, message)
    if GetResourceState('rc2_tablet') ~= 'started' then return end
    exports.rc2_tablet:Notify(src, {
        app = 'batteryjob',
        title = Config.JobLabel,
        message = message,
        icon = 'fa-solid fa-car-battery',
        iconColor = '#ffffff',
        color = '#ff5a1f',
    })
end

local function playerCoords(src)
    return GetEntityCoords(GetPlayerPed(src))
end

local function deleteNet(netId)
    if not netId then return end
    local entity = NetworkGetEntityFromNetworkId(netId)
    if entity ~= 0 and DoesEntityExist(entity) then
        DeleteEntity(entity)
    end
end

local function getEntity(netId)
    if not netId then return end
    local entity = NetworkGetEntityFromNetworkId(netId)
    if entity ~= 0 and DoesEntityExist(entity) then return entity end
end

local function cleanupCall(call, delay)
    if not call then return end
    local vehicle, ped = call.vehicleNet, call.pedNet
    SetTimeout(delay or 0, function()
        deleteNet(ped)
        deleteNet(vehicle)
    end)
end

-- vector -> plain table (so it serializes cleanly to JSON for the UI)
local function toTable(v)
    return { x = v.x, y = v.y, z = v.z }
end

local function publicCall(call)
    if not call then return nil end
    return {
        id = call.id,
        step = call.step,
        area = call.area.label,
        coords = toTable(call.coords or call.area.coords),
        customer = call.customer,
        vehicleNet = call.vehicleNet,
        pedNet = call.pedNet,
        model = call.model,
    }
end

local function publicContract(shift)
    local c = shift.contract
    if not c then return nil end
    return {
        id = c.def.id,
        label = c.def.label,
        done = c.done,
        calls = c.def.calls,
        endsAt = c.endsAt,
        now = os.time(),
    }
end

--------------------------------------------------------------------------------
-- Skills (stored and upgraded through the rc2_tablet Skills app)
--------------------------------------------------------------------------------

local function tabletStarted()
    return GetResourceState('rc2_tablet') == 'started'
end

local function skillLevel(src, skillId)
    if not tabletStarted() then return 0 end
    local ok, level = pcall(function()
        return exports.rc2_tablet:GetSkillLevel(src, Config.Skills.tree.id, skillId)
    end)
    return ok and tonumber(level) or 0
end

local function skillLevels(src)
    local levels = {}
    for _, skill in ipairs(Config.Skills.tree.skills) do
        levels[skill.id] = skillLevel(src, skill.id)
    end
    return levels
end

local function addXp(src, amount)
    if not tabletStarted() then return end
    pcall(function() exports.rc2_tablet:AddSkillXP(src, Config.Skills.tree.id, amount) end)
end

local function registerSkillTree()
    if not tabletStarted() then return end
    exports.rc2_tablet:RegisterSkillTree(Config.Skills.tree)
end

local function getState(src)
    local shift = shifts[src]
    local citizenid = getCitizenId(src)

    return {
        onShift = shift ~= nil,
        van = shift and shift.vanNet,
        call = shift and publicCall(shift.call),
        nextCallIn = shift and shift.nextCallAt and math.max(0, shift.nextCallAt - os.time()) or nil,
        contract = shift and publicContract(shift),
        session = shift and { calls = shift.calls, earned = shift.earned } or nil,
        stats = citizenid and loadStats(citizenid) or nil,
        skills = skillLevels(src),
        contracts = Config.Contracts,
        depot = toTable(Config.Depot.ped.coords),
    }
end

-- External screen state on the van (visible to every nearby player)
local function updateScreen(src)
    local shift = shifts[src]
    local van = shift and getEntity(shift.vanNet)
    if not van then return end

    local call = shift.call
    local data

    if not call then
        data = { mode = 'standby', calls = shift.calls }
    else
        local i = STEP_INDEX[call.step]
        data = {
            mode = 'call',
            step = call.step,
            customer = call.customer,
            red = i >= STEP_INDEX.red and i < STEP_INDEX.disconnected,
            black = i >= STEP_INDEX.black and i < STEP_INDEX.disconnected,
            running = call.step == 'running' and { duration = call.runDuration, id = call.runId } or nil,
            result = (call.step == 'started' or call.step == 'disconnected') and 'success' or call.lastResult,
        }
    end

    Entity(van).state:set('batteryScreen', data, true)
end

local function pushState(src)
    updateScreen(src)
    TriggerClientEvent('drx_batteryjob:client:state', src, getState(src))
end

--------------------------------------------------------------------------------
-- Calls
--------------------------------------------------------------------------------

local function pickArea(shift)
    local options = {}
    for i, area in ipairs(Config.CallAreas) do
        if i ~= shift.lastArea then options[#options + 1] = i end
    end
    local index = options[math.random(#options)]
    shift.lastArea = index
    return Config.CallAreas[index]
end

local function assignCall(src)
    local shift = shifts[src]
    if not shift or shift.call then return end

    callCounter = callCounter + 1
    shift.nextCallAt = nil
    shift.call = {
        id = callCounter,
        step = 'assigned',
        area = pickArea(shift),
        customer = Config.CustomerNames[math.random(#Config.CustomerNames)],
        model = Config.TargetVehicles[math.random(#Config.TargetVehicles)],
        createdAt = os.time(),
    }

    TriggerClientEvent('drx_batteryjob:client:newCall', src, publicCall(shift.call))
    tabletNotify(src, ('New call: %s - %s'):format(shift.call.customer, shift.call.area.label))
    pushState(src)
end

local function scheduleNextCall(src)
    local shift = shifts[src]
    if not shift then return end

    local delay = math.random(Config.CallCooldown.min, Config.CallCooldown.max)
    shift.nextCallAt = os.time() + delay
    local token = shift.token

    SetTimeout(delay * 1000, function()
        local current = shifts[src]
        if current and current.token == token and not current.call then
            assignCall(src)
        end
    end)
end

--------------------------------------------------------------------------------
-- Shift
--------------------------------------------------------------------------------

local function findFreeSpawn()
    for _, spawn in ipairs(Config.Depot.vehicleSpawns) do
        local free = true
        for _, vehicle in ipairs(GetAllVehicles()) do
            if #(GetEntityCoords(vehicle) - spawn.xyz) < 3.0 then
                free = false
                break
            end
        end
        if free then return spawn end
    end
end

local function endShift(src, reason)
    local shift = shifts[src]
    if not shift then return end

    cleanupCall(shift.call)
    deleteNet(shift.vanNet)
    shifts[src] = nil

    Player(src).state:set('batteryShift', false, true)
    TriggerClientEvent('drx_batteryjob:client:shiftEnded', src, reason)
    pushState(src)
end

lib.callback.register('drx_batteryjob:server:startShift', function(src)
    if shifts[src] then return false, 'already_on_shift' end
    if #(playerCoords(src) - Config.Depot.ped.coords.xyz) > 10.0 then return false, 'too_far' end

    local spawn = findFreeSpawn()
    if not spawn then return false, 'spawn_blocked' end

    local ok, netId, vehicle = pcall(qbx.spawnVehicle, {
        model = Config.ServiceVehicle.model,
        spawnSource = spawn,
    })
    if not ok or not netId then
        lib.print.error('failed to spawn service vehicle', netId)
        return false, 'spawn_failed'
    end

    pcall(function() exports.qbx_core:DisablePersistence(vehicle) end)

    local plate = ('%s%04d'):format(Config.ServiceVehicle.plate, math.random(0, 9999))
    SetVehicleNumberPlateText(vehicle, plate)

    local state = Entity(vehicle).state
    state:set('batteryVan', { owner = src }, true)
    state:set('batteryScreen', { mode = 'idle' }, true)
    state:set('fuel', Config.ServiceVehicle.fuel, true)

    Config.GiveKeys(src, vehicle)

    shifts[src] = {
        vanNet = netId,
        calls = 0,
        earned = 0,
        token = math.random(1, 1e9),
        citizenid = getCitizenId(src),
    }

    Player(src).state:set('batteryShift', true, true)
    scheduleNextCall(src)
    pushState(src)

    return true, netId
end)

lib.callback.register('drx_batteryjob:server:endShift', function(src)
    local shift = shifts[src]
    if not shift then return false end

    if #(playerCoords(src) - Config.Depot.ped.coords.xyz) > Config.Depot.returnDistance then
        return false, 'too_far'
    end

    endShift(src, 'ended')
    return true
end)

lib.callback.register('drx_batteryjob:server:getState', function(src)
    return getState(src)
end)

--------------------------------------------------------------------------------
-- Contracts
--------------------------------------------------------------------------------

lib.callback.register('drx_batteryjob:server:acceptContract', function(src, id)
    local shift = shifts[src]
    if not shift then return false, 'not_on_shift' end
    if shift.contract then return false, 'has_contract' end

    for _, def in ipairs(Config.Contracts) do
        if def.id == id then
            shift.contract = { def = def, done = 0, endsAt = os.time() + def.time * 60 }
            tabletNotify(src, ('Started %s'):format(def.label))
            pushState(src)
            return true
        end
    end

    return false, 'unknown_contract'
end)

lib.callback.register('drx_batteryjob:server:cancelContract', function(src)
    local shift = shifts[src]
    if not shift or not shift.contract then return false end
    shift.contract = nil
    pushState(src)
    return true
end)

local function progressContract(src, shift)
    local c = shift.contract
    if not c then return 0 end

    if os.time() > c.endsAt then
        shift.contract = nil
        tabletNotify(src, ('%s expired'):format(c.def.label))
        return 0
    end

    c.done = c.done + 1
    if c.done < c.def.calls then return 0 end

    shift.contract = nil
    tabletNotify(src, ('Completed %s! Bonus $%d'):format(c.def.label, c.def.bonus))
    return c.def.bonus
end

--------------------------------------------------------------------------------
-- Call progress (server validated)
--------------------------------------------------------------------------------

lib.callback.register('drx_batteryjob:server:spawnTarget', function(src, callId, coords, heading)
    local shift = shifts[src]
    local call = shift and shift.call
    if not call or call.id ~= callId or call.vehicleNet then return false end

    coords = vec3(coords.x, coords.y, coords.z)
    if #(coords - call.area.coords) > Config.CallAreaRadius then return false end
    if #(playerCoords(src) - coords) > Config.SpawnDistance + 60.0 then return false end

    local ok, vehNet, vehicle = pcall(qbx.spawnVehicle, {
        model = call.model,
        spawnSource = vec4(coords.x, coords.y, coords.z, heading),
    })
    if not ok or not vehNet then
        lib.print.error('failed to spawn target vehicle', vehNet)
        return false
    end
    pcall(function() exports.qbx_core:DisablePersistence(vehicle) end)

    local pedModel = Config.CustomerPeds[math.random(#Config.CustomerPeds)]
    -- Customer stands on the sidewalk (right side of the car), slightly ahead, facing the car
    local rad = math.rad(heading)
    local right = vec3(math.cos(rad), math.sin(rad), 0.0)
    local forward = vec3(-math.sin(rad), math.cos(rad), 0.0)
    local pedCoords = coords + right * 2.0 + forward * 1.2
    local ped = CreatePed(4, pedModel, pedCoords.x, pedCoords.y, pedCoords.z, heading + 90.0, true, true)

    lib.waitFor(function() return DoesEntityExist(ped) or nil end, 'customer ped never existed', 5000)

    call.vehicleNet = vehNet
    call.pedNet = NetworkGetNetworkIdFromEntity(ped)
    call.coords = coords

    Entity(vehicle).state:set('batteryTarget', { owner = src, callId = callId }, true)

    return true, call.vehicleNet, call.pedNet
end)

local function canAdvance(src, call, step)
    local current = STEP_INDEX[call.step]
    local wanted = STEP_INDEX[step]
    if not wanted or wanted ~= current + 1 then return false end

    local vehicle = getEntity(call.vehicleNet)
    if not vehicle then return false end

    return #(playerCoords(src) - GetEntityCoords(vehicle)) <= Config.MaxDistanceFromTarget
end

lib.callback.register('drx_batteryjob:server:step', function(src, callId, step)
    local shift = shifts[src]
    local call = shift and shift.call
    if not call or call.id ~= callId then return false end

    -- Start: the server decides the duration and the outcome
    if step == 'running' then
        if not canAdvance(src, call, step) then return false end
        call.step = 'running'
        call.runId = (call.runId or 0) + 1
        call.lastResult = nil
        call.runStartedAt = GetGameTimer()

        local speed = skillLevel(src, 'install_speed')
        local reliability = skillLevel(src, 'reliability')
        call.runDuration = math.max(3, Config.AssistDuration * (1 - speed * Config.Skills.installSpeedPerLevel))
        call.runSuccess = math.random() >= math.max(0, Config.FailChance - reliability * Config.Skills.reliabilityPerLevel)

        pushState(src)
        return true, { duration = call.runDuration, success = call.runSuccess }
    end

    if step == 'started' then
        if call.step ~= 'running' then return false end
        if GetGameTimer() - call.runStartedAt < (call.runDuration - 1) * 1000 then return false end

        if not call.runSuccess then
            -- Failed: back to ready so the player can retry
            call.step = 'black'
            call.lastResult = 'fail'
            pushState(src)
            return true, { success = false }
        end

        call.step = 'started'
        pushState(src)
        return true, { success = true }
    end

    if step == 'stored' then
        if call.step ~= 'disconnected' or call.paid then return false end

        local van = getEntity(shift.vanNet)
        if not van or #(playerCoords(src) - GetEntityCoords(van)) > 6.0 then return false end

        call.paid = true
        call.step = 'stored'

        local player = exports.qbx_core:GetPlayer(src)
        if not player then return false end

        local service = skillLevel(src, 'customer_service')
        local amount = math.floor(math.random(Config.Payment.min, Config.Payment.max) * (1 + service * Config.Skills.payPerLevel))
        local bonus = progressContract(src, shift)
        player.Functions.AddMoney(Config.Payment.account, amount + bonus, 'battery-assist')

        shift.calls = shift.calls + 1
        shift.earned = shift.earned + amount + bonus
        if shift.citizenid then
            addStats(shift.citizenid, 1, amount + bonus, bonus > 0 and 1 or 0)
        end

        addXp(src, Config.Skills.xpPerCall + (bonus > 0 and Config.Skills.xpPerContract or 0))
        notify(src, ('You received $%d%s'):format(amount, bonus > 0 and (' + bonus $%d'):format(bonus) or ''), 'success')

        TriggerClientEvent('drx_batteryjob:client:callFinished', src, call.id)
        cleanupCall(call, 45000)
        shift.call = nil
        scheduleNextCall(src)
        pushState(src)

        return true, { amount = amount, bonus = bonus }
    end

    if not canAdvance(src, call, step) then return false end
    call.step = step
    pushState(src)
    return true
end)

-- The player can cancel the current call (no payment)
lib.callback.register('drx_batteryjob:server:cancelCall', function(src)
    local shift = shifts[src]
    if not shift or not shift.call then return false end

    cleanupCall(shift.call)
    shift.call = nil
    scheduleNextCall(src)
    pushState(src)
    return true
end)

--------------------------------------------------------------------------------
-- Cleanup + tablet
--------------------------------------------------------------------------------

AddEventHandler('playerDropped', function()
    endShift(source, 'dropped')
end)

-- Local server event from qbx_core (not a net event, so clients cannot trigger it)
AddEventHandler('QBCore:Server:OnPlayerUnload', function(src)
    endShift(src, 'unloaded')
end)

AddEventHandler('onResourceStop', function(resource)
    if resource ~= cache.resource then return end
    for src in pairs(shifts) do
        endShift(src, 'resource')
    end
end)

-- The app itself is listed in rc2_tablet's Config.Apps; only the skill tree is registered here
AddEventHandler('onResourceStart', function(resource)
    if resource == 'rc2_tablet' then registerSkillTree() end
end)

CreateThread(registerSkillTree)
