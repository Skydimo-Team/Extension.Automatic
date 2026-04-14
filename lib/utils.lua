local M = {}

local function is_sequence(tbl)
    if type(tbl) ~= "table" then
        return false
    end

    local count = 0
    for key in pairs(tbl) do
        if type(key) ~= "number" or key <= 0 or key % 1 ~= 0 then
            return false
        end
        count = count + 1
    end

    for index = 1, count do
        if tbl[index] == nil then
            return false
        end
    end

    return true
end

function M.deepcopy(value)
    if type(value) ~= "table" then
        return value
    end

    local result = {}
    for key, entry in pairs(value) do
        result[M.deepcopy(key)] = M.deepcopy(entry)
    end
    return result
end

function M.trim_string(value)
    if value == nil then
        return nil
    end

    local text = tostring(value)
    text = text:gsub("^%s+", ""):gsub("%s+$", "")
    if text == "" then
        return nil
    end

    return text
end

function M.normalize_name(value)
    local text = M.trim_string(value)
    if not text then
        return nil
    end
    return string.lower(text)
end

function M.normalize_text(value)
    return M.trim_string(value)
end

function M.normalize_string_list(values, normalize)
    local result = {}
    local seen = {}
    if type(values) ~= "table" then
        return result
    end

    local normalizer = normalize or M.normalize_name
    for _, value in ipairs(values) do
        local normalized = normalizer(value)
        if normalized and not seen[normalized] then
            seen[normalized] = true
            result[#result + 1] = normalized
        end
    end

    table.sort(result)
    return result
end

function M.scope_from_any(value)
    if type(value) ~= "table" then
        return nil
    end

    local port = M.trim_string(value.port)
    if not port then
        return nil
    end

    local output_id = M.trim_string(value.output_id or value.outputId)
    local segment_id = M.trim_string(value.segment_id or value.segmentId)
    if segment_id and not output_id then
        return nil
    end

    return {
        port = port,
        output_id = output_id,
        segment_id = segment_id,
    }
end

function M.scope_key(scope)
    local normalized = M.scope_from_any(scope)
    if not normalized then
        return nil
    end

    return table.concat({
        normalized.port,
        normalized.output_id or "",
        normalized.segment_id or "",
    }, "::")
end

function M.table_is_empty(value)
    return type(value) ~= "table" or next(value) == nil
end

local function stable_serialize(value)
    local value_type = type(value)
    if value_type == "nil" then
        return "null"
    end
    if value_type == "boolean" then
        return value and "true" or "false"
    end
    if value_type == "number" then
        return tostring(value)
    end
    if value_type == "string" then
        return string.format("%q", value)
    end
    if value_type ~= "table" then
        return string.format("%q", tostring(value))
    end

    if is_sequence(value) then
        local parts = {}
        for index = 1, #value do
            parts[#parts + 1] = stable_serialize(value[index])
        end
        return "[" .. table.concat(parts, ",") .. "]"
    end

    local keys = {}
    for key in pairs(value) do
        keys[#keys + 1] = tostring(key)
    end
    table.sort(keys)

    local parts = {}
    for _, key in ipairs(keys) do
        parts[#parts + 1] = string.format("%q:%s", key, stable_serialize(value[key]))
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

function M.stable_signature(value)
    return stable_serialize(value)
end

function M.read_json_file(path)
    local file, err = io.open(path, "r")
    if not file then
        return nil, err
    end

    local content = file:read("*a")
    file:close()

    if not content or content == "" then
        return nil, "empty file"
    end

    local ok, decoded = pcall(ext.json_decode, content)
    if not ok then
        return nil, decoded
    end

    return decoded
end

function M.write_json_file(path, value)
    local ok, encoded = pcall(ext.json_encode, value)
    if not ok then
        return nil, encoded
    end

    local file, err = io.open(path, "w")
    if not file then
        return nil, err
    end

    file:write(encoded)
    file:close()
    return true
end

function M.iso_now()
    return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

function M.resolve_localized_text(value)
    if type(value) == "table" then
        if type(value.byLocale) == "table" then
            return value.byLocale["zh-CN"]
                or value.byLocale["en-US"]
                or value.byLocale["en"]
                or value.raw
                or ""
        end
        return value.raw or ""
    end

    return tostring(value or "")
end

return M
