use super::*;

#[derive(Default)]
struct FakeHost {
    requests: Mutex<Vec<(String, Value)>>,
    response: Mutex<Vec<u8>>,
    automation_response: Option<Value>,
}

impl FakeHost {
    fn bridge(&mut self) -> HostBridge {
        HostBridge { host: SkydimoHostApiV1 {
            host_ctx: (self as *mut Self).cast(), call_json: Some(call_json),
            ..SkydimoHostApiV1::default()
        } }
    }

    fn requests(&self, method: &str) -> Vec<Value> {
        self.requests.lock().unwrap().iter()
            .filter(|(name, _)| name == method).map(|(_, value)| value.clone()).collect()
    }
}

unsafe extern "C" fn call_json(
    context: *mut c_void, method: *const c_char, method_len: usize,
    request: *const c_char, request_len: usize, output: *mut u8,
    output_len: usize, required: *mut usize,
) -> i32 {
    let host = unsafe { &*context.cast::<FakeHost>() };
    if output.is_null() {
        let method = ptr_len_to_string(method, method_len);
        let request = parse_json_ptr(request, request_len).unwrap();
        let response = match method.as_str() {
            "reconcile_automation" => host.automation_response.clone()
                .unwrap_or_else(|| json!({ "applied": [], "skipped": [], "errors": [] })),
            _ => Value::Null,
        };
        host.requests.lock().unwrap().push((method, request));
        *host.response.lock().unwrap() = serde_json::to_vec(&response).unwrap();
    }
    let response = host.response.lock().unwrap();
    unsafe { *required = response.len(); }
    if output_len < response.len() { return 1; }
    unsafe { std::ptr::copy_nonoverlapping(response.as_ptr(), output, response.len()); }
    0
}

fn test_directory() -> PathBuf {
    std::env::temp_dir().join(format!("skydimo-automatic-ownership-{}-{}",
        std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()))
}

#[test]
fn successful_enable_edit_resumes_once_but_recompute_and_saves_do_not() {
    let mut fake = FakeHost::default();
    let host = fake.bridge();
    let mut state = RuntimeState::new();
    state.data_dir = test_directory();
    state.config["enabled"] = json!(false);
    let mut enabled = state.config.clone();
    enabled["enabled"] = json!(true);
    save_config_locked(&host, &mut state, enabled.clone(), "set_enabled", Some("page-1"));
    assert_eq!(fake.requests("reconcile_automation")[0]["resume_manual"], true);
    assert!(!state.resume_manual);
    recompute_locked(&host, &mut state, "manual");
    save_config_locked(&host, &mut state, enabled, "save_config", Some("page-2"));
    assert!(fake.requests("reconcile_automation")[1..].iter()
        .all(|request| request["resume_manual"] == false));
    let replies = fake.requests("page_emit").into_iter()
        .filter(|request| request["type"] == "save_result").collect::<Vec<_>>();
    assert_eq!(replies[0]["data"]["requestId"], "page-1");
    assert_eq!(replies[1]["data"]["requestId"], "page-2");
    std::fs::remove_dir_all(state.data_dir).unwrap();
}

#[test]
fn failed_save_keeps_previous_config_and_never_resumes_or_reconciles() {
    let mut fake = FakeHost::default();
    let host = fake.bridge();
    let mut state = RuntimeState::new();
    state.data_dir = test_directory();
    std::fs::write(&state.data_dir, b"not a directory").unwrap();
    state.config["enabled"] = json!(false);
    let previous = state.config.clone();
    let mut enabled = previous.clone();
    enabled["enabled"] = json!(true);
    save_config_locked(&host, &mut state, enabled, "set_enabled", Some("page-failed"));
    assert_eq!(state.config, previous);
    assert!(!state.resume_manual);
    assert!(fake.requests("reconcile_automation").is_empty());
    let messages = fake.requests("page_emit");
    assert_eq!(messages[0]["type"], "error");
    assert_eq!(messages[0]["data"]["requestId"], "page-failed");
    assert!(!messages.iter().any(|message| message["type"] == "save_result"));
    std::fs::remove_file(state.data_dir).unwrap();
}

