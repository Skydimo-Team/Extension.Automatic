local utils = require("lib.utils")

local M = {}

local state = {
    process = {
        supported = false,
        apps = {},
    },
    focus = {
        supported = false,
        current = nil,
    },
}

local function read_system_topic(topic)
    if type(ext.get_system_state) ~= "function" then
        return nil
    end

    local ok, snapshot = pcall(ext.get_system_state, topic)
    if ok and type(snapshot) == "table" then
        return snapshot
    end

    return nil
end

local function is_supported(snapshot)
    return type(snapshot) == "table" and snapshot.supported ~= false
end

local function normalize_process_apps(values)
    local result = {}
    local seen = {}
    if type(values) ~= "table" then
        return result
    end

    for _, entry in ipairs(values) do
        if type(entry) == "table" then
            local name = utils.normalize_name(entry.name)
            local instance_count = math.max(
                0,
                math.floor(tonumber(entry.instance_count or entry.instances) or 0)
            )
            if name and not seen[name] then
                seen[name] = true
                result[#result + 1] = {
                    name = name,
                    instance_count = instance_count,
                }
            end
        end
    end

    table.sort(result, function(left, right)
        return left.name < right.name
    end)
    return result
end

local function normalize_process_changes(values)
    local result = {}
    if type(values) ~= "table" then
        return result
    end

    for _, entry in ipairs(values) do
        if type(entry) == "table" then
            local name = utils.normalize_name(entry.name)
            if name then
                result[#result + 1] = {
                    name = name,
                    previous_instance_count = math.max(
                        0,
                        math.floor(tonumber(entry.previous_instance_count) or 0)
                    ),
                    current_instance_count = math.max(
                        0,
                        math.floor(tonumber(entry.current_instance_count) or 0)
                    ),
                }
            end
        end
    end

    table.sort(result, function(left, right)
        return left.name < right.name
    end)
    return result
end

local function normalize_focus_target(target)
    if type(target) ~= "table" then
        return nil
    end

    local app_name = utils.normalize_name(target.app_name)
    local window_title = utils.normalize_text(target.window_title)
    if app_name or window_title then
        return {
            app_name = app_name,
            window_title = window_title,
        }
    end

    return nil
end

local function normalize_process_payload(payload)
    local event = type(payload) == "table" and payload or {}

    return {
        supported = is_supported(event),
        apps = normalize_process_apps(event.apps),
        changes = normalize_process_changes(event.changes),
    }
end

local function normalize_focus_payload(payload)
    local event = type(payload) == "table" and payload or {}

    return {
        supported = is_supported(event),
        reason = utils.trim_string(event.reason) or "snapshot",
        current = normalize_focus_target(event.current),
        previous = normalize_focus_target(event.previous),
    }
end

function M.bootstrap()
    local process_state = normalize_process_payload(read_system_topic("process"))
    state.process.supported = process_state.supported
    state.process.apps = process_state.apps

    local focus_state = normalize_focus_payload(read_system_topic("window_focus"))
    state.focus.supported = focus_state.supported
    state.focus.current = focus_state.current

    return M.snapshot()
end

function M.apply_process_event(payload)
    local normalized = normalize_process_payload(payload)
    state.process.supported = normalized.supported
    state.process.apps = normalized.apps
    return normalized
end

function M.apply_focus_event(payload)
    local normalized = normalize_focus_payload(payload)
    state.focus.supported = normalized.supported
    state.focus.current = normalized.current
    return normalized
end

function M.snapshot()
    return {
        process = {
            supported = state.process.supported,
            apps = utils.deepcopy(state.process.apps),
        },
        focus = {
            supported = state.focus.supported,
            current = utils.deepcopy(state.focus.current),
        },
    }
end

return M
