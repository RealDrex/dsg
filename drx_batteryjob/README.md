# drx_batteryjob — Roadside Battery Assistance

A complete job: start a shift at the depot, get a service van with a **real screen on its left side**, receive calls for stalled vehicles, pull **two real jumper cables** from the van, connect them to the battery **with the mouse**, start the charge from the screen, and get paid.

## Requirements

- `qbx_core` · `ox_lib` · `ox_target` · `oxmysql`
- `rc2_tablet` (job app + Skills app) · optional `qbx_vehiclekeys`

## Installation

1. Copy the folder and add `ensure drx_batteryjob` after `rc2_tablet`.
2. The database table is created automatically (or run `sql/install.sql`).
3. Review `config.lua`: depot, vehicle model, pay, contracts.

## Gameplay

| # | Step | How |
|---|---|---|
| 1 | Start shift | ox_target on the depot worker, the van spawns with keys |
| 2 | Call | Notification (and in the tablet), area marked on the map |
| 3 | Arrive | The car is parked on the roadside: **engine off, hazards on, impatient customer outside** |
| 4 | Talk | ox_target on the customer, camera on their face + reply options |
| 5 | Hood | `[E]` in front of the car |
| 6 | Cables | `[E]` at the ports under the screen, you hold both clamps (real rope from the van) |
| 7 | Connect | `[E]` at the hood, camera on the battery: **drag red to + then black to −** (reversed = sparks) |
| 8 | Screen | `[E]` at the screen, camera in front of it + mouse, **START ASSISTANCE** |
| 9 | Start | Charging takes a server-timed duration, the car starts or fails and you retry |
| 10 | Disconnect | `[E]` at the hood, click the clamps (**black first**) |
| 11 | Store | `[E]` at the ports, **you get paid** and the customer drives away |

## Skills

The skill tree is registered in the tablet's **Skills** app. Each call gives XP (`Config.Skills.xpPerCall`, plus a bonus when it completes a contract), every level gives one skill point.

| Skill | Effect (per level, max 5) |
|---|---|
| Installation Speed | -10% charge time, faster cable / hood animations, larger clamp snap radius |
| Reliability | -3% jump start failure chance |
| Customer Service | +5% pay |

Charge time, failure chance and pay are all computed on the server from the stored skill levels.

## Screen (DUI)

- `web/screen/index.html` is drawn onto a quad attached to the van's side (`DRAW_TEXTURED_POLY`) with a bezel and a + / − port panel. No custom model needed.
- Clicking is real: the mouse becomes a ray from the camera, hits the screen plane, and is sent with `SendDuiMouseMove/Down/Up`. `Enter` works as a fallback.
- Every nearby player sees the same state (server-driven state bag).
- Position and size per model live in `Config.ServiceVehicleLayouts`.

## In-game placement tool

Set `Config.Debug = true` and use:

- `/battery_edit screen` — screen position
- `/battery_edit ports` — port position
- `/battery_edit battery` — battery position in the nearest vehicle's engine bay

Arrows and PageUp/PageDown move, Shift for fine steps, Enter saves and copies the config line.

## Server validation

- Steps must arrive in order and the player must be next to the vehicle.
- Charge duration and outcome are decided by the server.
- Each call pays out once, and only after the cables are stored next to the van.
- The stalled vehicle position is checked to be inside the call area.

## Models

Everything currently runs on base game models: clamp `prop_tool_pliers`, battery `prop_car_battery_01`, van `burrito3`. When custom models are ready (clamps, jump starter, van) swap them in `config.lua` without touching the code.

## Files

```
config.lua            settings
client/cl_screen.lua  external screen (DUI + mouse)
client/cl_cables.lua  cables + battery + mouse connection
client/cl_job.lua     job flow + depot + tablet
client/cl_dialog.lua  customer conversation
client/cl_dev.lua     placement tool
server/sv_main.lua    shift, calls, validation, pay, contracts
web/screen            screen UI
web/app               tablet app
web/dialog            conversation UI
```
