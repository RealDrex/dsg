OT.Weapon = {}

local cfg = Config.Weapon

local function u32(h) return h & 0xFFFFFFFF end

local GROUPS = {
    [u32(`GROUP_PISTOL`)] = 'pistol',
    [u32(`GROUP_STUNGUN`)] = 'pistol',
    [u32(`GROUP_SMG`)] = 'smg',
    [u32(`GROUP_RIFLE`)] = 'rifle',
    [u32(`GROUP_MG`)] = 'mg',
    [u32(`GROUP_SHOTGUN`)] = 'shotgun',
    [u32(`GROUP_SNIPER`)] = 'sniper',
    [u32(`GROUP_HEAVY`)] = 'heavy',
    [u32(`GROUP_THROWN`)] = 'throwable',
    [u32(`GROUP_MELEE`)] = 'melee',
    [u32(`GROUP_UNARMED`)] = 'melee',
}

local qbSlot = nil
local function onQbWeapon(data, _)
    qbSlot = data and data.slot or nil
end
RegisterNetEvent('weapons:client:SetCurrentWeapon', onQbWeapon)
RegisterNetEvent('qb-weapons:client:SetCurrentWeapon', onQbWeapon)

-- ox ammo count is cached (Search is not free)
local ammoCache = { item = nil, count = 0, time = 0 }
local function oxAmmoCount(item)
    local now = GetGameTimer()
    if ammoCache.item ~= item or now - ammoCache.time > 750 then
        ammoCache.item, ammoCache.time = item, now
        ammoCache.count = exports.ox_inventory:Search('count', item) or 0
    end
    return ammoCache.count
end

function OT.Weapon.collect()
    if not cfg.enabled or OT.isAircraft then return nil end

    local ped = OT.ped
    local hash = GetSelectedPedWeapon(ped)
    if hash == 0 or cfg.hidden[hash] then return nil end

    -- the weapon HUD is an ammo display: melee / tools are not shown
    local group = GROUPS[u32(GetWeapontypeGroup(hash))]
    if not group or group == 'melee' then return nil end

    local name = cfg.names[hash] or WeaponNames[hash] or Config.Labels.weaponFallback
    local durability, ammoItem = nil, nil

    if OT.inventory == 'ox' then
        local w = exports.ox_inventory:getCurrentWeapon()
        if w then
            name = w.label or name
            ammoItem = w.ammo
            if w.metadata and w.metadata.durability then durability = w.metadata.durability end
        end
    elseif OT.inventory == 'qb' and qbSlot then
        local pd = OT.getPlayerData()
        local item = pd and pd.items and pd.items[qbSlot]
        if item then
            name = item.label or name
            if item.info and item.info.quality then durability = item.info.quality end
        end
    end

    local cap, mag, reserve
    if group == 'throwable' then
        mag = GetAmmoInPedWeapon(ped, hash) or 0
        cap, reserve = math.max(mag, 1), 0
    else
        cap = GetMaxAmmoInClip(ped, hash, true) or 0
        local _, clip = GetAmmoInClip(ped, hash)
        mag = clip or 0
        reserve = (GetAmmoInPedWeapon(ped, hash) or 0) - mag
        if ammoItem then reserve = oxAmmoCount(ammoItem) end
    end

    return {
        name = name,
        magCapacity = math.max(cap, 1),
        magContent = math.max(mag, 0),
        totalAmmo = math.max(reserve, 0),
        durability = {
            active = cfg.showDurability and durability ~= nil,
            value = durability and OT.pct(durability) or 100,
        },
    }
end
