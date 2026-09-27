use serde::Deserialize;
use serde_json::{json, Value};

/// The Host owns both temporary state and manual-intervention holds. A plugin
/// must never infer ownership from equal values or replay unguarded setters.
#[derive(Debug, Default, Deserialize)]
pub(super) struct ApplyResult {
    pub applied: Vec<Value>,
    pub skipped: Vec<Value>,
    pub errors: Vec<Value>,
}

pub(super) fn reconcile_with(
    plan_key: Option<&str>,
    actions: &[Value],
    resume_manual: bool,
    mut call: impl FnMut(&str, &Value) -> Result<Value, String>,
) -> ApplyResult {
    let request = json!({
        "plan_key": plan_key,
        "actions": if plan_key.is_some() { actions } else { &[] },
        "resume_manual": resume_manual,
    });
    let result = call("reconcile_automation", &request).and_then(|response| {
        serde_json::from_value(response)
            .map_err(|_| "Host returned an invalid automation ownership result".to_string())
    });
    match result {
        Ok(result) => result,
        Err(message) => ApplyResult { errors: vec![json!({ "message": message })], ..ApplyResult::default() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn success() -> Value { json!({ "applied": [], "skipped": [], "errors": [] }) }

    #[test]
    fn complete_plan_is_one_guarded_host_call_without_client_owned_identity() {
        let actions = vec![json!({ "scope": { "port": "device", "output_id": "strip" },
            "effectId": "rainbow", "params": { "speed": 2 }, "powerOff": false,
            "brightness": 30, "paused": false })];
        let mut calls = 0;
        let result = reconcile_with(Some("rule:1"), &actions, false, |method, request| {
            calls += 1;
            assert_eq!(method, "reconcile_automation");
            assert_eq!(request, &json!({ "plan_key": "rule:1", "actions": actions, "resume_manual": false }));
            Ok(success())
        });
        assert_eq!(calls, 1);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn unchanged_plans_are_rechecked_by_host_not_skipped_by_plugin_cache() {
        let actions = vec![json!({ "scope": { "port": "device" }, "brightness": 30 })];
        for reason in ["manual_override", "calibration", "unchanged"] {
            let result = reconcile_with(Some("rule:1"), &actions, false, |method, request| {
                assert_eq!(method, "reconcile_automation");
                assert_eq!(request["resume_manual"], false);
                Ok(json!({ "applied": [], "skipped": [{ "scope": actions[0]["scope"], "reason": reason }], "errors": [] }))
            });
            assert!(result.applied.is_empty());
            assert_eq!(result.skipped[0]["reason"], reason);
        }
    }

    #[test]
    fn unavailable_host_never_falls_back_to_unguarded_setters() {
        let mut calls = 0;
        let result = reconcile_with(Some("rule:1"), &[json!({ "brightness": 30 })], false, |method, _| {
            calls += 1;
            assert_eq!(method, "reconcile_automation");
            Err("unknown Host method".to_string())
        });
        assert_eq!(calls, 1);
        assert!(result.applied.is_empty());
        assert_eq!(result.errors[0]["message"], "unknown Host method");
    }

    #[test]
    fn idle_disable_and_stop_explicitly_release_instead_of_forgetting_state() {
        let result = reconcile_with(None, &[json!({ "brightness": 30 })], false, |method, request| {
            assert_eq!(method, "reconcile_automation");
            assert_eq!(request, &json!({ "plan_key": null, "actions": [], "resume_manual": false }));
            Ok(success())
        });
        assert!(result.errors.is_empty());
    }

    #[test]
    fn only_explicit_resume_flag_requests_release_of_manual_holds() {
        for resume in [false, true] {
            reconcile_with(Some("rule:next"), &[], resume, |_, request| {
                assert_eq!(request["resume_manual"], resume);
                Ok(success())
            });
        }
    }

    #[test]
    fn malformed_responses_cannot_report_success() {
        for response in [Value::Null, json!({}), json!({ "applied": [], "errors": [] }),
            json!({ "applied": true, "skipped": [], "errors": [] })] {
            let result = reconcile_with(None, &[], false, |_, _| Ok(response.clone()));
            assert!(result.applied.is_empty());
            assert_eq!(result.errors.len(), 1);
        }
    }

    #[test]
    fn per_device_failures_and_later_recovery_are_host_authoritative() {
        let actions = vec![json!({ "scope": { "port": "ready" }, "brightness": 20 }),
            json!({ "scope": { "port": "missing" }, "brightness": 40 })];
        let first = reconcile_with(Some("rule:1"), &actions, false, |_, _| Ok(json!({
            "applied": [{ "scope": actions[0]["scope"] }], "skipped": [],
            "errors": [{ "scope": actions[1]["scope"], "message": "Device not found" }],
        })));
        assert_eq!(first.applied.len(), 1);
        assert_eq!(first.errors.len(), 1);
        let next = reconcile_with(Some("rule:1"), &actions, false, |_, request| {
            assert_eq!(request["actions"], json!(actions));
            Ok(json!({ "applied": [{ "scope": actions[1]["scope"] }],
                "skipped": [{ "scope": actions[0]["scope"], "reason": "unchanged" }], "errors": [] }))
        });
        assert_eq!(next.applied.len(), 1);
        assert_eq!(next.skipped.len(), 1);
        assert!(next.errors.is_empty());
    }
}
