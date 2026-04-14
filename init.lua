local utils = require("lib.utils")
local activity = require("lib.activity")
local config_store = require("lib.config")
local system_state = require("lib.system_state")
local scheduler = require("lib.scheduler")

local P = {}

local runtime = {
    devices = {},
    effects = {},
}

local function invoke(action, fn, ...)
    local packed = table.pack(pcall(fn, ...))
    local ok = packed[1]
    if not ok then
        return nil, packed[2]
    end

    if packed[2] == nil and packed[3] ~= nil then
        return nil, packed[3]
    end

    return table.unpack(packed, 2, packed.n)
end

local function emit(kind, data)
    ext.page_emit({
        type = kind,
        data = data,
    })
end

local function emit_activity()
    emit("activity", activity.list())
end

local function emit_error(action, message)
    activity.push("error", action, tostring(message or "unknown error"))
    emit("error", {
        action = action,
        message = tostring(message or "unknown error"),
    })
    emit_activity()
end

local function resolve_effect_params(params)
    if type(params) ~= "table" then
        return {}
    end

    local result = {}
    for _, param in ipairs(params) do
        if type(param) == "table" then
            local resolved = {}
            for key, value in pairs(param) do
                resolved[key] = value
            end
            resolved.label = utils.resolve_localized_text(param.label)
            resolved.group = utils.resolve_localized_text(param.group)
            if type(param.options) == "table" then
                resolved.options = {}
                for _, option in ipairs(param.options) do
                    if type(option) == "table" then
                        local resolved_option = {}
                        for key, value in pairs(option) do
                            resolved_option[key] = value
                        end
                        resolved_option.label = utils.resolve_localized_text(option.label)
                        resolved.options[#resolved.options + 1] = resolved_option
                    end
                end
            end
            result[#result + 1] = resolved
        end
    end
    return result
end

local function refresh_effects()
    local ok_effects, effects = pcall(ext.get_effects)
    if not ok_effects then
        return nil, effects
    end

    local resolved = {}
    for _, effect in ipairs(effects or {}) do
        if type(effect) == "table" then
            local next_effect = {}
            for key, value in pairs(effect) do
                next_effect[key] = value
            end
            next_effect.name = utils.resolve_localized_text(effect.name)
            next_effect.description = utils.resolve_localized_text(effect.description)
            next_effect.group = utils.resolve_localized_text(effect.group)

            local ok_params, params = pcall(ext.get_effect_params, effect.id)
            if ok_params then
                next_effect.params = resolve_effect_params(params)
            else
                next_effect.params = {}
            end

            resolved[#resolved + 1] = next_effect
        end
    end

    table.sort(resolved, function(left, right)
        return (left.name or left.id or "") < (right.name or right.id or "")
    end)

    runtime.effects = resolved
    return resolved
end

local function refresh_devices(devices)
    if type(devices) == "table" then
        runtime.devices = devices
        return devices
    end

    local ok_devices, current_devices = pcall(ext.get_devices)
    if not ok_devices then
        return nil, current_devices
    end

    runtime.devices = type(current_devices) == "table" and current_devices or {}
    return runtime.devices
end

local function emit_snapshot()
    emit("snapshot", {
        config = config_store.get(),
        devices = runtime.devices,
        effects = runtime.effects,
    })
end

local function emit_system_state()
    emit("system_state", system_state.snapshot())
end

local function emit_scheduler_state()
    emit("scheduler_state", scheduler.get_state())
end

local function recompute(reason)
    local result = scheduler.recompute(
        config_store.get(),
        system_state.snapshot(),
        reason
    )
    emit_scheduler_state()
    emit_activity()
    if type(result.errors) == "table" and #result.errors > 0 then
        emit("error", {
            action = "recompute",
            message = result.errors[1].message,
        })
    end
end

local function bootstrap()
    local ok_config, config = pcall(config_store.load)
    if not ok_config then
        emit_error("load_config", config)
    else
        activity.push("config", "Config loaded", string.format("%d rules", #(config.rules or {})))
    end

    local ok_effects, effects_err = refresh_effects()
    if not ok_effects and effects_err then
        emit_error("refresh_effects", effects_err)
    end

    local ok_devices, devices_err = refresh_devices()
    if not ok_devices and devices_err then
        emit_error("refresh_devices", devices_err)
    end

    system_state.bootstrap()
    emit_snapshot()
    emit_system_state()
    recompute("bootstrap")
end

local function save_config(config, action)
    local result, err = invoke(action or "save_config", config_store.set, config)
    if not result then
        emit_error(action or "save_config", err)
        return
    end

    activity.push("config", "Config saved", string.format("%d rules", #(config_store.get().rules or {})))
    emit_snapshot()
    recompute(action or "save_config")
    emit("save_result", {
        action = action or "save_config",
        ok = result == true,
        config = config_store.get(),
    })
end

function P.on_start()
    bootstrap()
end

function P.on_devices_changed(devices)
    local ok, err = refresh_devices(devices)
    if not ok and err then
        emit_error("on_devices_changed", err)
        return
    end
    emit_snapshot()
    recompute("devices_changed")
end

local function handle_process_change(payload)
    local event = system_state.apply_process_event(payload)
    activity.push(
        "process",
        "Process state changed",
        string.format(
            "%d changes, %d running",
            #(event.changes or {}),
            #(event.apps or {})
        )
    )
    emit_system_state()
    recompute("process_changed")
end

local function handle_focus_change(payload)
    local event = system_state.apply_focus_event(payload)
    local current = type(event.current) == "table" and event.current or {}
    activity.push(
        "focus",
        "Focus state changed",
        string.format(
            "%s | %s",
            current.app_name or "unknown",
            current.window_title or "no title"
        )
    )
    emit_system_state()
    recompute("focus_changed")
end

function P.on_system_state_changed(topic, payload)
    if topic == "process" then
        handle_process_change(payload)
        return
    end

    if topic == "window_focus" then
        handle_focus_change(payload)
    end
end

function P.on_page_message(message)
    if type(message) ~= "table" or type(message.type) ~= "string" then
        return
    end

    if message.type == "bootstrap" then
        emit_snapshot()
        emit_system_state()
        emit_scheduler_state()
        emit_activity()
        return
    end

    if message.type == "save_config" then
        save_config(message.config, "save_config")
        return
    end

    if message.type == "set_enabled" then
        local result, err = invoke("set_enabled", config_store.set_enabled, message.enabled == true)
        if not result then
            emit_error("set_enabled", err)
            return
        end
        activity.push(
            "config",
            "Automation toggled",
            message.enabled == true and "enabled" or "disabled"
        )
        emit_snapshot()
        recompute("set_enabled")
        emit("save_result", {
            action = "set_enabled",
            ok = result == true,
            config = config_store.get(),
        })
        return
    end

    if message.type == "delete_rule" then
        local rule_id = utils.trim_string(message.ruleId or message.rule_id or message.id)
        if not rule_id then
            emit_error("delete_rule", "ruleId is required")
            return
        end

        local result, err = invoke("delete_rule", config_store.delete_rule, rule_id)
        if not result then
            emit_error("delete_rule", err)
            return
        end
        activity.push("config", "Rule deleted", rule_id)
        emit_snapshot()
        recompute("delete_rule")
        emit("save_result", {
            action = "delete_rule",
            ok = result == true,
            config = config_store.get(),
        })
        return
    end

    if message.type == "reorder_rules" then
        local result, err = invoke(
            "reorder_rules",
            config_store.reorder_rules,
            message.ruleIds or message.rule_ids or message.ids
        )
        if not result then
            emit_error("reorder_rules", err)
            return
        end
        activity.push("config", "Rules reordered", "rule order updated")
        emit_snapshot()
        recompute("reorder_rules")
        emit("save_result", {
            action = "reorder_rules",
            ok = result == true,
            config = config_store.get(),
        })
        return
    end

    if message.type == "recompute" then
        recompute("manual")
        return
    end
end

return P
