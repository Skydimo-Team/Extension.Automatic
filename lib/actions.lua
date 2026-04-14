local utils = require("lib.utils")

local M = {}

local applied_signatures = {}
local current_plan_key = nil

local function normalize_action_signature(action)
    local normalized = {
        scope = utils.scope_from_any(action.scope),
        effectId = action.effectId,
        params = action.params or {},
        brightness = action.brightness,
        powerOff = action.powerOff,
        paused = action.paused,
    }
    return utils.stable_signature(normalized)
end

local function execute_action(action)
    local scope = utils.scope_from_any(action.scope)
    if not scope then
        return nil, "invalid scope"
    end

    if action.powerOff == false then
        ext.set_scope_power(scope, false)
    end

    if action.effectId then
        ext.set_scope_effect(scope, action.effectId, action.params)
    elseif not utils.table_is_empty(action.params) then
        ext.update_scope_effect_params(scope, action.params)
    end

    if action.brightness ~= nil then
        ext.set_scope_brightness(scope, action.brightness)
    end

    if action.paused ~= nil then
        ext.set_scope_mode_paused(scope, action.paused == true)
    end

    if action.powerOff == true then
        ext.set_scope_power(scope, true)
    end

    return true
end

function M.apply(plan_key, actions)
    local next_signatures = {}
    local result = {
        applied = {},
        skipped = {},
        errors = {},
    }

    if not plan_key then
        current_plan_key = nil
        applied_signatures = {}
        return result
    end

    for _, action in ipairs(actions or {}) do
        local scope_key = utils.scope_key(action.scope)
        local signature = normalize_action_signature(action)
        if scope_key then
            next_signatures[scope_key] = signature
        end

        if scope_key
            and current_plan_key == plan_key
            and applied_signatures[scope_key] == signature then
            result.skipped[#result.skipped + 1] = {
                scope = utils.scope_from_any(action.scope),
            }
        else
            local ok, err = pcall(execute_action, action)
            if ok then
                result.applied[#result.applied + 1] = {
                    scope = utils.scope_from_any(action.scope),
                }
            else
                result.errors[#result.errors + 1] = {
                    scope = utils.scope_from_any(action.scope),
                    message = tostring(err),
                }
            end
        end
    end

    current_plan_key = plan_key
    applied_signatures = next_signatures
    return result
end

return M
