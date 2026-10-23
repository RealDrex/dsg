Config = {}

-- Enables the placement commands (/battery_edit) and extra logging
Config.Debug = false

Config.JobLabel = 'Battery Assist'

--------------------------------------------------------------------------------
-- Depot (shift start)
--------------------------------------------------------------------------------
Config.Depot = {
    ped = {
        model = `s_m_m_autoshop_02`,
        coords = vec4(452.1, -571.66, 28.5, 271.67),
        scenario = 'WORLD_HUMAN_CLIPBOARD',
    },
    blip = { sprite = 354, color = 47, scale = 0.8, label = 'Battery Assist' },
    vehicleSpawns = {
        vec4(460.32, -575.37, 28.5, 167.04),
    },
    -- The player must be this close to the depot to end the shift
    returnDistance = 40.0,
}

--------------------------------------------------------------------------------
-- Service vehicle
-- Each model has its own screen and port placement (offsets relative to the vehicle)
-- negative x = left side | positive y = forward | positive z = up
-- Tune it in-game with /battery_edit screen (requires Config.Debug = true)
--------------------------------------------------------------------------------
Config.ServiceVehicle = {
    model = 'burrito3',
    plate = 'BATT',     -- plate prefix
    fuel = 100.0,
}

Config.ServiceVehicleLayouts = {
    [`burrito3`] = {
        screen = { offset = vec3(-1.045, -0.35, 0.55), width = 0.52, height = 0.39 },
        -- Positive and negative ports under the screen (where the cables come out)
        ports = { offset = vec3(-1.045, -0.35, 0.18), spacing = 0.16 },
    },
}

-- External screen (DUI)
Config.Screen = {
    resolution = { w = 640, h = 480 },
    drawDistance = 18.0,     -- the screen is drawn within this distance
    interactDistance = 1.3,  -- distance to use the screen
    camDistance = 0.75,      -- camera distance from the screen while using it
    camFov = 42.0,
    bezel = 0.03,            -- bezel thickness
}

--------------------------------------------------------------------------------
-- Cables
--------------------------------------------------------------------------------
Config.Cables = {
    -- Clamp model (swap for your custom model when it is ready)
    clampModel = `prop_tool_pliers`,
    ropeType = 1,
    -- Cable length (the slack lies on the ground)
    ropeLength = 9.0,
    -- Max distance between the port and the player before the cables snap back to the van
    maxReach = 8.5,
    -- Red in the right hand, black in the left
    hands = {
        red   = { bone = 57005, offset = vec3(0.12, 0.02, -0.02), rot = vec3(-90.0, 0.0, 0.0) },
        black = { bone = 18905, offset = vec3(0.12, 0.02, 0.02),  rot = vec3(-90.0, 0.0, 0.0) },
    },
    -- Snap distance onto a terminal
    snapDistance = 0.09,
}

--------------------------------------------------------------------------------
-- Battery in the engine bay
--------------------------------------------------------------------------------
Config.Battery = {
    model = `prop_car_battery_01`,
    -- Terminal positions relative to the battery model
    terminals = {
        red   = vec3(0.075, 0.05, 0.12),
        black = vec3(-0.075, 0.05, 0.12),
    },
    -- Default battery position: relative to the vehicle's "engine" bone
    defaultOffset = vec3(0.32, 0.1, 0.12),
    -- Per-model position (relative to the vehicle origin) - /battery_edit battery
    perModel = {
        -- [`asea`] = vec3(0.35, 1.55, 0.35),
    },
}

-- Stalled vehicles (must be front-engined)
Config.TargetVehicles = {
    'asea', 'premier', 'primo', 'stanier', 'washington', 'ingot', 'intruder', 'emperor',
}

Config.CustomerPeds = {
    `a_m_m_business_01`, `a_f_y_business_02`, `a_m_y_hipster_01`, `a_f_m_bevhills_01`,
    `a_m_m_eastsa_01`, `a_f_y_tourist_01`, `a_m_y_genstreet_01`, `a_f_m_downtown_01`,
}

Config.CustomerNames = {
    'Mike', 'Sarah', 'Jason', 'Emily', 'Carlos', 'Megan', 'Tony', 'Rachel', 'Derek', 'Nina',
}

