local utils = require("lib.utils")

local M = {}

local CONFIG_PATH = ext.data_dir .. "/config.json"
local state = nil
local generated_rule_counter = 0

local function next_rule_id()
    generated_rule_counter = generated_rule_counter + 1
    return string.format("rule_%d_%03d", os.time(), generated_rule_counter)
end

local function normalize_boolean(value, fallback)
    if value == nil then
        return fallback
    end
    return value == true
end

local function normalize_effect_params(params)
    if type(params) ~= "table" then
        return {}
    end
    return utils.deepcopy(params)
end

local function normalize_action(action)
    if type(action) ~= "table" then
        return nil
    end

    local scope = utils.scope_from_any(action.scope)
    if not scope then
        return nil
    end

    local brightness = action.brightness
    if brightness ~= nil then
        brightness = tonumber(brightness)
        if brightness ~= nil then
            brightness = math.max(0, math.min(100, math.floor(brightness + 0.5)))
        end
    end

    local normalized = {
        scope = scope,
        effectId = utils.trim_string(action.effectId or action.effect_id),
        params = normalize_effect_params(action.params),
        brightness = brightness,
        powerOff = action.powerOff,
        paused = action.paused,
    }

    if normalized.powerOff ~= nil then
        normalized.powerOff = normalized.powerOff == true
    end
    if normalized.paused ~= nil then
        normalized.paused = normalized.paused == true
    end

    if utils.table_is_empty(normalized.params) then
        normalized.params = {}
    end

    return normalized
end

local function normalize_actions(actions)
    local normalized = {}
    if type(actions) ~= "table" then
        return normalized
    end

    for _, action in ipairs(actions) do
        local item = normalize_action(action)
        if item then
            normalized[#normalized + 1] = item
        end
    end

    return normalized
end

local function normalize_condition(condition)
    if type(condition) ~= "table" then
        return nil
    end

    local kind = string.lower(utils.trim_string(condition.kind or condition.type) or "")
    if kind == "app_running" or kind == "app_foreground" then
        local app_name = utils.normalize_name(
            condition.app_name or condition.appName or condition.value
        )
        if not app_name then
            return nil
        end
        return {
            kind = kind,
            app_name = app_name,
        }
    end

    if kind == "window_title_contains" then
        local value = utils.normalize_name(condition.value or condition.text)
        if not value then
            return nil
        end
        return {
            kind = kind,
            value = value,
        }
    end

    return nil
end

local function normalize_group(group)
    if type(group) ~= "table" then
        return {
            logic = "and",
            negated = false,
            items = {},
        }
    end

    local logic = string.lower(utils.trim_string(group.logic) or "and")
    if logic ~= "or" then
        logic = "and"
    end

    local items = {}
    if type(group.items) == "table" then
        for _, item in ipairs(group.items) do
            local normalized
            if type(item) == "table" and (item.items ~= nil or item.logic ~= nil) then
                normalized = normalize_group(item)
            else
                normalized = normalize_condition(item)
            end

            if normalized then
                items[#items + 1] = normalized
            end
        end
    end

    return {
        logic = logic,
        negated = group.negated == true,
        items = items,
    }
end

local function normalize_rule(rule, index)
    if type(rule) ~= "table" then
        return nil
    end

    return {
        id = utils.trim_string(rule.id) or next_rule_id(),
        enabled = normalize_boolean(rule.enabled, true),
        name = utils.trim_string(rule.name) or string.format("Rule %d", index),
        conditions = normalize_group(rule.conditions or rule.condition_group or rule.group),
        actions = normalize_actions(rule.actions),
    }
end

local function normalize_config(raw)
    local config = type(raw) == "table" and raw or {}
    local rules = {}

    if type(config.rules) == "table" then
        for index, rule in ipairs(config.rules) do
            local normalized = normalize_rule(rule, index)
            if normalized then
                rules[#rules + 1] = normalized
            end
        end
    end

    return {
        enabled = normalize_boolean(config.enabled, true),
        baseline = {
            actions = normalize_actions(
                type(config.baseline) == "table" and config.baseline.actions or nil
            ),
        },
        rules = rules,
    }
end

local function ensure_loaded()
    if state then
        return state
    end

    local raw = utils.read_json_file(CONFIG_PATH)
    if raw then
        state = normalize_config(raw)
    else
        state = normalize_config(nil)
    end
    return state
end

function M.load()
    return utils.deepcopy(ensure_loaded())
end

function M.get()
    return utils.deepcopy(ensure_loaded())
end

function M.save()
    ensure_loaded()
    return utils.write_json_file(CONFIG_PATH, state)
end

function M.replace(next_config)
    state = normalize_config(next_config)
    return M.get()
end

function M.set(next_config)
    M.replace(next_config)
    return M.save()
end

function M.set_enabled(enabled)
    ensure_loaded().enabled = enabled == true
    return M.save()
end

function M.delete_rule(rule_id)
    local cfg = ensure_loaded()
    local next_rules = {}
    for _, rule in ipairs(cfg.rules) do
        if rule.id ~= rule_id then
            next_rules[#next_rules + 1] = rule
        end
    end
    cfg.rules = next_rules
    return M.save()
end

function M.reorder_rules(rule_ids)
    if type(rule_ids) ~= "table" then
        return nil, "ruleIds must be an array"
    end

    local cfg = ensure_loaded()
    local order = {}
    for index, rule_id in ipairs(rule_ids) do
        local normalized = utils.trim_string(rule_id)
        if normalized then
            order[normalized] = index
        end
    end

    local previous_index = {}
    for index, rule in ipairs(cfg.rules) do
        previous_index[rule.id] = index
    end

    table.sort(cfg.rules, function(left, right)
        local left_order = order[left.id] or math.huge
        local right_order = order[right.id] or math.huge
        if left_order == right_order then
            return (previous_index[left.id] or 0) < (previous_index[right.id] or 0)
        end
        return left_order < right_order
    end)

    return M.save()
end

return M
