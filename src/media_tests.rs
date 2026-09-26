use super::*;

fn playing_group() -> Value {
    json!({ "logic": "and", "negated": false, "items": [{ "kind": "media_playing" }] })
}

fn snapshot(payload: Value) -> Value {
    json!({ "media": media::MediaSnapshot::from_host(&payload, true) })
}

#[test]
fn startup_uses_existing_host_snapshot_and_keeps_only_rule_inputs() {
    let media = media::MediaSnapshot::read_with(true, |method, request| {
        assert_eq!(method, "get_media_session");
        assert_eq!(request, &json!({ "max_edge": 1 }));
        Ok(json!({
            "playback_status": "playing", "source_app_id": "  Test.Player_123!App  ",
            "title": "private title", "artist": "private artist", "artwork": [1, 2, 3],
        }))
    });
    assert_eq!(serde_json::to_value(media).unwrap(), json!({
        "supported": true, "available": true, "playback_status": "playing",
        "source_app_id": "test.player_123!app",
    }));
}

#[test]
fn unsupported_does_not_query_host_or_accept_a_session() {
    let media = media::MediaSnapshot::read_with(false, |_, _| panic!("unsupported Host query"));
    let from_event = media::MediaSnapshot::from_host(&json!({ "playback_status": "playing" }), false);
    assert_eq!(media, from_event);
    let snapshot = json!({ "media": media });
    let mut group = playing_group();
    assert!(!matches_group(&group, &snapshot));
    group["negated"] = json!(true);
    assert!(!matches_group(&group, &snapshot));
}

#[test]
fn missing_invalid_and_failed_snapshots_are_unknown_not_false() {
    let payloads = [Value::Null, json!({}), json!({ "playback_status": "unknown" }),
        json!({ "playback_status": true }), json!({ "playback_status": "Playing" })];
    let mut states = payloads.iter().map(|payload| {
        media::MediaSnapshot::read_with(true, |_, _| Ok(payload.clone()))
    }).collect::<Vec<_>>();
    states.push(media::MediaSnapshot::read_with(true, |_, _| Err("permission denied".into())));
    for media in states {
        let snapshot = json!({ "media": media });
        assert_eq!(snapshot["media"]["available"], false);
        assert!(snapshot["media"]["playback_status"].is_null());
        let mut group = playing_group();
        assert!(!matches_group(&group, &snapshot));
        group["negated"] = json!(true);
        assert!(!matches_group(&group, &snapshot));
    }
    assert!(!matches_group(&playing_group(), &json!({})));
}

#[test]
fn only_playing_matches_and_known_paused_or_stopped_can_be_negated() {
    for status in ["playing", "paused", "stopped"] {
        let snapshot = snapshot(json!({ "playback_status": status }));
        let mut group = playing_group();
        assert_eq!(matches_group(&group, &snapshot), status == "playing");
        group["negated"] = json!(true);
        assert_eq!(matches_group(&group, &snapshot), status != "playing");
    }
}

#[test]
fn source_app_uses_exact_normalized_identity_and_can_combine_with_playback() {
    let group = normalize_group(Some(&json!({ "logic": "and", "items": [
        { "kind": "media_playing" },
        { "kind": "media_source_app", "source_app_id": " Test.Player_123!App " },
    ] })));
    assert_eq!(group["items"][1]["source_app_id"], "test.player_123!app");
    assert!(matches_group(&group, &snapshot(json!({
        "playback_status": "playing", "source_app_id": "TEST.Player_123!App",
    }))));
    for (status, app) in [("paused", "test.player_123!app"),
        ("playing", "test.player_123!app.extra"), ("playing", "another.player")]
    {
        assert!(!matches_group(&group, &snapshot(json!({
            "playback_status": status, "source_app_id": app,
        }))));
    }
}

