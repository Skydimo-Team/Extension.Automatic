use super::*;

fn known_snapshot() -> Value {
    json!({
        "process": { "apps": [{ "name": "game.exe" }] },
        "focus": { "current": { "app_name": "game.exe", "window_title": "level 1" } },
        "media": { "supported": true, "available": true,
            "playback_status": "playing", "source_app_id": "test.player" },
    })
}

fn restored_conditions(group: Value) -> Value {
    let config = normalize_config(json!({ "rules": [{ "id": "test", "conditions": group }] }));
    let restored = normalize_config(serde_json::from_str(&config.to_string()).unwrap());
    assert_eq!(config, restored, "normalization must be idempotent");
    restored["rules"][0]["conditions"].clone()
}

#[test]
fn unknown_and_invalid_conditions_survive_save_and_block_entire_nested_rule() {
    let leaves = [
        json!({ "kind": "future_condition", "payload": { "threshold": 0.5 } }),
        json!({ "kind": "future_condition", "logic": "or", "items": [{ "kind": "media_playing" }] }),
        json!({ "type": "future_condition", "logic": "and", "items": [] }),
        json!({ "payload": [1, 2, 3] }),
        json!({ "kind": "app_running" }),
        json!({ "kind": "app_running", "app_name": "" }),
        json!({ "kind": "app_foreground", "app_name": "  " }),
        json!({ "kind": "app_running", "app_name": false }),
        json!({ "kind": "app_running", "app_name": 5 }),
        json!({ "kind": "app_foreground", "app_name": [] }),
        json!({ "kind": "window_title_contains" }),
        json!({ "kind": "window_title_contains", "value": 5 }),
        json!({ "kind": "window_title_contains", "value": false }),
        json!({ "kind": "window_title_contains", "value": {} }),
        json!({ "kind": "media_source_app", "source_app_id": null }),
        json!({ "logic": "or" }),
        json!({ "logic": "xor", "items": [] }),
        json!({ "logic": "and", "items": "invalid" }),
        json!({ "logic": "and", "negated": "true", "items": [] }),
        Value::Null, json!(false), json!(1), json!("future"), json!([]),
    ];
    for leaf in leaves {
        for logic in ["and", "or"] {
            for negated in [false, true] {
                let inner = json!({ "logic": logic, "negated": negated, "items": [leaf] });
                let restored = restored_conditions(inner.clone());
                assert_eq!(restored["items"][0], leaf, "must retain {leaf}");
                assert!(!matches_group(&restored, &known_snapshot()), "must block {restored}");
                for order in [false, true] {
                    let true_condition = json!({ "kind": "app_running", "app_name": "game.exe" });
                    let items = if order { json!([inner, true_condition]) } else { json!([true_condition, inner]) };
                    let outer = restored_conditions(json!({ "logic": logic, "negated": negated, "items": items }));
                    assert!(!matches_group(&outer, &known_snapshot()), "nested rule must block {outer}");
                }
            }
        }
    }
}

#[test]
fn malformed_roots_are_not_empty_groups_and_explicit_empty_groups_keep_semantics() {
    for root in [Value::Null, json!({}), json!({ "logic": "and" }),
        json!({ "kind": "future_condition", "items": [] }), json!(false)]
    {
        let normalized = restored_conditions(root.clone());
        assert_eq!(normalized["items"], json!([root]));
        assert!(!matches_group(&normalized, &known_snapshot()));
    }
    for logic in ["and", "or"] {
        for negated in [false, true] {
            let group = restored_conditions(json!({ "logic": logic, "negated": negated, "items": [] }));
            assert_eq!(matches_group(&group, &known_snapshot()), (logic == "and") != negated);
        }
    }
    assert!(matches_group(&normalize_group(None), &known_snapshot()));
}

#[test]
fn unrelated_rule_and_baseline_saves_preserve_media_and_opaque_conditions() {
    let group = json!({ "logic": "and", "negated": false, "items": [
        { "kind": "media_playing" },
        { "kind": "media_source_app", "source_app_id": "test.player" },
        { "kind": "future_condition", "items": [{ "nested": true }], "logic": "opaque" },
    ] });
    let mut config = normalize_config(json!({ "rules": [
        { "id": "preserved", "conditions": group },
        { "id": "edited", "conditions": { "items": [] } },
    ] }));
    config["rules"][1]["name"] = json!("renamed unrelated rule");
    config["baseline"]["actions"] = json!([{ "scope": { "port": "fixture" }, "brightness": 50 }]);
    let restored = normalize_config(serde_json::from_str(&config.to_string()).unwrap());
    assert_eq!(restored["rules"][0]["conditions"], group);
    assert!(!matches_group(&restored["rules"][0]["conditions"], &known_snapshot()));
}

#[test]
fn supported_conditions_keep_normalization_and_media_unavailability_guard() {
    let group = restored_conditions(json!({ "items": [
        { "type": "APP_RUNNING", "appName": " Game.exe " },
        { "kind": "app_foreground", "value": "Game.exe" },
        { "kind": "window_title_contains", "text": "LEVEL" },
        { "kind": "media_playing" },
        { "kind": "media_source_app", "source_app_id": " TEST.PLAYER " },
    ] }));
    assert!(matches_group(&group, &known_snapshot()));
    // A media leaf's own items must never bypass unknown-media preflight.
    let direct = json!({ "logic": "and", "negated": true, "items": [
        { "kind": "media_playing", "items": [] },
    ] });
    assert!(!matches_group(&direct, &json!({})));
}
