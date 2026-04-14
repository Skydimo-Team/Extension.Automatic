local utils = require("lib.utils")
local matcher = require("lib.matcher")
local actions = require("lib.actions")
local activity = require("lib.activity")

local M = {}

local state = {
    enabled = true,
    matchedRuleIds = {},
    activeRuleId = nil,
    activeSource = "none",
    activeName = nil,
    activeActions = {},
    rules = {},
    lastRecomputeAt = nil,
    lastAppliedAt = nil,
    lastErrors = {},
}

local previous_summary = nil

local function sorted_candidates(config, snapshot)
    local candidates = {}
    local rule_rows = {}

    for index, rule in ipairs(config.rules or {}) do
        local matched = rule.enabled ~= false and matcher.matches(rule.conditions, snapshot)
        rule_rows[#rule_rows + 1] = {
            id = rule.id,
            name = rule.name,
            enabled = rule.enabled ~= false,
            matched = matched,
            active = false,
        }

        if matched then
            candidates[#candidates + 1] = {
                index = index,
                rule = rule,
            }
        end
    end

    table.sort(candidates, function(left, right)
        return left.index < right.index
    end)

    return candidates, rule_rows
end

function M.recompute(config, snapshot, reason)
    local normalized_config = type(config) == "table" and config or {}
    local normalized_snapshot = type(snapshot) == "table" and snapshot or {}
    local candidates, rule_rows = sorted_candidates(normalized_config, normalized_snapshot)
    local active_rule = candidates[1] and candidates[1].rule or nil
    local baseline_actions = type(normalized_config.baseline) == "table"
            and normalized_config.baseline.actions
        or {}
    local baseline_active = active_rule == nil and #baseline_actions > 0
    local plan_key = nil
    local active_actions = {}
    local active_source = "none"
    local active_name = nil

    if normalized_config.enabled == false then
        plan_key = nil
    elseif active_rule then
        plan_key = "rule:" .. active_rule.id
        active_actions = active_rule.actions or {}
        active_source = "rule"
        active_name = active_rule.name
    elseif baseline_active then
        plan_key = "baseline"
        active_actions = baseline_actions
        active_source = "baseline"
        active_name = "Baseline"
    end

    for _, row in ipairs(rule_rows) do
        row.active = active_rule ~= nil and row.id == active_rule.id
    end

    local apply_result = actions.apply(plan_key, active_actions)
    local now = utils.iso_now()

    state.enabled = normalized_config.enabled ~= false
    state.matchedRuleIds = {}
    for _, candidate in ipairs(candidates) do
        state.matchedRuleIds[#state.matchedRuleIds + 1] = candidate.rule.id
    end
    state.activeRuleId = active_rule and active_rule.id or nil
    state.activeSource = active_source
    state.activeName = active_name
    state.activeActions = utils.deepcopy(active_actions)
    state.rules = rule_rows
    state.lastRecomputeAt = now
    state.lastErrors = apply_result.errors
    if #apply_result.applied > 0 then
        state.lastAppliedAt = now
    end

    local summary = utils.stable_signature({
        enabled = state.enabled,
        matchedRuleIds = state.matchedRuleIds,
        activeRuleId = state.activeRuleId,
        activeSource = state.activeSource,
        lastErrors = state.lastErrors,
    })

    if previous_summary ~= summary or #apply_result.applied > 0 or #apply_result.errors > 0 then
        local detail
        if state.activeSource == "rule" then
            detail = string.format(
                "Applied rule %s (%s) after %s",
                state.activeName or state.activeRuleId or "unknown",
                state.activeRuleId or "n/a",
                reason or "recompute"
            )
        elseif state.activeSource == "baseline" then
            detail = string.format("Applied baseline after %s", reason or "recompute")
        elseif state.enabled == false then
            detail = "Automation disabled, scheduler is idle"
        else
            detail = string.format("No rule matched after %s", reason or "recompute")
        end
        activity.push("scheduler", "Scheduler recomputed", detail)
    end

    for _, error in ipairs(apply_result.errors) do
        activity.push("error", "Action apply failed", error.message)
    end

    previous_summary = summary
    return {
        state = M.get_state(),
        applied = apply_result.applied,
        errors = apply_result.errors,
    }
end

function M.get_state()
    return utils.deepcopy(state)
end

return M