#[test]
fn missing_source_id_is_unknown_even_when_playback_is_known() {
    for source in [Value::Null, json!(""), json!("  "), json!(true), json!(123)] {
        let snapshot = snapshot(json!({ "playback_status": "playing", "source_app_id": source }));
        assert!(matches_group(&playing_group(), &snapshot));
        let group = json!({ "logic": "and", "negated": true, "items": [
            { "kind": "media_source_app", "source_app_id": "test.player" },
        ] });
        assert!(!matches_group(&group, &snapshot));
    }
}

#[test]
fn unknown_media_cannot_match_through_nested_negation_or_boolean_short_circuit() {
    let snapshot = json!({ "process": { "apps": [{ "name": "game.exe" }] } });
    let unknown = json!({ "logic": "and", "negated": true, "items": [
        { "kind": "media_playing" },
    ] });
    for logic in ["and", "or"] {
        for negated in [false, true] {
            for app in ["game.exe", "missing.exe"] {
                let group = json!({ "logic": logic, "negated": negated, "items": [
                    { "kind": "app_running", "app_name": app }, unknown,
                ] });
                assert!(!matches_group(&group, &snapshot));
            }
        }
    }
}

#[test]
fn invalid_media_source_config_is_preserved_and_fails_closed_after_round_trip() {
    for value in [Value::Null, json!(""), json!("  "), json!(false), json!(42)] {
        let raw = json!({ "rules": [{ "id": "music", "conditions": {
            "logic": "and", "items": [{ "kind": "media_source_app", "source_app_id": value }],
        } }] });
        let normalized = normalize_config(raw);
        let restored = normalize_config(serde_json::from_str(&normalized.to_string()).unwrap());
        assert_eq!(restored, normalized);
        let conditions = &restored["rules"][0]["conditions"];
        assert_eq!(conditions["items"].as_array().unwrap().len(), 1);
        assert!(conditions["items"][0]["source_app_id"].is_null());
        assert!(!matches_group(conditions, &snapshot(json!({
            "playback_status": "playing", "source_app_id": "test.player",
        }))));
    }
}

#[test]
fn legacy_rules_keep_matching_without_media_and_candidate_order_is_unchanged() {
    let legacy = json!({ "logic": "and", "negated": false, "items": [
        { "kind": "app_running", "app_name": "game.exe" },
        { "kind": "app_foreground", "app_name": "game.exe" },
        { "kind": "window_title_contains", "value": "level" },
    ] });
    let config = normalize_config(json!({ "rules": [
        { "id": "legacy", "conditions": legacy },
        { "id": "media", "conditions": playing_group() },
    ] }));
    assert_eq!(config["rules"][0]["conditions"], legacy);
    let mut snapshot = json!({
        "process": { "apps": [{ "name": "game.exe" }] },
        "focus": { "current": { "app_name": "game.exe", "window_title": "LEVEL 1" } },
    });
    let (candidates, _) = sorted_candidates(&config, &snapshot);
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].1["id"], "legacy");
    snapshot["media"] = json!(media::MediaSnapshot::from_host(&json!({ "playback_status": "playing" }), true));
    let (candidates, _) = sorted_candidates(&config, &snapshot);
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].1["id"], "legacy");
    assert_eq!(candidates[1].1["id"], "media");
}

#[test]
fn manifest_declares_only_media_session_permission() {
    let manifest: Value = serde_json::from_str(include_str!("../manifest.json")).unwrap();
    assert_eq!(manifest["permissions"], json!(["media:session"]));
}

#[derive(Default)]
struct MockHost {
    calls: Vec<(String, Value)>,
    media_response: Value,
    fail_media: bool,
}

