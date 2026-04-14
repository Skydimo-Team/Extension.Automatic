local utils = require("lib.utils")

local M = {}

local function has_app(apps, value)
    if type(apps) ~= "table" or not value then
        return false
    end
    for _, app in ipairs(apps) do
        if type(app) == "table" and app.name == value then
            return true
        end
    end
    return false
end

local function evaluate_condition(condition, snapshot)
    if type(condition) ~= "table" then
        return false
    end

    local process_state = type(snapshot.process) == "table" and snapshot.process or {}
    local focus_state = type(snapshot.focus) == "table" and snapshot.focus or {}
    local focus_target = type(focus_state.current) == "table" and focus_state.current or {}

    if condition.kind == "app_running" then
        return has_app(process_state.apps, condition.app_name)
    end

    if condition.kind == "app_foreground" then
        return focus_target.app_name == condition.app_name
    end

    if condition.kind == "window_title_contains" then
        local title = utils.normalize_name(focus_target.window_title)
        return title ~= nil
            and condition.value ~= nil
            and string.find(title, condition.value, 1, true) ~= nil
    end

    return false
end

local function evaluate_group(group, snapshot)
    if type(group) ~= "table" then
        return false
    end

    local logic = group.logic == "or" and "or" or "and"
    local items = type(group.items) == "table" and group.items or {}
    local result = logic == "and"

    if logic == "or" then
        result = false
    end

    for _, item in ipairs(items) do
        local matched
        if type(item) == "table" and item.items ~= nil then
            matched = evaluate_group(item, snapshot)
        else
            matched = evaluate_condition(item, snapshot)
        end

        if logic == "and" and not matched then
            result = false
            break
        end

        if logic == "or" and matched then
            result = true
            break
        end
    end

    if group.negated == true then
        return not result
    end

    return result
end

function M.matches(group, snapshot)
    return evaluate_group(group or { logic = "and", items = {} }, snapshot or {})
end

return M
