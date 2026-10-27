Config = {}

-- ═══════════════════════════════════════════════════════════════
--  General
-- ═══════════════════════════════════════════════════════════════

-- 'auto' | 'qb' | 'qbx' | 'esx' | 'standalone'
Config.Framework = 'auto'

-- 'auto' | 'ox' | 'qb' | 'none'  (used for weapon labels / durability / ammo)
Config.Inventory = 'auto'

-- Main data refresh rate (ms). Lower = smoother, higher = lighter.
Config.UpdateInterval = 100

-- Hide the HUD until the character is loaded (ignored in standalone)
Config.HideUntilLoaded = true

-- Hide the HUD while the pause menu / screen fade is active
Config.HideInPauseMenu = true

-- GTA native HUD components hidden every frame (empty table = keep native HUD)
-- 1 wanted stars, 2 weapon icon, 3 cash, 4 mp cash, 6 vehicle name,
-- 7 area name, 8 vehicle class, 9 street name, 13 cash change
Config.HideNativeComponents = { 1, 2, 3, 4, 6, 7, 8, 9, 13 }

Config.Commands = {
    toggleHud = 'hud',          -- /hud  -> show / hide the whole HUD
    toggleCompass = 'compass',  -- /compass -> show / hide the compass
}

-- ═══════════════════════════════════════════════════════════════
--  UI
-- ═══════════════════════════════════════════════════════════════

Config.UI = {
    scale = 1.0,        -- size multiplier (1.0 = designed size; auto-fits any resolution / ultrawide)
    clock12h = true,    -- clock under the map: true = 3:08 PM, false = 15:08
}