unsafe extern "C" fn mock_call_json(
    ctx: *mut c_void, method: *const c_char, method_len: usize,
    request: *const c_char, request_len: usize, out: *mut u8,
    capacity: usize, required: *mut usize,
) -> i32 {
    let method = ptr_len_to_string(method, method_len);
    let host = unsafe { &mut *ctx.cast::<MockHost>() };
    let failed = method == "get_media_session" && host.fail_media;
    let response = serde_json::to_vec(&if failed {
        json!({ "error": "synthetic media failure" })
    } else if method == "get_media_session" { host.media_response.clone() } else { Value::Null }).unwrap();
    unsafe { *required = response.len(); }
    if out.is_null() || capacity < response.len() {
        return 1;
    }
    let request = if request_len == 0 { Value::Null } else {
        let bytes = unsafe { std::slice::from_raw_parts(request.cast::<u8>(), request_len) };
        serde_json::from_slice(bytes).unwrap_or(Value::Null)
    };
    host.calls.push((method, request));
    unsafe { std::ptr::copy_nonoverlapping(response.as_ptr(), out, response.len()); }
    if failed { -3 } else { 0 }
}

fn mock_extension() -> (Box<MockHost>, AutomaticExtension) {
    let mut host = Box::<MockHost>::default();
    let bridge = HostBridge { host: SkydimoHostApiV1 {
        host_ctx: (&mut *host as *mut MockHost).cast(),
        call_json: Some(mock_call_json),
        ..SkydimoHostApiV1::default()
    } };
    let extension = AutomaticExtension::new(bridge);
    extension.state.lock().unwrap().config = normalize_config(json!({ "rules": [
        { "id": "music", "conditions": playing_group(), "actions": [] },
    ] }));
    (host, extension)
}

#[test]
#[cfg(windows)]
fn existing_media_events_update_cache_recompute_and_clear_stale_playing_state() {
    // Never call start(): this is a synthetic Host and no OS monitor is started.
    let (mut host, mut extension) = mock_extension();
    host.media_response = json!({
        "playback_status": "playing", "source_app_id": "test.player",
    });
    extension.handle_event("system.media.changed", Value::Null).unwrap();
    assert_eq!(extension.state.lock().unwrap().scheduler["activeRuleId"], "music");
    assert!(host.calls.iter().any(|(method, payload)| {
        method == "page_emit" && payload["type"] == "system_state"
            && payload["data"]["media"]["playback_status"] == "playing"
    }));
    assert!(host.calls.iter().all(|(method, _)| method == "page_emit" || method == "get_media_session"));
    host.calls.clear();
    host.media_response = json!({
        "playback_status": "paused", "source_app_id": "test.player",
    });
    extension.handle_event("system.media.playback_changed", Value::Null).unwrap();
    assert!(extension.state.lock().unwrap().scheduler.get("activeRuleId").is_none());
    host.media_response = json!({
        "playback_status": "playing", "source_app_id": "test.player",
    });
    extension.handle_event("system.media.playback_changed", Value::Null).unwrap();
    assert_eq!(extension.state.lock().unwrap().scheduler["activeRuleId"], "music");
    host.media_response = Value::Null;
    extension.handle_event("system.media.changed", Value::Null).unwrap();
    let state = extension.state.lock().unwrap();
    assert_eq!(state.system_state_json()["media"]["available"], false);
    assert!(state.scheduler.get("activeRuleId").is_none());
}

#[test]
#[cfg(windows)]
fn duplicate_metadata_and_timeline_events_do_not_reapply_actions() {
    let (mut host, mut extension) = mock_extension();
    let mut payload = json!({ "playback_status": "playing", "source_app_id": "test.player" });
    host.media_response = payload.clone();
    extension.handle_event("system.media.changed", payload.clone()).unwrap();
    host.calls.clear();
    payload["title"] = json!("a new title");
    host.media_response = payload.clone();
    extension.handle_event("system.media.changed", payload.clone()).unwrap();
    extension.handle_event("system.media.playback_changed", payload).unwrap();
    extension.handle_event("system.media.timeline_changed", json!({ "position_ms": 1000 })).unwrap();
    assert!(host.calls.iter().all(|(method, _)| method == "get_media_session"));
    assert_eq!(host.calls.len(), 2, "timeline events do not query media");
    host.media_response = json!({ "playback_status": "unknown" });
    extension.handle_event("system.media.changed", Value::Null).unwrap();
    assert_eq!(extension.state.lock().unwrap().system_state_json()["media"]["available"], false);
    assert!(!host.calls.is_empty());
}

