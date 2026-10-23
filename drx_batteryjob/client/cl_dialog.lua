Dialog = {}

local pending

--- Shows a line of dialogue with options and returns the chosen index
---@param data { name: string, text: string, options: { label: string }[] }
function Dialog.show(data)
    pending = promise.new()
    SetNuiFocus(true, true)
    SendNUIMessage({ action = 'dialog', data = data })
    return Citizen.Await(pending)
end

function Dialog.close()
    SendNUIMessage({ action = 'dialogClose' })
    SetNuiFocus(false, false)
    if pending then
        local p = pending
        pending = nil
        p:resolve(nil)
    end
end

RegisterNUICallback('dialog:choose', function(data, cb)
    cb({})
    if pending then
        local p = pending
        pending = nil
        p:resolve(data.index)
    end
end)

--- Full conversation with a camera on the speaker's face
---@param ped number
---@param script { text: string, options: { label: string, next?: number }[] }[]
function Dialog.conversation(ped, name, script)
    local head = GetPedBoneCoords(ped, 31086, 0.0, 0.0, 0.0)
    local fwd = GetEntityForwardVector(ped)
    local camPos = head + fwd * 0.9 + vec3(0.0, 0.0, 0.05)

    TaskTurnPedToFaceEntity(ped, cache.ped, 1000)
    TaskTurnPedToFaceEntity(cache.ped, ped, 1000)
    Wait(600)

    local cam = CreateCamWithParams('DEFAULT_SCRIPTED_CAMERA', camPos.x, camPos.y, camPos.z, 0.0, 0.0, 0.0, 40.0, false, 0)
    PointCamAtCoord(cam, head.x, head.y, head.z)
    SetCamActive(cam, true)
    RenderScriptCams(true, true, 600, true, true)

    local index = 1
    while index and script[index] do
        local line = script[index]
        PlayPedAmbientSpeechNative(ped, line.speech or 'GENERIC_HI', 'SPEECH_PARAMS_FORCE_NORMAL', 0)
        local choice = Dialog.show({ name = name, text = line.text, options = line.options })
        local option = choice and line.options[choice]
        index = option and option.next or nil
    end

    Dialog.close()
    RenderScriptCams(false, true, 600, true, true)
    DestroyCam(cam, false)
end