--------------------------------------------------------------------------------
-- Call areas
-- The script picks the nearest road to each point and parks the car on the roadside
--------------------------------------------------------------------------------
Config.CallAreas = {
    { label = 'Legion Square', coords = vec3(215.0, -930.0, 30.0) },
    { label = 'Rockford Hills', coords = vec3(-560.0, -210.0, 37.0) },
    { label = 'Mirror Park',   coords = vec3(1150.0, -460.0, 66.0) },
    { label = 'Vespucci',      coords = vec3(-1280.0, -1130.0, 6.0) },
    { label = 'Davis',         coords = vec3(400.0, -1600.0, 29.0) },
    { label = 'La Mesa',       coords = vec3(820.0, -1040.0, 26.0) },
    { label = 'Little Seoul',  coords = vec3(-700.0, -930.0, 19.0) },
    { label = 'Strawberry',    coords = vec3(130.0, -1300.0, 29.0) },
}
-- Max distance allowed between the call point and the actual vehicle position
Config.CallAreaRadius = 180.0
-- The vehicle spawns once the player is within this distance
Config.SpawnDistance = 180.0

--------------------------------------------------------------------------------
-- Work and pay
--------------------------------------------------------------------------------
Config.Payment = { min = 450, max = 650, account = 'bank' }
Config.CallCooldown = { min = 15, max = 40 } -- seconds before the next call
Config.AssistDuration = 12                   -- charge duration in seconds
Config.FailChance = 0.15                      -- chance the start fails (player retries)
Config.MaxDistanceFromTarget = 8.0            -- player must be this close to the vehicle for each step

-- Contracts (shown in the tablet)
Config.Contracts = {
    { id = 'starter',  label = 'Starter Contract', description = 'Complete 3 calls within 30 minutes',  calls = 3,  time = 30, bonus = 600 },
    { id = 'city',     label = 'City Contract',    description = 'Complete 6 calls within 60 minutes',  calls = 6,  time = 60, bonus = 1600 },
    { id = 'marathon', label = 'Road Marathon',    description = 'Complete 10 calls within 90 minutes', calls = 10, time = 90, bonus = 3200 },
}

--------------------------------------------------------------------------------
-- Skills (shown and upgraded in the tablet's Skills app)
-- Each tablet level = 1 skill point (XP per level is set in rc2_tablet's config)
--------------------------------------------------------------------------------
Config.Skills = {
    xpPerCall = 100,
    xpPerContract = 250,         -- extra XP when a call completes a contract

    installSpeedPerLevel = 0.10, -- -10% charge time and handling time per level
    reliabilityPerLevel = 0.03,  -- -3% failure chance per level
    payPerLevel = 0.05,          -- +5% pay per level

    tree = {
        id = 'batteryjob',
        label = 'Battery Assist',
        icon = 'fa-solid fa-car-battery',
        color = '#ff5a1f',
        skills = {
            {
                id = 'install_speed',
                label = 'Installation Speed',
                description = 'Grab, connect and store the cables faster, and the jump starter charges quicker.',
                effect = '-10% time per level',
                icon = 'fa-solid fa-gauge-high',
                maxLevel = 5,
            },
            {
                id = 'reliability',
                label = 'Reliability',
                description = 'Better technique means the jump start fails less often.',
                effect = '-3% failure chance per level',
                icon = 'fa-solid fa-shield-halved',
                maxLevel = 5,
            },
            {
                id = 'customer_service',
                label = 'Customer Service',
                description = 'Happy customers pay more for the call.',
                effect = '+5% pay per level',
                icon = 'fa-solid fa-handshake',
                maxLevel = 5,
            },
        },
    },
}

--------------------------------------------------------------------------------
-- Animations
--------------------------------------------------------------------------------
Config.Anims = {
    takeCables  = { dict = 'pickup_object', clip = 'pickup_low', flag = 0, duration = 1200 },
    storeCables = { dict = 'pickup_object', clip = 'putdown_low', flag = 0, duration = 1200 },
    holdCables  = { dict = 'anim@heists@box_carry@', clip = 'idle', flag = 49 },
    hood        = { dict = 'mini@repair', clip = 'fixing_a_player', flag = 1 },
    screen      = { dict = 'amb@prop_human_atm@male@idle_a', clip = 'idle_a', flag = 1 },
    customerIdle = 'WORLD_HUMAN_STAND_IMPATIENT',
}

--------------------------------------------------------------------------------
-- Vehicle keys - adjust for your key script (server side)
--------------------------------------------------------------------------------
Config.GiveKeys = function(source, vehicle)
    if GetResourceState('qbx_vehiclekeys') == 'started' then
        exports.qbx_vehiclekeys:GiveKeys(source, vehicle, true)
    end
end
