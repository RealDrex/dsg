--[[
    Skills
    Any resource can register a skill tree; players earn XP from that resource,
    every level grants one skill point, and points are spent in the Skills app.

    exports.rc2_tablet:RegisterSkillTree({
        id = 'batteryjob', label = 'Battery Assist', icon = 'fa-solid fa-car-battery', color = '#ff5a1f',
        skills = {
            { id = 'install_speed', label = 'Installation Speed', description = '...', effect = '-10% time per level', maxLevel = 5 },
        },
    })
    exports.rc2_tablet:AddSkillXP(source, 'batteryjob', 100)
    exports.rc2_tablet:GetSkillLevel(source, 'batteryjob', 'install_speed') -- 0..maxLevel
]]

local trees = {}      -- [treeId] = definition
local treeOwners = {} -- [treeId] = resource that registered it
local cache = {}      -- [citizenid][treeId] = { xp = number, levels = { [skillId] = level } }

MySQL.ready(function()
    MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS `rc2_tablet_skills` (
            `citizenid` VARCHAR(50) NOT NULL,
            `tree` VARCHAR(50) NOT NULL,
            `xp` INT NOT NULL DEFAULT 0,
            `levels` LONGTEXT NULL,
            PRIMARY KEY (`citizenid`, `tree`)
        )
    ]])
end)

local function getCitizenId(source)
    local player = exports.qbx_core:GetPlayer(source)
    return player and player.PlayerData.citizenid
end

local function load(citizenid, treeId)
    cache[citizenid] = cache[citizenid] or {}
    local entry = cache[citizenid][treeId]
    if entry then return entry end

    local row = MySQL.single.await('SELECT xp, levels FROM rc2_tablet_skills WHERE citizenid = ? AND tree = ?', { citizenid, treeId })
    entry = { xp = row and row.xp or 0, levels = row and row.levels and json.decode(row.levels) or {} }
    cache[citizenid][treeId] = entry
    return entry
end

local function save(citizenid, treeId, entry)
    MySQL.prepare([[
        INSERT INTO rc2_tablet_skills (citizenid, tree, xp, levels) VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE xp = VALUES(xp), levels = VALUES(levels)
    ]], { citizenid, treeId, entry.xp, json.encode(entry.levels) })
end

local function maxTreeLevel(tree)
    local total = 0
    for _, skill in ipairs(tree.skills) do total = total + skill.maxLevel end
    return total
end

local function progress(tree, entry)
    local perLevel = Config.Skills.xpPerLevel
    local level = math.min(math.floor(entry.xp / perLevel), maxTreeLevel(tree))
    local spent = 0
    for _, value in pairs(entry.levels) do spent = spent + value end

    local skills = {}
    for _, skill in ipairs(tree.skills) do
        skills[#skills + 1] = {
            id = skill.id,
            label = skill.label,
            description = skill.description,
            effect = skill.effect,
            icon = skill.icon,
            maxLevel = skill.maxLevel,
            level = entry.levels[skill.id] or 0,
        }
    end

    return {
        id = tree.id,
        label = tree.label,
        icon = tree.icon,
        color = tree.color,
        xp = entry.xp,
        level = level,
        maxLevel = maxTreeLevel(tree),
        levelXp = level * perLevel,
        nextXp = (level + 1) * perLevel,
        points = math.max(0, level - spent),
        skills = skills,
    }
end

local function skillsFor(source)
    local citizenid = getCitizenId(source)
    if not citizenid then return {} end

    local list = {}
    for _, tree in pairs(trees) do
        list[#list + 1] = progress(tree, load(citizenid, tree.id))
    end
    table.sort(list, function(a, b) return a.label < b.label end)
    return list
end

local function pushSkills(source)
    TriggerClientEvent('rc2_tablet:client:skillsUpdated', source)
end

--------------------------------------------------------------------------------
-- Exports
--------------------------------------------------------------------------------

local function RegisterSkillTree(def)
    if type(def) ~= 'table' or type(def.id) ~= 'string' or type(def.skills) ~= 'table' then
        lib.print.error('RegisterSkillTree: id and skills are required')
        return false
    end

    for _, skill in ipairs(def.skills) do
        skill.maxLevel = skill.maxLevel or 5
    end

    def.label = def.label or def.id
    trees[def.id] = def
    treeOwners[def.id] = GetInvokingResource()
    return true
end

local function GetSkillLevel(source, treeId, skillId)
    if not trees[treeId] then return 0 end
    local citizenid = getCitizenId(source)
    if not citizenid then return 0 end
    return load(citizenid, treeId).levels[skillId] or 0
end

local function GetSkillLevels(source, treeId)
    if not trees[treeId] then return {} end
    local citizenid = getCitizenId(source)
    if not citizenid then return {} end
    return lib.table.deepclone(load(citizenid, treeId).levels)
end

local function AddSkillXP(source, treeId, amount)
    local tree = trees[treeId]
    local citizenid = getCitizenId(source)
    if not tree or not citizenid or type(amount) ~= 'number' or amount <= 0 then return false end

    local entry = load(citizenid, treeId)
    local before = progress(tree, entry).level
    entry.xp = entry.xp + math.floor(amount)
    save(citizenid, treeId, entry)

    local after = progress(tree, entry).level
    if after > before then
        TriggerClientEvent('rc2_tablet:client:notify', source, {
            app = 'skills',
            title = tree.label,
            message = ('Level %d reached! You have a new skill point'):format(after),
            icon = 'fa-solid fa-arrow-up',
            color = tree.color,
        })
    end

    pushSkills(source)
    return true, after
end

exports('RegisterSkillTree', RegisterSkillTree)
exports('GetSkillLevel', GetSkillLevel)
exports('GetSkillLevels', GetSkillLevels)
exports('AddSkillXP', AddSkillXP)

--------------------------------------------------------------------------------
-- Skills app
--------------------------------------------------------------------------------

lib.callback.register('rc2_tablet:server:skills:get', function(source)
    return skillsFor(source)
end)

lib.callback.register('rc2_tablet:server:skills:upgrade', function(source, treeId, skillId)
    local tree = trees[treeId]
    local citizenid = getCitizenId(source)
    if not tree or not citizenid then return false end

    local skill
    for _, s in ipairs(tree.skills) do
        if s.id == skillId then skill = s break end
    end
    if not skill then return false end

    local entry = load(citizenid, treeId)
    local info = progress(tree, entry)
    local current = entry.levels[skillId] or 0
    if info.points < 1 or current >= skill.maxLevel then return false end

    entry.levels[skillId] = current + 1
    save(citizenid, treeId, entry)
    pushSkills(source)

    return true, skillsFor(source)
end)

AddEventHandler('onResourceStop', function(resource)
    for treeId, owner in pairs(treeOwners) do
        if owner == resource then
            trees[treeId] = nil
            treeOwners[treeId] = nil
        end
    end
end)

AddEventHandler('playerDropped', function()
    local citizenid = getCitizenId(source)
    if citizenid then cache[citizenid] = nil end
end)
