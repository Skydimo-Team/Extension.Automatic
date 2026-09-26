use serde::Serialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const RECONCILE_INTERVAL: Duration = Duration::from_secs(5);

/// Reuse the existing monitor thread; do not replay a burst of missed intervals.
pub(super) struct ReconcileSchedule {
    last_attempt: Instant,
}

impl ReconcileSchedule {
    pub(super) fn new(now: Instant) -> Self { Self { last_attempt: now } }

    pub(super) fn take_due(&mut self, now: Instant) -> bool {
        if now.saturating_duration_since(self.last_attempt) < RECONCILE_INTERVAL {
            return false;
        }
        self.last_attempt = now;
        true
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum PlaybackStatus {
    Playing,
    Paused,
    Stopped,
}

impl PlaybackStatus {
    fn from_value(value: &Value) -> Option<Self> {
        match value.as_str()? {
            "playing" => Some(Self::Playing),
            "paused" => Some(Self::Paused),
            "stopped" => Some(Self::Stopped),
            _ => None,
        }
    }
}

/// Only the current Host media session's rule inputs, never track metadata/artwork.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(super) struct MediaSnapshot {
    supported: bool,
    available: bool,
    playback_status: Option<PlaybackStatus>,
    source_app_id: Option<String>,
}

impl Default for MediaSnapshot {
    fn default() -> Self {
        Self::unavailable(cfg!(windows))
    }
}

impl MediaSnapshot {
    fn unavailable(supported: bool) -> Self {
        Self { supported, available: false, playback_status: None, source_app_id: None }
    }

    pub(super) fn from_host(payload: &Value, supported: bool) -> Self {
        if !supported {
            return Self::unavailable(false);
        }
        let Some(status) = payload.get("playback_status").and_then(PlaybackStatus::from_value) else {
            return Self::unavailable(true);
        };
        Self {
            supported: true,
            available: true,
            playback_status: Some(status),
            source_app_id: normalize_source_app_id(payload.get("source_app_id")),
        }
    }

    pub(super) fn read_with(
        supported: bool,
        call: impl FnOnce(&str, &Value) -> Result<Value, String>,
    ) -> Self {
        if !supported {
            return Self::unavailable(false);
        }
        // The existing Host includes artwork; request its minimum size and discard it.
        match call("get_media_session", &json!({ "max_edge": 1 })) {
            Ok(payload) => Self::from_host(&payload, true),
            Err(_) => Self::unavailable(true),
        }
    }
}

pub(super) fn normalize_source_app_id(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase)
}

/// None means unknown, not false: negation must not turn missing data into a match.
pub(super) fn matches_condition(condition: &Value, snapshot: &Value) -> Option<bool> {
    let media = snapshot.get("media")?;
    if media.get("supported") != Some(&Value::Bool(true))
        || media.get("available") != Some(&Value::Bool(true))
    {
        return None;
    }
    let status = media.get("playback_status").and_then(PlaybackStatus::from_value)?;
    match condition.get("kind").and_then(Value::as_str)? {
        "media_playing" => Some(status == PlaybackStatus::Playing),
        "media_source_app" => {
            let expected = normalize_source_app_id(condition.get("source_app_id"))?;
            let current = normalize_source_app_id(media.get("source_app_id"))?;
            Some(current == expected)
        }
        _ => None,
    }
}

/// Preflight every media leaf before boolean short-circuiting (including nested NOT).
/// A rule that references an unavailable media input is ineligible as a whole.
pub(super) fn conditions_available(group: &Value, snapshot: &Value) -> bool {
    group.get("items").and_then(Value::as_array).is_none_or(|items| {
        items.iter().all(|item| {
            if super::is_condition_group(item) {
                conditions_available(item, snapshot)
            } else if matches!(item.get("kind").and_then(Value::as_str), Some("media_playing" | "media_source_app")) {
                matches_condition(item, snapshot).is_some()
            } else {
                true
            }
        })
    })
}