#[test]
fn partial_startup_stop_releases_once_even_with_poisoned_state() {
    let mut fake = FakeHost::default();
    let mut extension = AutomaticExtension::new(fake.bridge());
    extension.ownership_started = true;
    let state = extension.state.clone();
    let _ = thread::spawn(move || {
        let _guard = state.lock().unwrap();
        panic!("injected plugin state failure");
    }).join();
    extension.stop();
    extension.stop();
    let calls = fake.requests("reconcile_automation");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0], json!({ "plan_key": null, "actions": [], "resume_manual": false }));
}

#[test]
fn stopped_generation_ignores_late_events_and_page_mutations() {
    let mut fake = FakeHost::default();
    let mut extension = AutomaticExtension::new(fake.bridge());
    extension.handle_event("devices-changed", Value::Null).unwrap();
    extension.handle_page_message(json!({ "type": "set_enabled", "enabled": true })).unwrap();
    assert!(fake.requests.lock().unwrap().is_empty());
}

#[test]
fn disabled_scheduler_releases_and_does_not_label_a_matching_rule_active() {
    let mut fake = FakeHost::default();
    let mut state = RuntimeState::new();
    state.config = normalize_config(json!({ "enabled": false, "rules": [{ "id": "always",
        "conditions": { "logic": "and", "items": [] },
        "actions": [{ "scope": { "port": "device" }, "brightness": 20 }] }] }));
    recompute_locked(&fake.bridge(), &mut state, "set_enabled");
    assert!(fake.requests("reconcile_automation")[0]["plan_key"].is_null());
    assert!(state.scheduler.get("activeRuleId").is_none());
    assert_eq!(state.scheduler["rules"][0]["active"], false);
    assert_eq!(state.scheduler["activeActions"], json!([]));
    assert_eq!(state.scheduler["lastSkipped"], json!([]));
}

#[test]
fn validation_errors_echo_request_identity_but_background_errors_do_not() {
    let mut fake = FakeHost::default();
    let mut extension = AutomaticExtension::new(fake.bridge());
    extension.started = true;
    for action in ["delete_rule", "reorder_rules"] {
        extension.handle_page_message(json!({ "type": action, "requestId": action })).unwrap();
    }
    let errors = fake.requests("page_emit").into_iter()
        .filter(|request| request["type"] == "error").collect::<Vec<_>>();
    assert_eq!(errors[0]["data"]["requestId"], "delete_rule");
    assert_eq!(errors[1]["data"]["requestId"], "reorder_rules");
    assert!(with_request_id(json!({ "action": "background" }), None).get("requestId").is_none());
}

#[test]
fn heartbeat_keeps_host_ownership_fresh_without_repeated_error_notifications() {
    let mut fake = FakeHost { automation_response: Some(json!({
        "applied": [], "skipped": [], "errors": [{ "message": "Device not found" }],
    })), ..FakeHost::default() };
    let host = fake.bridge();
    let mut state = RuntimeState::new();
    recompute_and_emit_locked(&host, &mut state, "heartbeat");
    let activity_count = state.activity_counter;
    recompute_and_emit_locked(&host, &mut state, "heartbeat");
    assert_eq!(fake.requests("reconcile_automation").len(), 2);
    assert_eq!(state.activity_counter, activity_count);
    let events = fake.requests("page_emit");
    assert_eq!(events.iter().filter(|request| request["type"] == "scheduler_state").count(), 2);
    assert_eq!(events.iter().filter(|request| request["type"] == "error").count(), 1);
    assert_eq!(events.iter().filter(|request| request["type"] == "activity").count(), 1);
}

#[test]
fn manual_hold_is_visible_but_not_reported_as_an_applied_action_or_error() {
    let mut fake = FakeHost { automation_response: Some(json!({
        "applied": [], "skipped": [{ "scope": { "port": "device" }, "reason": "manual_override" }], "errors": [],
    })), ..FakeHost::default() };
    let mut state = RuntimeState::new();
    state.config = normalize_config(json!({ "rules": [{ "id": "always",
        "conditions": { "logic": "and", "items": [] },
        "actions": [{ "scope": { "port": "device" }, "brightness": 20 }] }] }));
    let result = recompute_locked(&fake.bridge(), &mut state, "heartbeat");
    assert!(result.applied.is_empty());
    assert!(result.errors.is_empty());
    assert_eq!(state.scheduler["activeRuleId"], "always");
    assert!(state.scheduler.get("lastAppliedAt").is_none());
    assert_eq!(state.scheduler["lastSkipped"][0]["reason"], "manual_override");
    assert!(state.activity.iter().any(|item| item["title"] == "Automation yielded control"));
}
