Config = {}

-- ox_inventory item name (must be defined in ox_inventory/data/items.lua)
Config.Item = 'tablet'

-- Command to open the tablet (false to disable). With RequireItem = true the player needs the item
Config.Command = 'tablet'
Config.RequireItem = true

-- Keybind to open the tablet (false to disable). Players can rebind it in the game settings
Config.Keybind = false -- e.g. 'F5'

-- Prop and animation while the tablet is open
Config.Prop = {
    model = `prop_cs_tablet`,
    bone = 28422,
    offset = vec3(-0.05, 0.0, 0.0),
    rotation = vec3(0.0, 0.0, 0.0),
}

Config.Anim = {
    dict = 'amb@code_human_in_bus_passenger_idles@female@tablet@base',
    clip = 'base',
}

-- UI colors (sent to the tablet and to every app inside it)
Config.Theme = {
    color1 = '#ff5a1f', -- primary color
    color2 = '#1c1c1e',
    color3 = '#ffffff',
}

--[[
    Apps
    Each app is a separate resource with its own UI (an iframe inside the tablet).

    identifier : unique app id
    name       : label shown under the icon
    image      : icon image (from web/build/apps) or a URL
    color      : background color when there is no image
    resource   : the app's resource name. Hidden while that resource is not started
    ui         : app UI URL (https://cfx-nui-<resource>/<path>)
    jobs       : optional - { police = 0, ambulance = 2 } (job = minimum grade)
    gangs      : optional - same as jobs, for gangs
    onDuty     : optional - true = must be on duty
]]
Config.Apps = {
    {
        identifier = 'batteryjob',
        name = 'Battery Assist',
        icon = 'fa-solid fa-car-battery',
        iconColor = '#ffffff',
        color = '#ff5a1f',
        resource = 'drx_batteryjob',
        ui = 'https://cfx-nui-drx_batteryjob/web/app/index.html',
    },
    {
        -- Built-in skills app (skill trees are registered by each job resource)
        identifier = 'skills',
        name = 'Skills',
        image = 'apps/skilltree.png',
        color = '#1c1c1e',
        ui = 'https://cfx-nui-rc2_tablet/web/apps/skills/index.html',
    },
    {
        identifier = 'jobs',
        name = 'Jobs',
        image = 'apps/jobs.png',
        color = '#1c1c1e',
        resource = 'rc2_jobs',
        ui = 'https://cfx-nui-rc2_jobs/web/build/index.html',
    },

    -- Apps to add over time (icons are already in web/build/apps):
    -- { identifier = 'mdt',        name = 'MDT',      image = 'apps/mdt.png',        resource = 'rc2_mdt',        ui = 'https://cfx-nui-rc2_mdt/web/build/index.html', jobs = { police = 0 }, onDuty = true },
    -- { identifier = 'hotel',      name = 'Hotel',    image = 'apps/hotel.png',      resource = 'rc2_hotel',      ui = 'https://cfx-nui-rc2_hotel/web/build/index.html' },
    -- { identifier = 'furniture',  name = 'Furniture', image = 'apps/furniture.png',  resource = 'rc2_furniture',  ui = 'https://cfx-nui-rc2_furniture/web/build/index.html' },
    -- { identifier = 'managment',  name = 'Management', image = 'apps/managment.png',  resource = 'rc2_managment',  ui = 'https://cfx-nui-rc2_managment/web/build/index.html' },
    -- { identifier = 'supply',     name = 'Supply',   image = 'apps/supply.png',     resource = 'rc2_supply',     ui = 'https://cfx-nui-rc2_supply/web/build/index.html' },
    -- { identifier = 'skilltree',  name = 'Skills',   image = 'apps/skilltree.png',  resource = 'rc2_skilltree',  ui = 'https://cfx-nui-rc2_skilltree/web/build/index.html' },
}

-- Skills: XP needed per level (each level = 1 skill point)
Config.Skills = {
    xpPerLevel = 300,
}
