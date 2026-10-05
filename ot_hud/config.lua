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
    scale = 0.85,       -- global multiplier (1.0 = designed size at 1080p)
    font = 'Satoshi',
}

-- Screen anchors of every panel (CSS values)
-- scale = extra size multiplier for that panel only
Config.Layout = {
    compass  = { top = '2.5%', scale = 0.85 },
    player   = { left = '3%', bottom = '6%', leftWithMinimap = '17.5%', scale = 1.0 },
    right    = { right = '3%', bottom = '6%', scale = 1.0 },   -- weapon + vehicle column
    aircraft = { bottom = '5%', scale = 1.0 },
}

-- Colors (#rrggbb only)
Config.Colors = {
    primary      = '#3b82f6',
    primaryLight = '#60a5fa',
    primaryDark  = '#1d4ed8',
    primaryPale  = '#93c5fd',
    danger       = '#ef4444',
    warning      = '#facc15',
    success      = '#4ade80',
    text         = '#ffffff',
    muted        = '#7d869a',
    mutedLight   = '#8fa3c4',

    voice        = '#60a5fa',
    radio        = '#4ade80',
    hunger       = '#facc15',
    thirst       = '#22d3ee',
    stress       = '#f472b6',
    stamina      = '#a3e635',
    oxygen       = '#38bdf8',
    durability   = '#22d3ee',
}

-- ═══════════════════════════════════════════════════════════════
--  Minimap
-- ═══════════════════════════════════════════════════════════════

Config.Minimap = {
    -- 'always' | 'vehicle' | 'never' | 'native' (native = do not touch the radar)
    show = 'vehicle',
}

-- ═══════════════════════════════════════════════════════════════
--  Player bar  (player.js)
-- ═══════════════════════════════════════════════════════════════

Config.Player = {
    -- order of the small status bars, remove one to hide it
    stats = { 'voice', 'hunger', 'thirst', 'stress' },
    lowThreshold = 20,      -- hunger / thirst / stamina / oxygen turn red under this value
    stressDanger = 80,      -- stress turns red above this value
    showStamina = true,     -- extra bar appears only while sprinting / tired
    showOxygen = true,      -- extra bar appears only while under water
}

Config.Voice = {
    levels = 3,             -- number of proximity modes (pma-voice default = 3)
}

-- ═══════════════════════════════════════════════════════════════
--  Compass  (compass.js)
-- ═══════════════════════════════════════════════════════════════

Config.Compass = {
    show = 'always',            -- 'always' | 'vehicle' | 'never'
    base = 'camera',            -- 'camera' | 'character'
    hideInAircraft = false,
    showZone = false,           -- show the zone name next to the street
    updateInterval = 100,       -- ms (the UI interpolates between updates)
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
    showMelee = true,           -- show name card for melee weapons
    showDurability = true,      -- ox_inventory durability / qb quality
    hideInAircraft = true,
    maxSegments = 30,           -- max number of round segments drawn
    lowAmmo = 0.25,             -- magazine turns red under this ratio
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
    redline = 0.85,             -- rpm (0-1) where the gear box turns red
    lowFuel = 20,
    beltWarningSpeed = 20,      -- belt icon blinks when unbuckled above this speed (in unit above)
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
    pitchScale = 1.5,           -- px of horizon movement per degree of pitch
    lowFuel = 20,
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
    reloading = 'RELOADING',
    durability = 'DUR',
    kmh = 'KM/H',
    mph = 'MPH',
    airspeed = 'AIRSPEED',
    altitude = 'ALTITUDE',
    knots = 'KTS',
    feet = 'FT',
    fpm = 'FPM',
    throttle = 'THR',
    fuel = 'FUEL',
    engine = 'ENG',
    gearUp = 'GEAR UP',
    gearDown = 'GEAR DOWN',
    gearMoving = 'GEAR ...',
    rotor = 'ROTOR',
    weaponFallback = 'Weapon',
    weaponTypes = {
        pistol = 'PISTOL', smg = 'SMG', rifle = 'RIFLE', mg = 'MACHINE GUN',
        shotgun = 'SHOTGUN', sniper = 'SNIPER', heavy = 'HEAVY', throwable = 'THROWABLE',
        melee = 'MELEE', misc = 'EQUIPMENT',
    },
    keyMaps = {
        waypoint = 'HUD - Set / remove compass waypoint',
        seatbelt = 'HUD - Toggle seatbelt',
        cruise = 'HUD - Toggle cruise control',
    },
}