#[test]
fn reconciliation_is_limited_to_five_seconds_without_catch_up_bursts() {
    let now = Instant::now();
    let mut schedule = media::ReconcileSchedule::new(now);
    for second in 0..5 { assert!(!schedule.take_due(now + Duration::from_secs(second))); }
    assert!(schedule.take_due(now + Duration::from_secs(5)));
    assert!(!schedule.take_due(now + Duration::from_secs(5)));
    assert!(schedule.take_due(now + Duration::from_secs(60)));
    assert!(!schedule.take_due(now + Duration::from_secs(60)));
}

#[test]
#[cfg(windows)]
fn reconciliation_recovers_a_lost_event_and_failed_query_without_repeating_actions() {
    let (mut host, extension) = mock_extension();
    let now = Instant::now();
    let mut schedule = media::ReconcileSchedule::new(now);
    let mut state = extension.state.lock().unwrap();
    host.media_response = json!({ "playback_status": "playing", "source_app_id": "player" });
    assert!(!reconcile_media_locked(&extension.host, &mut state, &mut schedule, now + Duration::from_secs(4)));
    assert!(host.calls.is_empty());
    assert!(reconcile_media_locked(&extension.host, &mut state, &mut schedule, now + Duration::from_secs(5)));
    recompute_and_emit_locked(&extension.host, &mut state, "media_changed");
    assert_eq!(state.scheduler["activeRuleId"], "music");
    host.calls.clear();
    assert!(!reconcile_media_locked(&extension.host, &mut state, &mut schedule, now + Duration::from_secs(10)));
    assert_eq!(host.calls.len(), 1);
    assert_eq!(host.calls[0].0, "get_media_session");
    host.fail_media = true;
    assert!(reconcile_media_locked(&extension.host, &mut state, &mut schedule, now + Duration::from_secs(15)));
    recompute_and_emit_locked(&extension.host, &mut state, "media_changed");
    assert_eq!(state.system_state_json()["media"]["available"], false);
    assert!(state.scheduler.get("activeRuleId").is_none());
    let mut negated = playing_group();
    negated["negated"] = json!(true);
    assert!(!matches_group(&negated, &state.system_state_json()));
    host.fail_media = false;
    assert!(reconcile_media_locked(&extension.host, &mut state, &mut schedule, now + Duration::from_secs(20)));
    recompute_and_emit_locked(&extension.host, &mut state, "media_changed");
    assert_eq!(state.scheduler["activeRuleId"], "music");
    // The final paused event never arrives; polling must still clear playing.
    host.media_response = json!({ "playback_status": "paused", "source_app_id": "player" });
    assert!(reconcile_media_locked(&extension.host, &mut state, &mut schedule, now + Duration::from_secs(25)));
    recompute_and_emit_locked(&extension.host, &mut state, "media_changed");
    assert!(state.scheduler.get("activeRuleId").is_none());
}

#[test]
#[cfg(windows)]
fn delayed_event_payload_cannot_replace_a_newer_host_snapshot() {
    let (mut host, mut extension) = mock_extension();
    host.media_response = json!({ "playback_status": "paused", "source_app_id": "current.player" });
    extension.handle_event("system.media.playback_changed", json!({
        "playback_status": "playing", "source_app_id": "old.player",
    })).unwrap();
    let state = extension.state.lock().unwrap();
    assert_eq!(state.system_state_json()["media"]["playback_status"], "paused");
    assert_eq!(state.system_state_json()["media"]["source_app_id"], "current.player");
    assert!(state.scheduler.get("activeRuleId").is_none());
}
