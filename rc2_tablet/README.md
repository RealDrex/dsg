# rc2_tablet

The tablet is only a **launcher** (home screen + notifications + settings). Every app (jobs, real estate, MDT...) is a separate resource with its own UI, opened inside the tablet as an iframe.

## Requirements

- `qbx_core`
- `ox_lib`
- `oxmysql`
- `ox_inventory`

## Installation

1. Copy `rc2_tablet` into your resources and add `ensure rc2_tablet` after `qbx_core`, `ox_lib` and `ox_inventory`.
2. Define the item in `ox_inventory/data/items.lua`:

```lua
['tablet'] = {
    label = 'Tablet',
    weight = 500,
    stack = false,
    close = true,
    client = { export = 'rc2_tablet.useTablet' },
},
```

3. The UI language follows `setr ox:locale` in `server.cfg` (falls back to English).

## Adding an app

**Option 1 – from the config** (`config.lua` → `Config.Apps`):

```lua
{
    identifier = 'jobs',
    name = 'Jobs',
    image = 'apps/jobs.png',
    resource = 'rc2_jobs', -- hidden while this resource is not started
    ui = 'https://cfx-nui-rc2_jobs/web/build/index.html',
    jobs = { police = 0 }, -- optional
    onDuty = true,         -- optional
}
```

**Option 2 – from the app's own resource (server):**

```lua
exports.rc2_tablet:RegisterApp({
    identifier = 'jobs',
    name = 'Jobs',
    image = 'apps/jobs.png',
    ui = ('https://cfx-nui-%s/web/build/index.html'):format(GetCurrentResourceName()),
})
```

It is removed automatically when that resource stops.

## Built-in apps

- **Battery Assist** (`drx_batteryjob`) — shown while that resource is running.
- **Skills** — skill trees registered by job resources. XP per level: `Config.Skills.xpPerLevel`, each level = 1 skill point.

## Skills API (server)

```lua
exports.rc2_tablet:RegisterSkillTree({
    id = 'batteryjob', label = 'Battery Assist', icon = 'fa-solid fa-car-battery', color = '#ff5a1f',
    skills = {
        { id = 'install_speed', label = 'Installation Speed', description = '...', effect = '-10% time per level', maxLevel = 5 },
    },
})

exports.rc2_tablet:AddSkillXP(source, 'batteryjob', 100)
exports.rc2_tablet:GetSkillLevel(source, 'batteryjob', 'install_speed') -- 0..maxLevel
exports.rc2_tablet:GetSkillLevels(source, 'batteryjob')                -- { install_speed = 2, ... }
```

Progress is saved in the `rc2_tablet_skills` table (created automatically). The tree is removed when the resource that registered it stops.

## App UI <-> tablet messaging

Inside the app UI (the iframe):

```js
// close the app
window.parent.postMessage({ action: 'phone:close' }, '*')

// notification
window.parent.postMessage({ action: 'phone:notify', data: { title: 'Jobs', message: 'You were hired' } }, '*')

// messages from Lua + theme colors
window.addEventListener('message', (e) => {
    if (e.data.action === 'phone:message') { /* e.data.data */ }
    if (e.data.action === 'phone:theme')   { /* e.data.data.color1 ... */ }
})

// NUI callbacks go to the app's own resource
fetch('https://rc2_jobs/getJobs', { method: 'POST', body: JSON.stringify({}) })
```

## Exports

**Client**

| Export | Description |
|---|---|
| `open()` / `close()` / `isOpen()` | Open / close the tablet |
| `openApp(id)` / `closeApp(id)` | Open a specific app |
| `notify(data)` | Notification `{ title, message, icon, iconColor, image, app }` |
| `sendAppMessage(id, data)` | Message to an app UI |
| `refreshApps()` | Refresh the app list |

**Server**

| Export | Description |
|---|---|
| `RegisterApp(app)` / `RemoveApp(id)` | Add / remove an app |
| `Notify(source, data)` | Notification on a player's tablet |
| `SendAppMessage(source, id, data)` | Message to an app UI on a player's tablet |
| `CanUseApp(source, id)` | Whether a player may use an app |
| `GetAppsFor(source)` | Apps available to a player |

**Events (client)**: `rc2_tablet:client:opened`, `rc2_tablet:client:closed`, `rc2_tablet:client:appOpened (id)`, `rc2_tablet:client:appClosed (id)`
