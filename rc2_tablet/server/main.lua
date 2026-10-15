-- تطبيقات انضافت وقت التشغيل من ريسورسات ثانية عن طريق exports.rc2_tablet:RegisterApp
local dynamicApps = {}
-- identifier -> اسم الريسورس اللي سجّله (عشان ينحذف لما الريسورس يطفي)
local appOwners = {}

local function getAllApps()
    local apps, seen = {}, {}

    for _, app in ipairs(Config.Apps) do
        if not dynamicApps[app.identifier] then
            apps[#apps + 1] = app
            seen[app.identifier] = true
        end
    end

    for identifier, app in pairs(dynamicApps) do
        if not seen[identifier] then
            apps[#apps + 1] = app
        end
    end

    return apps
end

local function hasGroup(groups, current, onDuty)
    if not groups then return nil end
    if not current or not current.name then return false end

    local minGrade = groups[current.name]
    if not minGrade then return false end
    if onDuty and current.onduty == false then return false end

    return (current.grade and current.grade.level or 0) >= minGrade
end

local function canUseApp(player, app)
    if app.resource and GetResourceState(app.resource) ~= 'started' then
        return false
    end

    if not app.jobs and not app.gangs then
        return true
    end

    if not player then return false end

    local data = player.PlayerData
    return hasGroup(app.jobs, data.job, app.onDuty) == true
        or hasGroup(app.gangs, data.gang) == true
end

-- اللي ينرسل للواجهة (بدون الحقول الداخلية)
local function toUi(app)
    return {
        identifier = app.identifier,
        name = app.name,
        image = app.image,
        color = app.color,
        icon = app.icon,
        iconColor = app.iconColor,
        ui = app.ui,
    }
end

local function getAppsFor(source)
    local player = exports.qbx_core:GetPlayer(source)
    local list = {}

    for _, app in ipairs(getAllApps()) do
        if canUseApp(player, app) then
            list[#list + 1] = toUi(app)
        end
    end

    return list
end

local function findApp(identifier)
    if dynamicApps[identifier] then return dynamicApps[identifier] end

    for _, app in ipairs(Config.Apps) do
        if app.identifier == identifier then return app end
    end
end

lib.callback.register('rc2_tablet:server:getApps', function(source)
    return getAppsFor(source)
end)

-- يتحقق إن اللاعب مسموح له يفتح التطبيق (للتطبيقات اللي تبي تتأكد من السيرفر)
local function CanUseApp(source, identifier)
    local app = findApp(identifier)
    if not app then return false end

    return canUseApp(exports.qbx_core:GetPlayer(source), app)
end

local function refreshAll()
    TriggerClientEvent('rc2_tablet:client:refreshApps', -1)
end

--- يضيف تطبيق من ريسورس ثاني
--- exports.rc2_tablet:RegisterApp({ identifier = 'jobs', name = 'الوظائف', image = 'apps/jobs.png', ui = 'https://cfx-nui-rc2_jobs/web/build/index.html' })
local function RegisterApp(app)
    if type(app) ~= 'table' or type(app.identifier) ~= 'string' or type(app.ui) ~= 'string' then
        lib.print.error('RegisterApp: identifier و ui مطلوبين')
        return false
    end

    local invoking = GetInvokingResource()
    app.name = app.name or app.identifier
    app.resource = app.resource or invoking

    dynamicApps[app.identifier] = app
    appOwners[app.identifier] = invoking
    refreshAll()

    return true
end

local function RemoveApp(identifier)
    if not dynamicApps[identifier] then return false end

    dynamicApps[identifier] = nil
    appOwners[identifier] = nil
    TriggerClientEvent('rc2_tablet:client:removeApp', -1, identifier)
    refreshAll()

    return true
end

--- إشعار على تابلت لاعب
--- exports.rc2_tablet:Notify(source, { app = 'jobs', title = 'الوظائف', message = 'تم قبولك' })
local function Notify(source, data)
    TriggerClientEvent('rc2_tablet:client:notify', source, data)
end

--- يرسل رسالة لواجهة تطبيق مفتوح عند لاعب (توصل للـ iframe كـ phone:message)
local function SendAppMessage(source, identifier, data)
    TriggerClientEvent('rc2_tablet:client:appMessage', source, identifier, data)
end

exports('RegisterApp', RegisterApp)
exports('RemoveApp', RemoveApp)
exports('Notify', Notify)
exports('SendAppMessage', SendAppMessage)
exports('CanUseApp', CanUseApp)
exports('GetAppsFor', getAppsFor)

local function isAppResource(resource)
    for _, app in ipairs(getAllApps()) do
        if app.resource == resource then return true end
    end
    return false
end

AddEventHandler('onResourceStart', function(resource)
    if resource ~= cache.resource and isAppResource(resource) then
        refreshAll()
    end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource == cache.resource then return end

    for identifier, owner in pairs(appOwners) do
        if owner == resource then
            dynamicApps[identifier] = nil
            appOwners[identifier] = nil
            TriggerClientEvent('rc2_tablet:client:removeApp', -1, identifier)
        end
    end

    if isAppResource(resource) then
        refreshAll()
    end
end)
