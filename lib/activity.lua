local utils = require("lib.utils")

local M = {}

local entries = {}
local counter = 0
local MAX_ENTRIES = 120

function M.push(kind, title, detail)
    counter = counter + 1
    local entry = {
        id = string.format("%s-%03d", os.time(), counter),
        timestamp = utils.iso_now(),
        kind = kind or "info",
        title = title or "",
        detail = detail,
    }

    table.insert(entries, 1, entry)
    while #entries > MAX_ENTRIES do
        table.remove(entries)
    end

    return entry
end

function M.list()
    return utils.deepcopy(entries)
end

return M