-- Colors (#rrggbb only)
Config.Colors = {
    theme   = '#3b82f6',    -- main color (light / dark / glow variants are generated)
    danger  = '#ef4444',
    hunger  = '#facc15',
    thirst  = '#22d3ee',
    stress  = '#f472b6',
    talking = '#60a5fa',
}

-- ═══════════════════════════════════════════════════════════════
--  Minimap
-- ═══════════════════════════════════════════════════════════════

Config.Minimap = {
    -- 'always' | 'vehicle' | 'never' | 'native' (native = do not touch the radar, no frame)
    show = 'vehicle',
    -- the UI measures its map frame and the native radar is placed inside it on any resolution.
    -- If it is off by a few pixels on your setup, nudge it here (screen fractions, e.g. 0.002)
    offset = { x = 0.0, y = 0.0 },
    hideHealthArmour = true,    -- hide GTA's health / armour bars under the radar
}

-- ═══════════════════════════════════════════════════════════════
--  Player bar  (player.js)
-- ═══════════════════════════════════════════════════════════════

Config.Player = {
    showStamina = true,     -- extra tile while sprinting / tired (on foot)
    showOxygen = true,      -- extra tile while under water
}

Config.Voice = {
    levels = 3,             -- number of proximity modes (pma-voice default = 3)
}

-- ═══════════════════════════════════════════════════════════════
--  Compass  (compass.js)
-- ═══════════════════════════════════════════════════════════════

Config.Compass = {
    show = 'vehicle',           -- 'always' | 'vehicle' | 'never'
    base = 'camera',            -- 'camera' | 'character'
    showZone = false,           -- show the zone name next to the street (it is always on the minimap tab)
    maxDistance = 2000.0,       -- points further than this are hidden from the tape
    maxPoints = 12,

    -- "Set waypoint" prompt: only shows when you are CLOSE to a blip and the compass is pointed at it
    prompt = {
        enabled = true,
        key = 'X',              -- default key (players can rebind it in GTA settings)
        angle = 5.0,            -- max degrees between the compass center and the blip
        maxDistance = 150.0,    -- only blips closer than this (meters) can be selected
        aimTime = 350,          -- ms the compass must stay on the blip before the prompt appears
        onFootOnly = false,
    },

    -- Static points shown on the compass
    -- sprite = GTA blip id (https://docs.fivem.net/docs/game-references/blips/)
    -- color  = optional '#rrggbb' tint (leave nil to keep the original blip colors)
    points = {
        -- { label = 'Legion Garage', sprite = 357, color = '#5ab8f2', coords = vec3(215.8, -810.0, 30.7) },
        -- { label = 'Pillbox Hospital', sprite = 61, coords = vec3(298.6, -584.5, 43.2) },
    },

    -- Automatically add map blips (by sprite) to the compass, with their real in-game color
    mapBlips = {
        enabled = true,
        scanInterval = 5000,
        useBlipColor = true,
        sprites = {
            [357] = 'Garage',
            [361] = 'Gas Station',
            [40]  = 'Home',
            [61]  = 'Hospital',
            [60]  = 'Police',
            [52]  = 'Store',
            [108] = 'Bank',
            [110] = 'Ammu-Nation',
            [73]  = 'Clothing',
            [71]  = 'Barber',
            [75]  = 'Tattoo',
            [72]  = 'Mod Shop',
            [446] = 'Mechanic',
            [100] = 'Car Wash',
        },
    },
}

-- ═══════════════════════════════════════════════════════════════
--  Weapon  (weapon.js)
-- ═══════════════════════════════════════════════════════════════

Config.Weapon = {
    enabled = true,
    showDurability = true,      -- ox_inventory durability / qb quality
    hidden = {                  -- never show these weapons
        [`WEAPON_UNARMED`] = true,
        [`WEAPON_PARACHUTE`] = true,
    },
    names = {                   -- override / add weapon names
        -- [`WEAPON_PISTOL_MK2`] = 'Pistol MK2',
    },
}

-- ═══════════════════════════════════════════════════════════════
--  Vehicle  (vehicle.js)
-- ═══════════════════════════════════════════════════════════════

Config.Vehicle = {
    enabled = true,
    unit = 'kmh',               -- 'kmh' | 'mph'
    fuel = 'auto',              -- 'auto' | 'ox_fuel' | 'LegacyFuel' | 'cdn-fuel' | 'ps-fuel' | 'lc_fuel' | 'native'
    electric = {
        `airtug`, `caddy`, `caddy2`, `caddy3`, `cyclone`, `cyclone2`, `dilettante`,
        `imorgon`, `iwagen`, `khamelion`, `neon`, `omnisegt`, `raiden`, `surge`,
        `tezeract`, `virtue`, `voltic`, `voltic2`, `envisage`, `rcbandito`,
    },
}

Config.Seatbelt = {
    enabled = true,             -- false = use an external seatbelt script (events / exports)
    key = 'B',
    blockExit = true,           -- can't leave the vehicle while buckled
    ejectSpeed = 45.0,          -- m/s min speed to fly through the windscreen when unbuckled
}

Config.Cruise = {
    enabled = true,
    key = 'CAPITAL',            -- Caps Lock
    minSpeed = 5.0,             -- m/s
}

-- ═══════════════════════════════════════════════════════════════
--  Aircraft  (aircraft.js)
-- ═══════════════════════════════════════════════════════════════

Config.Aircraft = {
    enabled = true,
    altitude = 'asl',           -- 'asl' (sea level) | 'agl' (above ground)
    invertRoll = false,         -- flip the artificial horizon if it feels reversed
}

-- ═══════════════════════════════════════════════════════════════
--  Stress
-- ═══════════════════════════════════════════════════════════════

Config.Stress = {
    enabled = true,
    ignoreJobs = { police = true, ambulance = true },
    compatEvents = true,        -- also handle hud:server:GainStress / RelieveStress (qb scripts)

    speeding = {
        enabled = true,
        interval = 10000,
        minSpeedBelted = 180,   -- km/h
        minSpeedUnbelted = 90,  -- km/h
        amount = { 1, 3 },
    },
    shooting = {
        enabled = true,
        chance = 0.1,
        amount = { 1, 5 },
        whitelist = { `WEAPON_PETROLCAN`, `WEAPON_HAZARDCAN`, `WEAPON_FIREEXTINGUISHER`, `WEAPON_STUNGUN` },
    },
    relief = {
        enabled = true,
        interval = 60000,
        amount = 1,
    },
    effects = {
        enabled = true,
        minStress = 50,         -- start blurring the screen from this level
        -- { min, max, blur ms, every ms }
        levels = {
            { 50, 70, 1500, 60000 },
            { 70, 90, 2500, 40000 },
            { 90, 101, 3500, 20000 },
        },
    },
}

-- ═══════════════════════════════════════════════════════════════
--  Labels
-- ═══════════════════════════════════════════════════════════════

Config.Labels = {
    directions = { 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW' },
    setWaypoint = 'Set waypoint',
    removeWaypoint = 'Remove waypoint',
    waypoint = 'Waypoint',
    weaponFallback = 'Weapon',
    keyMaps = {
        waypoint = 'HUD - Set / remove compass waypoint',
        seatbelt = 'HUD - Toggle seatbelt',
        cruise = 'HUD - Toggle cruise control',
    },
}
