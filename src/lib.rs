#![allow(dead_code)]

use std::collections::BTreeMap;
use std::ffi::{c_char, c_void};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Map, Value};

const SKYDIMO_NATIVE_C_ABI_VERSION: u32 = 2;
const SKYDIMO_PLUGIN_KIND_EXTENSION: u32 = 1 << 2;

const SKYDIMO_LOG_INFO: u32 = 2;
const SKYDIMO_LOG_WARN: u32 = 3;
const SKYDIMO_LOG_ERROR: u32 = 4;

const MAX_ACTIVITY_ENTRIES: usize = 120;
const MONITOR_INTERVAL: Duration = Duration::from_millis(1000);

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoStr {
    pub ptr: *const c_char,
    pub len: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoRgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoMatrixMapV1 {
    pub width: usize,
    pub height: usize,
    pub map: *const i64,
    pub map_len: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoLayoutTransformV1 {
    pub flip_horizontal: u8,
    pub flip_vertical: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoOutputCapabilitiesV1 {
    pub editable: u8,
    pub min_total_leds: usize,
    pub max_total_leds: usize,
    pub allowed_total_leds: *const usize,
    pub allowed_total_leds_len: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoOutputDefinitionV1 {
    pub id: SkydimoStr,
    pub name: SkydimoStr,
    pub output_type: u32,
    pub leds_count: usize,
    pub matrix: *const SkydimoMatrixMapV1,
    pub transform: SkydimoLayoutTransformV1,
    pub capabilities: SkydimoOutputCapabilitiesV1,
    pub default_effect: SkydimoStr,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoOutputFrameV1 {
    pub output_id: SkydimoStr,
    pub colors: *const SkydimoRgb,
    pub colors_len: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoLedColorV1 {
    pub index: usize,
    pub color: SkydimoRgb,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoDeviceInfoV1 {
    pub manufacturer: SkydimoStr,
    pub model: SkydimoStr,
    pub serial_id: SkydimoStr,
    pub description: SkydimoStr,
    pub device_type: u32,
    pub image_url: SkydimoStr,
    pub controller_id: SkydimoStr,
    pub controller_name: SkydimoStr,
    pub device_path: SkydimoStr,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoHardwareCandidateV1 {
    pub candidate_type: u32,
    pub port_key: SkydimoStr,
    pub path: SkydimoStr,
    pub vendor_id: u32,
    pub product_id: u32,
    pub has_vendor_id: u8,
    pub has_product_id: u8,
    pub interface_number: i32,
    pub has_interface_number: u8,
    pub serial_number: SkydimoStr,
    pub manufacturer_string: SkydimoStr,
    pub product_string: SkydimoStr,
}

type HostLogFn = unsafe extern "C" fn(*mut c_void, u32, *const c_char, usize);

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoHostApiV1 {
    pub size: u32,
    pub abi_version: u32,
    pub host_ctx: *mut c_void,
    pub log: Option<HostLogFn>,
    pub call_json: Option<
        unsafe extern "C" fn(
            *mut c_void,
            *const c_char,
            usize,
            *const c_char,
            usize,
            *mut u8,
            usize,
            *mut usize,
        ) -> i32,
    >,
    pub controller_set_device_info:
        Option<unsafe extern "C" fn(*mut c_void, *const SkydimoDeviceInfoV1) -> i32>,
    pub controller_add_output:
        Option<unsafe extern "C" fn(*mut c_void, *const SkydimoOutputDefinitionV1) -> i32>,
    pub controller_output_led_count:
        Option<unsafe extern "C" fn(*mut c_void, *const c_char, usize) -> usize>,
    pub controller_get_rgb_bytes:
        Option<unsafe extern "C" fn(*mut c_void, *const c_char, usize, *mut u8, usize) -> isize>,
    pub controller_write: Option<unsafe extern "C" fn(*mut c_void, *const u8, usize) -> isize>,
    pub controller_read: Option<unsafe extern "C" fn(*mut c_void, *mut u8, usize, u32) -> isize>,
    pub controller_hid_send_feature_report:
        Option<unsafe extern "C" fn(*mut c_void, *const u8, usize) -> isize>,
    pub controller_hid_get_feature_report:
        Option<unsafe extern "C" fn(*mut c_void, *mut u8, usize, u8) -> isize>,
    pub extension_lock_leds: Option<
        unsafe extern "C" fn(
            *mut c_void,
            *const c_char,
            usize,
            *const c_char,
            usize,
            *const usize,
            usize,
            *mut usize,
            *mut usize,
        ) -> i32,
    >,
    pub extension_unlock_leds: Option<
        unsafe extern "C" fn(
            *mut c_void,
            *const c_char,
            usize,
            *const c_char,
            usize,
            *const usize,
            usize,
        ) -> i32,
    >,
    pub extension_set_leds_rgb: Option<
        unsafe extern "C" fn(
            *mut c_void,
            *const c_char,
            usize,
            *const c_char,
            usize,
            *const SkydimoLedColorV1,
            usize,
        ) -> i32,
    >,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoEffectApiV1 {
    pub size: u32,
    pub create: Option<unsafe extern "C" fn(*const SkydimoHostApiV1, *mut *mut c_void) -> i32>,
    pub destroy: Option<unsafe extern "C" fn(*mut c_void)>,
    pub resize: Option<unsafe extern "C" fn(*mut c_void, u32, u32, u32) -> i32>,
    pub update_params_json: Option<unsafe extern "C" fn(*mut c_void, *const c_char, usize) -> i32>,
    pub tick: Option<unsafe extern "C" fn(*mut c_void, f64, *mut SkydimoRgb, usize) -> i32>,
    pub is_ready: Option<unsafe extern "C" fn(*mut c_void) -> i32>,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoControllerApiV1 {
    pub size: u32,
    pub create: Option<
        unsafe extern "C" fn(
            *const SkydimoHostApiV1,
            *const SkydimoHardwareCandidateV1,
            *mut *mut c_void,
        ) -> i32,
    >,
    pub destroy: Option<unsafe extern "C" fn(*mut c_void)>,
    pub validate: Option<unsafe extern "C" fn(*mut c_void) -> i32>,
    pub init: Option<unsafe extern "C" fn(*mut c_void) -> i32>,
    pub get_device_info: Option<unsafe extern "C" fn(*mut c_void, *mut SkydimoDeviceInfoV1) -> i32>,
    pub get_output_count: Option<unsafe extern "C" fn(*mut c_void) -> usize>,
    pub get_output:
        Option<unsafe extern "C" fn(*mut c_void, usize, *mut SkydimoOutputDefinitionV1) -> i32>,
    pub update: Option<unsafe extern "C" fn(*mut c_void, *const SkydimoOutputFrameV1, usize) -> i32>,
    pub set_output_leds_count:
        Option<unsafe extern "C" fn(*mut c_void, *const c_char, usize, usize) -> i32>,
    pub update_output:
        Option<unsafe extern "C" fn(*mut c_void, *const SkydimoOutputDefinitionV1) -> i32>,
    pub disconnect: Option<unsafe extern "C" fn(*mut c_void) -> i32>,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoExtensionApiV1 {
    pub size: u32,
    pub create: Option<unsafe extern "C" fn(*const SkydimoHostApiV1, *mut *mut c_void) -> i32>,
    pub destroy: Option<unsafe extern "C" fn(*mut c_void)>,
    pub start: Option<unsafe extern "C" fn(*mut c_void) -> i32>,
    pub stop: Option<unsafe extern "C" fn(*mut c_void) -> i32>,
    pub on_scan_devices: Option<unsafe extern "C" fn(*mut c_void) -> i32>,
    pub on_event_json:
        Option<unsafe extern "C" fn(*mut c_void, *const c_char, usize, *const c_char, usize) -> i32>,
    pub on_page_message_json: Option<unsafe extern "C" fn(*mut c_void, *const c_char, usize) -> i32>,
    pub on_device_frame: Option<
        unsafe extern "C" fn(
            *mut c_void,
            *const c_char,
            usize,
            *const SkydimoOutputFrameV1,
            usize,
        ) -> i32,
    >,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SkydimoPluginApiV1 {
    pub size: u32,
    pub abi_version: u32,
    pub kind_mask: u32,
    pub effect: SkydimoEffectApiV1,
    pub controller: SkydimoControllerApiV1,
    pub extension: SkydimoExtensionApiV1,
    pub shutdown_plugin: Option<unsafe extern "C" fn()>,
}

#[derive(Clone, Copy)]
struct HostBridge {
    host: SkydimoHostApiV1,
}

unsafe impl Send for HostBridge {}
unsafe impl Sync for HostBridge {}

impl HostBridge {
    fn from_ptr(host: *const SkydimoHostApiV1) -> Self {
        let host = if host.is_null() {
            SkydimoHostApiV1::default()
        } else {
            unsafe { *host }
        };
        Self { host }
    }

    fn call_json(&self, method: &str, request: &Value) -> Result<Value, String> {
        let call_json = self
            .host
            .call_json
            .ok_or_else(|| "host does not expose call_json".to_string())?;
        let request_bytes = if request.is_null() {
            Vec::new()
        } else {
            serde_json::to_vec(request).map_err(|err| err.to_string())?
        };
        let request_ptr = if request_bytes.is_empty() {
            std::ptr::null()
        } else {
            request_bytes.as_ptr().cast::<c_char>()
        };
        let method_ptr = method.as_ptr().cast::<c_char>();
        let mut required = 0usize;

        let status = unsafe {
            call_json(
                self.host.host_ctx,
                method_ptr,
                method.len(),
                request_ptr,
                request_bytes.len(),
                std::ptr::null_mut(),
                0,
                &mut required,
            )
        };
        if status < 0 && required == 0 {
            return Err(format!("host method '{method}' failed with status {status}"));
        }

        let mut out = vec![0u8; required];
        let mut final_required = required;
        let final_status = unsafe {
            call_json(
                self.host.host_ctx,
                method_ptr,
                method.len(),
                request_ptr,
                request_bytes.len(),
                out.as_mut_ptr(),
                out.len(),
                &mut final_required,
            )
        };
        if final_status > 0 {
            return Err(format!(
                "host method '{method}' response buffer too small ({required} < {final_required})"
            ));
        }

        let response = if out.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice::<Value>(&out).map_err(|err| {
                format!("host method '{method}' returned invalid JSON: {err}")
            })?
        };

        if final_status < 0 {
            if let Some(error) = response.get("error").and_then(Value::as_str) {
                Err(error.to_string())
            } else {
                Err(format!("host method '{method}' failed with status {final_status}"))
            }
        } else {
            Ok(response)
        }
    }

    fn emit_page(&self, kind: &str, data: Value) {
        let _ = self.call_json("page_emit", &json!({ "type": kind, "data": data }));
    }

    fn log(&self, level: u32, message: &str) {
        if let Some(log) = self.host.log {
            unsafe {
                log(
                    self.host.host_ctx,
                    level,
                    message.as_ptr().cast::<c_char>(),
                    message.len(),
                );
            }
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Default)]
struct ProcessApplication {
    name: String,
    instance_count: u32,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
struct ProcessSnapshot {
    supported: bool,
    apps: Vec<ProcessApplication>,
}

impl Default for ProcessSnapshot {
    fn default() -> Self {
        Self {
            supported: cfg!(target_os = "windows"),
            apps: Vec::new(),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Default)]
struct ProcessApplicationChange {
    name: String,
    previous_instance_count: u32,
    current_instance_count: u32,
}

#[derive(Clone, PartialEq, Eq, Serialize, Default)]
struct FocusTarget {
    #[serde(skip_serializing_if = "Option::is_none")]
    app_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    window_title: Option<String>,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
struct FocusSnapshot {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    current: Option<FocusTarget>,
}

impl Default for FocusSnapshot {
    fn default() -> Self {
        Self {
            supported: cfg!(target_os = "windows"),
            current: None,
        }
    }
}

#[derive(Clone, Default)]
struct MonitorSnapshot {
    process: ProcessSnapshot,
    focus: FocusSnapshot,
}

struct RuntimeState {
    data_dir: PathBuf,
    config: Value,
    devices: Value,
    effects: Value,
    process: ProcessSnapshot,
    focus: FocusSnapshot,
    scheduler: Value,
    activity: Vec<Value>,
    activity_counter: u64,
    current_plan_key: Option<String>,
    applied_signatures: BTreeMap<String, String>,
    previous_summary: Option<String>,
}

impl RuntimeState {
    fn new() -> Self {
        Self {
            data_dir: PathBuf::new(),
            config: empty_config(),
            devices: Value::Array(Vec::new()),
            effects: Value::Array(Vec::new()),
            process: ProcessSnapshot::default(),
            focus: FocusSnapshot::default(),
            scheduler: empty_scheduler_state(),
            activity: Vec::new(),
            activity_counter: 0,
            current_plan_key: None,
            applied_signatures: BTreeMap::new(),
            previous_summary: None,
        }
    }

    fn push_activity(&mut self, kind: &str, title: &str, detail: impl Into<Option<String>>) {
        self.activity_counter = self.activity_counter.saturating_add(1);
        let id = format!("{}-{:03}", unix_secs(), self.activity_counter);
        let mut entry = Map::new();
        entry.insert("id".into(), Value::String(id));
        entry.insert("timestamp".into(), Value::String(iso_now()));
        entry.insert("kind".into(), Value::String(kind.to_string()));
        entry.insert("title".into(), Value::String(title.to_string()));
        if let Some(detail) = detail.into() {
            entry.insert("detail".into(), Value::String(detail));
        }
        self.activity.insert(0, Value::Object(entry));
        if self.activity.len() > MAX_ACTIVITY_ENTRIES {
            self.activity.truncate(MAX_ACTIVITY_ENTRIES);
        }
    }

    fn activity_json(&self) -> Value {
        Value::Array(self.activity.clone())
    }

    fn system_state_json(&self) -> Value {
        json!({
            "process": self.process,
            "focus": self.focus,
        })
    }
}

struct AutomaticExtension {
    host: HostBridge,
    state: Arc<Mutex<RuntimeState>>,
    stop_monitor: Arc<AtomicBool>,
    monitor_thread: Option<thread::JoinHandle<()>>,
    started: bool,
}

impl AutomaticExtension {
    fn new(host: HostBridge) -> Self {
        Self {
            host,
            state: Arc::new(Mutex::new(RuntimeState::new())),
            stop_monitor: Arc::new(AtomicBool::new(false)),
            monitor_thread: None,
            started: false,
        }
    }

    fn start(&mut self) -> Result<(), String> {
        if self.started {
            self.stop();
        }
        self.stop_monitor.store(false, Ordering::SeqCst);
        let data_dir = self
            .host
            .call_json("data_dir", &Value::Null)?
            .as_str()
            .map(PathBuf::from)
            .ok_or_else(|| "host returned non-string data_dir".to_string())?;

        let initial_monitor = monitor::collect_snapshot();
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "automatic state mutex poisoned".to_string())?;
            state.data_dir = data_dir;
            match load_config(&state.data_dir) {
                Ok(config) => {
                    state.config = config;
                    let count = state
                        .config
                        .get("rules")
                        .and_then(Value::as_array)
                        .map(Vec::len)
                        .unwrap_or(0);
                    state.push_activity("config", "Config loaded", Some(format!("{count} rules")));
                }
                Err(err) => emit_error_locked(&self.host, &mut state, "load_config", &err),
            }

            match refresh_effects(&self.host) {
                Ok(effects) => state.effects = effects,
                Err(err) => emit_error_locked(&self.host, &mut state, "refresh_effects", &err),
            }
            match refresh_devices(&self.host, None) {
                Ok(devices) => state.devices = devices,
                Err(err) => emit_error_locked(&self.host, &mut state, "refresh_devices", &err),
            }

            state.process = initial_monitor.process;
            state.focus = initial_monitor.focus;
            emit_snapshot_locked(&self.host, &state);
            emit_system_state_locked(&self.host, &state);
            recompute_and_emit_locked(&self.host, &mut state, "bootstrap");
        }

        let host = self.host;
        let state = Arc::clone(&self.state);
        let stop = Arc::clone(&self.stop_monitor);
        self.monitor_thread = Some(
            thread::Builder::new()
                .name("automatic-monitor".to_string())
                .spawn(move || monitor_loop(host, state, stop))
                .map_err(|err| err.to_string())?,
        );
        self.started = true;

        Ok(())
    }

    fn stop(&mut self) {
        if !self.started && self.monitor_thread.is_none() {
            return;
        }
        self.started = false;
        self.stop_monitor.store(true, Ordering::SeqCst);
        if let Some(handle) = self.monitor_thread.take() {
            let _ = handle.join();
        }
    }

    fn handle_event(&mut self, event: &str, data: Value) -> Result<(), String> {
        if event != "devices-changed" {
            return Ok(());
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| "automatic state mutex poisoned".to_string())?;
        state.devices = refresh_devices(&self.host, Some(data))?;
        emit_snapshot_locked(&self.host, &state);
        recompute_and_emit_locked(&self.host, &mut state, "devices_changed");
        Ok(())
    }

    fn handle_page_message(&mut self, message: Value) -> Result<(), String> {
        let Some(message_type) = message.get("type").and_then(Value::as_str) else {
            return Ok(());
        };

        let mut state = self
            .state
            .lock()
            .map_err(|_| "automatic state mutex poisoned".to_string())?;
        match message_type {
            "bootstrap" => {
                emit_snapshot_locked(&self.host, &state);
                emit_system_state_locked(&self.host, &state);
                emit_scheduler_locked(&self.host, &state);
                emit_activity_locked(&self.host, &state);
            }
            "save_config" => {
                let next = normalize_config(message.get("config").cloned().unwrap_or(Value::Null));
                save_config_locked(&self.host, &mut state, next, "save_config");
            }
            "set_enabled" => {
                let mut next = state.config.clone();
                set_object_field(&mut next, "enabled", Value::Bool(message.get("enabled") == Some(&Value::Bool(true))));
                save_config_locked(&self.host, &mut state, normalize_config(next), "set_enabled");
            }
            "delete_rule" => {
                let rule_id = trim_string_value(
                    message
                        .get("ruleId")
                        .or_else(|| message.get("rule_id"))
                        .or_else(|| message.get("id")),
                );
                if let Some(rule_id) = rule_id {
                    let mut next = state.config.clone();
                    if let Some(rules) = next.get_mut("rules").and_then(Value::as_array_mut) {
                        rules.retain(|rule| rule.get("id").and_then(Value::as_str) != Some(rule_id.as_str()));
                    }
                    save_config_locked(&self.host, &mut state, normalize_config(next), "delete_rule");
                } else {
                    emit_error_locked(&self.host, &mut state, "delete_rule", "ruleId is required");
                }
            }
            "reorder_rules" => {
                let order_values = message
                    .get("ruleIds")
                    .or_else(|| message.get("rule_ids"))
                    .or_else(|| message.get("ids"))
                    .and_then(Value::as_array);
                if let Some(order_values) = order_values {
                    let mut order = BTreeMap::new();
                    for (index, value) in order_values.iter().enumerate() {
                        if let Some(id) = trim_string_value(Some(value)) {
                            order.insert(id, index);
                        }
                    }
                    let mut next = state.config.clone();
                    if let Some(rules) = next.get_mut("rules").and_then(Value::as_array_mut) {
                        let previous = rules
                            .iter()
                            .enumerate()
                            .filter_map(|(index, rule)| {
                                rule.get("id")
                                    .and_then(Value::as_str)
                                    .map(|id| (id.to_string(), index))
                            })
                            .collect::<BTreeMap<_, _>>();
                        rules.sort_by(|left, right| {
                            let left_id = left.get("id").and_then(Value::as_str).unwrap_or_default();
                            let right_id = right.get("id").and_then(Value::as_str).unwrap_or_default();
                            let left_order = order.get(left_id).copied().unwrap_or(usize::MAX);
                            let right_order = order.get(right_id).copied().unwrap_or(usize::MAX);
                            left_order.cmp(&right_order).then_with(|| {
                                previous
                                    .get(left_id)
                                    .copied()
                                    .unwrap_or(usize::MAX)
                                    .cmp(&previous.get(right_id).copied().unwrap_or(usize::MAX))
                            })
                        });
                    }
                    save_config_locked(&self.host, &mut state, normalize_config(next), "reorder_rules");
                } else {
                    emit_error_locked(&self.host, &mut state, "reorder_rules", "ruleIds must be an array");
                }
            }
            "recompute" => {
                recompute_and_emit_locked(&self.host, &mut state, "manual");
            }
            _ => {}
        }
        Ok(())
    }
}

impl Drop for AutomaticExtension {
    fn drop(&mut self) {
        self.stop();
    }
}

fn save_config_locked(host: &HostBridge, state: &mut RuntimeState, config: Value, action: &str) {
    state.config = config;
    match write_config(&state.data_dir, &state.config) {
        Ok(()) => {
            let rule_count = state
                .config
                .get("rules")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            let detail = match action {
                "set_enabled" => {
                    if state.config.get("enabled") == Some(&Value::Bool(true)) {
                        "enabled".to_string()
                    } else {
                        "disabled".to_string()
                    }
                }
                "delete_rule" => "rule deleted".to_string(),
                "reorder_rules" => "rule order updated".to_string(),
                _ => format!("{rule_count} rules"),
            };
            let title = match action {
                "set_enabled" => "Automation toggled",
                "delete_rule" => "Rule deleted",
                "reorder_rules" => "Rules reordered",
                _ => "Config saved",
            };
            state.push_activity("config", title, Some(detail));
            emit_snapshot_locked(host, state);
            recompute_and_emit_locked(host, state, action);
            host.emit_page(
                "save_result",
                json!({
                    "action": action,
                    "ok": true,
                    "config": state.config,
                }),
            );
        }
        Err(err) => emit_error_locked(host, state, action, &err),
    }
}

fn monitor_loop(host: HostBridge, state: Arc<Mutex<RuntimeState>>, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::SeqCst) {
        sleep_interruptible(&stop, MONITOR_INTERVAL);
        if stop.load(Ordering::SeqCst) {
            break;
        }

        let snapshot = monitor::collect_snapshot();
        let mut guard = match state.lock() {
            Ok(guard) => guard,
            Err(_) => {
                host.log(SKYDIMO_LOG_ERROR, "automatic state mutex poisoned");
                break;
            }
        };

        let mut process_changed = false;
        let mut focus_changed = false;
        if guard.process != snapshot.process {
            let changes = diff_process_apps(&guard.process.apps, &snapshot.process.apps);
            guard.process = snapshot.process.clone();
            let running_count = guard.process.apps.len();
            guard.push_activity(
                "process",
                "Process state changed",
                Some(format!("{} changes, {} running", changes.len(), running_count)),
            );
            process_changed = true;
        }

        if guard.focus != snapshot.focus {
            let current = snapshot.focus.current.clone().unwrap_or_default();
            guard.focus = snapshot.focus;
            guard.push_activity(
                "focus",
                "Focus state changed",
                Some(format!(
                    "{} | {}",
                    current.app_name.unwrap_or_else(|| "unknown".to_string()),
                    current.window_title.unwrap_or_else(|| "no title".to_string())
                )),
            );
            focus_changed = true;
        }

        if process_changed || focus_changed {
            let reason = match (process_changed, focus_changed) {
                (true, false) => "process_changed",
                (false, true) => "focus_changed",
                _ => "monitor_changed",
            };
            emit_system_state_locked(&host, &guard);
            recompute_and_emit_locked(&host, &mut guard, reason);
        }
    }
}

fn sleep_interruptible(stop: &AtomicBool, duration: Duration) {
    let chunk = Duration::from_millis(100);
    let mut slept = Duration::ZERO;
    while slept < duration && !stop.load(Ordering::SeqCst) {
        let next = (duration - slept).min(chunk);
        thread::sleep(next);
        slept += next;
    }
}

fn emit_snapshot_locked(host: &HostBridge, state: &RuntimeState) {
    host.emit_page(
        "snapshot",
        json!({
            "config": state.config,
            "devices": state.devices,
            "effects": state.effects,
        }),
    );
}

fn emit_system_state_locked(host: &HostBridge, state: &RuntimeState) {
    host.emit_page("system_state", state.system_state_json());
}

fn emit_scheduler_locked(host: &HostBridge, state: &RuntimeState) {
    host.emit_page("scheduler_state", state.scheduler.clone());
}

fn emit_activity_locked(host: &HostBridge, state: &RuntimeState) {
    host.emit_page("activity", state.activity_json());
}

fn emit_error_locked(host: &HostBridge, state: &mut RuntimeState, action: &str, message: &str) {
    state.push_activity("error", action, Some(message.to_string()));
    host.emit_page(
        "error",
        json!({
            "action": action,
            "message": message,
        }),
    );
    emit_activity_locked(host, state);
}

fn recompute_and_emit_locked(host: &HostBridge, state: &mut RuntimeState, reason: &str) {
    let result = recompute_locked(host, state, reason);
    emit_scheduler_locked(host, state);
    emit_activity_locked(host, state);
    if let Some(error) = result
        .errors
        .first()
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
    {
        host.emit_page(
            "error",
            json!({
                "action": "recompute",
                "message": error,
            }),
        );
    }
}

struct ApplyResult {
    applied: Vec<Value>,
    skipped: Vec<Value>,
    errors: Vec<Value>,
}

fn recompute_locked(host: &HostBridge, state: &mut RuntimeState, reason: &str) -> ApplyResult {
    let config = state.config.clone();
    let snapshot = state.system_state_json();
    let (candidates, mut rule_rows) = sorted_candidates(&config, &snapshot);
    let active_rule = candidates.first().map(|(_, rule)| rule.clone());
    let baseline_actions = config
        .get("baseline")
        .and_then(|baseline| baseline.get("actions"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let baseline_active = active_rule.is_none() && !baseline_actions.is_empty();

    let mut plan_key = None;
    let mut active_actions = Vec::new();
    let mut active_source = "none".to_string();
    let mut active_name = None;

    if config.get("enabled") != Some(&Value::Bool(false)) {
        if let Some(rule) = active_rule.as_ref() {
            let rule_id = rule.get("id").and_then(Value::as_str).unwrap_or_default();
            plan_key = Some(format!("rule:{rule_id}"));
            active_actions = rule
                .get("actions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            active_source = "rule".to_string();
            active_name = rule.get("name").and_then(Value::as_str).map(str::to_string);
        } else if baseline_active {
            plan_key = Some("baseline".to_string());
            active_actions = baseline_actions;
            active_source = "baseline".to_string();
            active_name = Some("Baseline".to_string());
        }
    }

    let active_rule_id = active_rule
        .as_ref()
        .and_then(|rule| rule.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string);
    for row in rule_rows.iter_mut() {
        if let Some(object) = row.as_object_mut() {
            let row_id = object.get("id").and_then(Value::as_str);
            object.insert(
                "active".into(),
                Value::Bool(active_rule_id.as_deref().is_some_and(|id| Some(id) == row_id)),
            );
        }
    }

    let apply_result = apply_actions(host, state, plan_key.as_deref(), &active_actions);
    let now = iso_now();
    let matched_rule_ids = candidates
        .iter()
        .filter_map(|(_, rule)| rule.get("id").and_then(Value::as_str).map(str::to_string))
        .collect::<Vec<_>>();

    let mut scheduler = Map::new();
    scheduler.insert(
        "enabled".into(),
        Value::Bool(config.get("enabled") != Some(&Value::Bool(false))),
    );
    scheduler.insert("matchedRuleIds".into(), json!(matched_rule_ids));
    if let Some(active_rule_id) = active_rule_id.clone() {
        scheduler.insert("activeRuleId".into(), Value::String(active_rule_id));
    }
    scheduler.insert("activeSource".into(), Value::String(active_source.clone()));
    if let Some(name) = active_name.clone() {
        scheduler.insert("activeName".into(), Value::String(name));
    }
    scheduler.insert("activeActions".into(), Value::Array(active_actions.clone()));
    scheduler.insert("rules".into(), Value::Array(rule_rows));
    scheduler.insert("lastRecomputeAt".into(), Value::String(now.clone()));
    if !apply_result.applied.is_empty() {
        scheduler.insert("lastAppliedAt".into(), Value::String(now.clone()));
    } else if let Some(previous) = state
        .scheduler
        .get("lastAppliedAt")
        .and_then(Value::as_str)
        .map(str::to_string)
    {
        scheduler.insert("lastAppliedAt".into(), Value::String(previous));
    }
    scheduler.insert("lastErrors".into(), Value::Array(apply_result.errors.clone()));
    state.scheduler = Value::Object(scheduler);

    let summary = stable_signature(&json!({
        "enabled": state.scheduler.get("enabled").cloned().unwrap_or(Value::Bool(true)),
        "matchedRuleIds": state.scheduler.get("matchedRuleIds").cloned().unwrap_or(Value::Array(Vec::new())),
        "activeRuleId": state.scheduler.get("activeRuleId").cloned().unwrap_or(Value::Null),
        "activeSource": active_source,
        "lastErrors": apply_result.errors,
    }));

    if state.previous_summary.as_deref() != Some(summary.as_str())
        || !apply_result.applied.is_empty()
        || !apply_result.errors.is_empty()
    {
        let detail = match state.scheduler.get("activeSource").and_then(Value::as_str) {
            Some("rule") => format!(
                "Applied rule {} ({}) after {}",
                state
                    .scheduler
                    .get("activeName")
                    .and_then(Value::as_str)
                    .or_else(|| state.scheduler.get("activeRuleId").and_then(Value::as_str))
                    .unwrap_or("unknown"),
                state
                    .scheduler
                    .get("activeRuleId")
                    .and_then(Value::as_str)
                    .unwrap_or("n/a"),
                reason
            ),
            Some("baseline") => format!("Applied baseline after {reason}"),
            _ if state.scheduler.get("enabled") == Some(&Value::Bool(false)) => {
                "Automation disabled, scheduler is idle".to_string()
            }
            _ => format!("No rule matched after {reason}"),
        };
        state.push_activity("scheduler", "Scheduler recomputed", Some(detail));
    }

    for error in &apply_result.errors {
        if let Some(message) = error.get("message").and_then(Value::as_str) {
            state.push_activity("error", "Action apply failed", Some(message.to_string()));
        }
    }
    state.previous_summary = Some(summary);

    apply_result
}

fn sorted_candidates(config: &Value, snapshot: &Value) -> (Vec<(usize, Value)>, Vec<Value>) {
    let mut candidates = Vec::new();
    let mut rule_rows = Vec::new();
    let rules = config
        .get("rules")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for (index, rule) in rules.iter().enumerate() {
        let enabled = rule.get("enabled") != Some(&Value::Bool(false));
        let matched = enabled && matches_group(rule.get("conditions").unwrap_or(&Value::Null), snapshot);
        rule_rows.push(json!({
            "id": rule.get("id").and_then(Value::as_str).unwrap_or_default(),
            "name": rule.get("name").and_then(Value::as_str).unwrap_or_default(),
            "enabled": enabled,
            "matched": matched,
            "active": false,
        }));
        if matched {
            candidates.push((index, rule.clone()));
        }
    }

    candidates.sort_by_key(|(index, _)| *index);
    (candidates, rule_rows)
}

fn apply_actions(
    host: &HostBridge,
    state: &mut RuntimeState,
    plan_key: Option<&str>,
    actions: &[Value],
) -> ApplyResult {
    let mut result = ApplyResult {
        applied: Vec::new(),
        skipped: Vec::new(),
        errors: Vec::new(),
    };
    let Some(plan_key) = plan_key else {
        state.current_plan_key = None;
        state.applied_signatures.clear();
        return result;
    };

    let mut next_signatures = BTreeMap::new();
    for action in actions {
        let scope_key = action.get("scope").and_then(scope_key);
        let signature = stable_signature(&action_signature(action));
        if let Some(scope_key) = scope_key.clone() {
            next_signatures.insert(scope_key.clone(), signature.clone());
        }

        if scope_key.as_ref().is_some_and(|key| {
            state.current_plan_key.as_deref() == Some(plan_key)
                && state.applied_signatures.get(key) == Some(&signature)
        }) {
            result.skipped.push(json!({
                "scope": action.get("scope").cloned().unwrap_or(Value::Null),
            }));
            continue;
        }

        match execute_action(host, action) {
            Ok(()) => result.applied.push(json!({
                "scope": action.get("scope").cloned().unwrap_or(Value::Null),
            })),
            Err(err) => {
                let mut row = Map::new();
                row.insert("message".into(), Value::String(err));
                if let Some(scope) = action.get("scope").cloned() {
                    row.insert("scope".into(), scope);
                }
                result.errors.push(Value::Object(row));
            }
        }
    }

    state.current_plan_key = Some(plan_key.to_string());
    state.applied_signatures = next_signatures;
    result
}

fn execute_action(host: &HostBridge, action: &Value) -> Result<(), String> {
    let scope = action
        .get("scope")
        .and_then(scope_from_any)
        .ok_or_else(|| "invalid scope".to_string())?;

    if action.get("powerOff") == Some(&Value::Bool(false)) {
        host.call_json("set_scope_power", &json!({ "scope": scope, "is_off": false }))?;
    }

    if let Some(effect_id) = action.get("effectId").and_then(Value::as_str) {
        host.call_json(
            "set_scope_effect",
            &json!({
                "scope": scope,
                "effect_id": effect_id,
                "params": action.get("params").cloned().unwrap_or_else(empty_object),
            }),
        )?;
    } else if !value_is_empty(action.get("params").unwrap_or(&Value::Null)) {
        host.call_json(
            "update_scope_effect_params",
            &json!({
                "scope": scope,
                "params": action.get("params").cloned().unwrap_or_else(empty_object),
            }),
        )?;
    }

    if let Some(brightness) = action.get("brightness").and_then(Value::as_u64) {
        host.call_json(
            "set_scope_brightness",
            &json!({ "scope": scope, "brightness": brightness.min(100) }),
        )?;
    }

    if let Some(paused) = action.get("paused").and_then(Value::as_bool) {
        host.call_json(
            "set_scope_mode_paused",
            &json!({ "scope": scope, "paused": paused }),
        )?;
    }

    if action.get("powerOff") == Some(&Value::Bool(true)) {
        host.call_json("set_scope_power", &json!({ "scope": scope, "is_off": true }))?;
    }

    Ok(())
}

fn action_signature(action: &Value) -> Value {
    json!({
        "scope": action.get("scope").and_then(scope_from_any),
        "effectId": action.get("effectId").and_then(Value::as_str),
        "params": action.get("params").cloned().unwrap_or_else(empty_object),
        "brightness": action.get("brightness").cloned().unwrap_or(Value::Null),
        "powerOff": action.get("powerOff").cloned().unwrap_or(Value::Null),
        "paused": action.get("paused").cloned().unwrap_or(Value::Null),
    })
}

fn matches_group(group: &Value, snapshot: &Value) -> bool {
    let Some(group) = group.as_object() else {
        return false;
    };
    let logic = if group.get("logic").and_then(Value::as_str) == Some("or") {
        "or"
    } else {
        "and"
    };
    let items = group
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut result = logic == "and";
    if logic == "or" {
        result = false;
    }

    for item in items {
        let matched = if item.get("items").is_some() {
            matches_group(&item, snapshot)
        } else {
            matches_condition(&item, snapshot)
        };
        if logic == "and" && !matched {
            result = false;
            break;
        }
        if logic == "or" && matched {
            result = true;
            break;
        }
    }

    if group.get("negated") == Some(&Value::Bool(true)) {
        !result
    } else {
        result
    }
}

fn matches_condition(condition: &Value, snapshot: &Value) -> bool {
    let Some(kind) = condition.get("kind").and_then(Value::as_str) else {
        return false;
    };
    match kind {
        "app_running" => {
            let Some(app_name) = condition.get("app_name").and_then(Value::as_str) else {
                return false;
            };
            snapshot
                .get("process")
                .and_then(|process| process.get("apps"))
                .and_then(Value::as_array)
                .is_some_and(|apps| {
                    apps.iter()
                        .any(|app| app.get("name").and_then(Value::as_str) == Some(app_name))
                })
        }
        "app_foreground" => {
            let app_name = condition.get("app_name").and_then(Value::as_str);
            snapshot
                .get("focus")
                .and_then(|focus| focus.get("current"))
                .and_then(|current| current.get("app_name"))
                .and_then(Value::as_str)
                == app_name
        }
        "window_title_contains" => {
            let Some(value) = condition.get("value").and_then(Value::as_str) else {
                return false;
            };
            snapshot
                .get("focus")
                .and_then(|focus| focus.get("current"))
                .and_then(|current| current.get("window_title"))
                .and_then(Value::as_str)
                .and_then(|title| normalize_name(Some(title)))
                .is_some_and(|title| title.contains(value))
        }
        _ => false,
    }
}

fn load_config(data_dir: &Path) -> Result<Value, String> {
    let path = data_dir.join("config.json");
    if !path.is_file() {
        return Ok(empty_config());
    }
    let bytes = std::fs::read(&path)
        .map_err(|err| format!("failed to read '{}': {err}", path.display()))?;
    let raw = serde_json::from_slice::<Value>(&bytes)
        .map_err(|err| format!("failed to parse '{}': {err}", path.display()))?;
    Ok(normalize_config(raw))
}

fn write_config(data_dir: &Path, config: &Value) -> Result<(), String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|err| format!("failed to create '{}': {err}", data_dir.display()))?;
    let path = data_dir.join("config.json");
    let bytes = serde_json::to_vec(config).map_err(|err| err.to_string())?;
    std::fs::write(&path, bytes)
        .map_err(|err| format!("failed to write '{}': {err}", path.display()))
}

fn refresh_effects(host: &HostBridge) -> Result<Value, String> {
    let effects = host.call_json("get_effects", &Value::Null)?;
    let mut rows = Vec::new();
    for effect in effects.as_array().cloned().unwrap_or_default() {
        let Some(object) = effect.as_object() else {
            continue;
        };
        let mut row = object.clone();
        if let Some(value) = object.get("name") {
            row.insert("name".into(), Value::String(resolve_localized_text(value)));
        }
        if let Some(value) = object.get("description") {
            row.insert(
                "description".into(),
                Value::String(resolve_localized_text(value)),
            );
        }
        if let Some(value) = object.get("group") {
            row.insert("group".into(), Value::String(resolve_localized_text(value)));
        }
        if let Some(effect_id) = object.get("id").and_then(Value::as_str) {
            let params = host
                .call_json("get_effect_params", &json!({ "effect_id": effect_id }))
                .unwrap_or_else(|_| Value::Array(Vec::new()));
            row.insert("params".into(), resolve_effect_params(params));
        } else {
            row.insert("params".into(), Value::Array(Vec::new()));
        }
        rows.push(Value::Object(row));
    }
    rows.sort_by(|left, right| {
        let left = left.get("name").and_then(Value::as_str).unwrap_or_default();
        let right = right.get("name").and_then(Value::as_str).unwrap_or_default();
        left.cmp(right)
    });
    Ok(Value::Array(rows))
}

fn refresh_devices(host: &HostBridge, payload: Option<Value>) -> Result<Value, String> {
    if let Some(payload) = payload {
        if payload.is_array() {
            return Ok(payload);
        }
    }
    let devices = host.call_json("get_devices", &Value::Null)?;
    Ok(if devices.is_array() {
        devices
    } else {
        Value::Array(Vec::new())
    })
}

fn resolve_effect_params(params: Value) -> Value {
    let mut rows = Vec::new();
    for param in params.as_array().cloned().unwrap_or_default() {
        let Some(object) = param.as_object() else {
            continue;
        };
        let mut row = object.clone();
        if let Some(value) = object.get("label") {
            row.insert("label".into(), Value::String(resolve_localized_text(value)));
        }
        if let Some(value) = object.get("group") {
            row.insert("group".into(), Value::String(resolve_localized_text(value)));
        }
        if let Some(options) = object.get("options").and_then(Value::as_array) {
            let resolved = options
                .iter()
                .filter_map(|option| {
                    let object = option.as_object()?;
                    let mut option = object.clone();
                    if let Some(label) = object.get("label") {
                        option.insert("label".into(), Value::String(resolve_localized_text(label)));
                    }
                    Some(Value::Object(option))
                })
                .collect::<Vec<_>>();
            row.insert("options".into(), Value::Array(resolved));
        }
        rows.push(Value::Object(row));
    }
    Value::Array(rows)
}

fn normalize_config(raw: Value) -> Value {
    let config = raw.as_object().cloned().unwrap_or_default();
    let rules = config
        .get("rules")
        .and_then(Value::as_array)
        .map(|rules| {
            rules
                .iter()
                .enumerate()
                .filter_map(|(index, rule)| normalize_rule(rule, index + 1))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "enabled": normalize_boolean(config.get("enabled"), true),
        "baseline": {
            "actions": normalize_actions(config.get("baseline").and_then(|baseline| baseline.get("actions"))),
        },
        "rules": rules,
    })
}

fn normalize_rule(rule: &Value, index: usize) -> Option<Value> {
    let object = rule.as_object()?;
    Some(json!({
        "id": trim_string_value(object.get("id")).unwrap_or_else(|| format!("rule_{}_{index:03}", unix_secs())),
        "enabled": normalize_boolean(object.get("enabled"), true),
        "name": trim_string_value(object.get("name")).unwrap_or_else(|| format!("Rule {index}")),
        "conditions": normalize_group(
            object
                .get("conditions")
                .or_else(|| object.get("condition_group"))
                .or_else(|| object.get("group")),
        ),
        "actions": normalize_actions(object.get("actions")),
    }))
}

fn normalize_actions(actions: Option<&Value>) -> Value {
    let rows = actions
        .and_then(Value::as_array)
        .map(|actions| actions.iter().filter_map(normalize_action).collect::<Vec<_>>())
        .unwrap_or_default();
    Value::Array(rows)
}

fn normalize_action(action: &Value) -> Option<Value> {
    let object = action.as_object()?;
    let scope = object.get("scope").and_then(scope_from_any)?;
    let mut row = Map::new();
    row.insert("scope".into(), scope);
    if let Some(effect_id) = trim_string_value(
        object
            .get("effectId")
            .or_else(|| object.get("effect_id")),
    ) {
        row.insert("effectId".into(), Value::String(effect_id));
    }
    row.insert(
        "params".into(),
        object
            .get("params")
            .filter(|value| value.is_object())
            .cloned()
            .unwrap_or_else(empty_object),
    );
    if let Some(brightness) = object.get("brightness").and_then(number_to_rounded_u64) {
        row.insert("brightness".into(), Value::Number((brightness.min(100)).into()));
    }
    if let Some(power_off) = object.get("powerOff").and_then(Value::as_bool) {
        row.insert("powerOff".into(), Value::Bool(power_off));
    }
    if let Some(paused) = object.get("paused").and_then(Value::as_bool) {
        row.insert("paused".into(), Value::Bool(paused));
    }
    Some(Value::Object(row))
}

fn normalize_group(group: Option<&Value>) -> Value {
    let Some(object) = group.and_then(Value::as_object) else {
        return json!({ "logic": "and", "negated": false, "items": [] });
    };
    let logic = if object.get("logic").and_then(Value::as_str) == Some("or") {
        "or"
    } else {
        "and"
    };
    let items = object
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    if item.get("items").is_some() || item.get("logic").is_some() {
                        Some(normalize_group(Some(item)))
                    } else {
                        normalize_condition(item)
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "logic": logic,
        "negated": object.get("negated") == Some(&Value::Bool(true)),
        "items": items,
    })
}

fn normalize_condition(condition: &Value) -> Option<Value> {
    let object = condition.as_object()?;
    let kind = trim_string_value(object.get("kind").or_else(|| object.get("type")))?.to_ascii_lowercase();
    if kind == "app_running" || kind == "app_foreground" {
        let app_name = normalize_name_value(
            object
                .get("app_name")
                .or_else(|| object.get("appName"))
                .or_else(|| object.get("value")),
        )?;
        return Some(json!({ "kind": kind, "app_name": app_name }));
    }
    if kind == "window_title_contains" {
        let value = normalize_name_value(object.get("value").or_else(|| object.get("text")))?;
        return Some(json!({ "kind": kind, "value": value }));
    }
    None
}

fn scope_from_any(value: &Value) -> Option<Value> {
    let object = value.as_object()?;
    let port = trim_string_value(object.get("port"))?;
    let output_id = trim_string_value(object.get("output_id").or_else(|| object.get("outputId")));
    let segment_id = trim_string_value(object.get("segment_id").or_else(|| object.get("segmentId")));
    if segment_id.is_some() && output_id.is_none() {
        return None;
    }
    let mut scope = Map::new();
    scope.insert("port".into(), Value::String(port));
    if let Some(output_id) = output_id {
        scope.insert("output_id".into(), Value::String(output_id));
    }
    if let Some(segment_id) = segment_id {
        scope.insert("segment_id".into(), Value::String(segment_id));
    }
    Some(Value::Object(scope))
}

fn scope_key(value: &Value) -> Option<String> {
    let scope = scope_from_any(value)?;
    Some(format!(
        "{}::{}::{}",
        scope.get("port").and_then(Value::as_str).unwrap_or_default(),
        scope.get("output_id").and_then(Value::as_str).unwrap_or_default(),
        scope.get("segment_id").and_then(Value::as_str).unwrap_or_default()
    ))
}

fn diff_process_apps(
    previous: &[ProcessApplication],
    current: &[ProcessApplication],
) -> Vec<ProcessApplicationChange> {
    let previous = previous
        .iter()
        .map(|app| (app.name.clone(), app.instance_count))
        .collect::<BTreeMap<_, _>>();
    let current = current
        .iter()
        .map(|app| (app.name.clone(), app.instance_count))
        .collect::<BTreeMap<_, _>>();
    let mut changes = Vec::new();
    for name in previous.keys().chain(current.keys()) {
        let prev = previous.get(name).copied().unwrap_or(0);
        let next = current.get(name).copied().unwrap_or(0);
        if prev != next && !changes.iter().any(|change: &ProcessApplicationChange| change.name == *name) {
            changes.push(ProcessApplicationChange {
                name: name.clone(),
                previous_instance_count: prev,
                current_instance_count: next,
            });
        }
    }
    changes.sort_by(|left, right| left.name.cmp(&right.name));
    changes
}

fn resolve_localized_text(value: &Value) -> String {
    if let Some(object) = value.as_object() {
        if let Some(by_locale) = object.get("byLocale").and_then(Value::as_object) {
            for locale in ["zh-CN", "en-US", "en"] {
                if let Some(text) = by_locale.get(locale).and_then(Value::as_str) {
                    return text.to_string();
                }
            }
        }
        if let Some(raw) = object.get("raw").and_then(Value::as_str) {
            return raw.to_string();
        }
        return String::new();
    }
    value.as_str().unwrap_or_default().to_string()
}

fn trim_string_value(value: Option<&Value>) -> Option<String> {
    let text = match value? {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(value) => value.to_string(),
        _ => return None,
    };
    let text = text.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn normalize_name(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

fn normalize_name_value(value: Option<&Value>) -> Option<String> {
    trim_string_value(value).and_then(|value| normalize_name(Some(value.as_str())))
}

fn normalize_boolean(value: Option<&Value>, fallback: bool) -> bool {
    value.map_or(fallback, |value| value == &Value::Bool(true))
}

fn number_to_rounded_u64(value: &Value) -> Option<u64> {
    if let Some(value) = value.as_u64() {
        return Some(value);
    }
    value.as_f64().map(|value| value.round().max(0.0) as u64)
}

fn value_is_empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Array(values) => values.is_empty(),
        Value::Object(values) => values.is_empty(),
        _ => false,
    }
}

fn stable_signature(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

fn empty_config() -> Value {
    json!({
        "enabled": true,
        "baseline": { "actions": [] },
        "rules": [],
    })
}

fn empty_scheduler_state() -> Value {
    json!({
        "enabled": true,
        "matchedRuleIds": [],
        "activeSource": "none",
        "activeActions": [],
        "rules": [],
        "lastErrors": [],
    })
}

fn empty_object() -> Value {
    Value::Object(Map::new())
}

fn set_object_field(value: &mut Value, key: &str, field: Value) {
    if !value.is_object() {
        *value = empty_object();
    }
    if let Some(object) = value.as_object_mut() {
        object.insert(key.to_string(), field);
    }
}

fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn iso_now() -> String {
    let total = unix_secs();
    let days = (total / 86_400) as i64;
    let seconds = total % 86_400;
    let hour = seconds / 3600;
    let minute = (seconds % 3600) / 60;
    let second = seconds % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + i64::from(m <= 2);
    (year, m as u32, d as u32)
}

mod monitor {
    use super::*;

    pub fn collect_snapshot() -> MonitorSnapshot {
        platform::collect_snapshot()
    }

    #[cfg(target_os = "windows")]
    mod platform {
        use super::*;

        const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
        const MAX_PATH: usize = 260;

        type Handle = *mut c_void;
        type Hwnd = isize;

        #[repr(C)]
        struct ProcessEntry32W {
            dw_size: u32,
            cnt_usage: u32,
            th32_process_id: u32,
            th32_default_heap_id: usize,
            th32_module_id: u32,
            cnt_threads: u32,
            th32_parent_process_id: u32,
            pc_pri_class_base: i32,
            dw_flags: u32,
            sz_exe_file: [u16; MAX_PATH],
        }

        impl Default for ProcessEntry32W {
            fn default() -> Self {
                Self {
                    dw_size: std::mem::size_of::<Self>() as u32,
                    cnt_usage: 0,
                    th32_process_id: 0,
                    th32_default_heap_id: 0,
                    th32_module_id: 0,
                    cnt_threads: 0,
                    th32_parent_process_id: 0,
                    pc_pri_class_base: 0,
                    dw_flags: 0,
                    sz_exe_file: [0; MAX_PATH],
                }
            }
        }

        #[link(name = "kernel32")]
        extern "system" {
            fn CreateToolhelp32Snapshot(dw_flags: u32, th32_process_id: u32) -> Handle;
            fn Process32FirstW(h_snapshot: Handle, lppe: *mut ProcessEntry32W) -> i32;
            fn Process32NextW(h_snapshot: Handle, lppe: *mut ProcessEntry32W) -> i32;
            fn CloseHandle(h_object: Handle) -> i32;
        }

        #[link(name = "user32")]
        extern "system" {
            fn GetForegroundWindow() -> Hwnd;
            fn GetWindowTextW(hwnd: Hwnd, lp_string: *mut u16, n_max_count: i32) -> i32;
            fn GetWindowThreadProcessId(hwnd: Hwnd, lpdw_process_id: *mut u32) -> u32;
        }

        pub fn collect_snapshot() -> MonitorSnapshot {
            let entries = match collect_process_entries() {
                Ok(entries) => entries,
                Err(_) => {
                    return MonitorSnapshot {
                        process: ProcessSnapshot {
                            supported: false,
                            apps: Vec::new(),
                        },
                        focus: FocusSnapshot {
                            supported: false,
                            current: None,
                        },
                    };
                }
            };

            MonitorSnapshot {
                process: process_snapshot(&entries),
                focus: focus_snapshot(&entries),
            }
        }

        fn collect_process_entries() -> Result<Vec<(u32, String)>, String> {
            let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
            if snapshot == invalid_handle() || snapshot.is_null() {
                return Err("CreateToolhelp32Snapshot failed".to_string());
            }

            let mut entries = Vec::new();
            let mut entry = ProcessEntry32W::default();
            let mut ok = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
            while ok {
                if let Some(name) = exe_name_from_wide(&entry.sz_exe_file) {
                    entries.push((entry.th32_process_id, name));
                }
                entry = ProcessEntry32W::default();
                ok = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
            }

            unsafe {
                CloseHandle(snapshot);
            }
            Ok(entries)
        }

        fn process_snapshot(entries: &[(u32, String)]) -> ProcessSnapshot {
            let mut counts = BTreeMap::<String, u32>::new();
            for (_, name) in entries {
                if let Some(name) = normalize_name(Some(name.as_str())) {
                    *counts.entry(name).or_insert(0) += 1;
                }
            }
            let apps = counts
                .into_iter()
                .map(|(name, instance_count)| ProcessApplication {
                    name,
                    instance_count,
                })
                .collect();
            ProcessSnapshot {
                supported: true,
                apps,
            }
        }

        fn focus_snapshot(entries: &[(u32, String)]) -> FocusSnapshot {
            let hwnd = unsafe { GetForegroundWindow() };
            if hwnd == 0 {
                return FocusSnapshot {
                    supported: true,
                    current: None,
                };
            }

            let mut process_id = 0u32;
            unsafe {
                GetWindowThreadProcessId(hwnd, &mut process_id);
            }
            let app_name = entries
                .iter()
                .find(|(pid, _)| *pid == process_id)
                .and_then(|(_, name)| normalize_name(Some(name.as_str())));
            let window_title = window_title(hwnd);
            let current = if app_name.is_some() || window_title.is_some() {
                Some(FocusTarget {
                    app_name,
                    window_title,
                })
            } else {
                None
            };
            FocusSnapshot {
                supported: true,
                current,
            }
        }

        fn window_title(hwnd: Hwnd) -> Option<String> {
            let mut buffer = [0u16; 2048];
            let len = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
            if len <= 0 {
                return None;
            }
            let title = String::from_utf16_lossy(&buffer[..len as usize]);
            let title = title.trim();
            if title.is_empty() {
                None
            } else {
                Some(title.to_string())
            }
        }

        fn exe_name_from_wide(raw: &[u16]) -> Option<String> {
            let end = raw.iter().position(|ch| *ch == 0).unwrap_or(raw.len());
            if end == 0 {
                return None;
            }
            let name = String::from_utf16_lossy(&raw[..end]);
            normalize_name(Some(name.as_str()))
        }

        fn invalid_handle() -> Handle {
            (-1isize) as Handle
        }
    }

    #[cfg(not(target_os = "windows"))]
    mod platform {
        use super::*;

        pub fn collect_snapshot() -> MonitorSnapshot {
            MonitorSnapshot {
                process: ProcessSnapshot {
                    supported: false,
                    apps: Vec::new(),
                },
                focus: FocusSnapshot {
                    supported: false,
                    current: None,
                },
            }
        }
    }
}

unsafe extern "C" fn automatic_create(
    host: *const SkydimoHostApiV1,
    out_instance: *mut *mut c_void,
) -> i32 {
    if out_instance.is_null() {
        return -1;
    }
    let extension = Box::new(AutomaticExtension::new(HostBridge::from_ptr(host)));
    unsafe {
        *out_instance = Box::into_raw(extension).cast::<c_void>();
    }
    0
}

unsafe extern "C" fn automatic_destroy(instance: *mut c_void) {
    if !instance.is_null() {
        unsafe {
            drop(Box::from_raw(instance.cast::<AutomaticExtension>()));
        }
    }
}

unsafe extern "C" fn automatic_start(instance: *mut c_void) -> i32 {
    let Some(extension) = extension_mut(instance) else {
        return -1;
    };
    match extension.start() {
        Ok(()) => 0,
        Err(err) => {
            extension.host.log(SKYDIMO_LOG_ERROR, &err);
            -2
        }
    }
}

unsafe extern "C" fn automatic_stop(instance: *mut c_void) -> i32 {
    let Some(extension) = extension_mut(instance) else {
        return -1;
    };
    extension.stop();
    0
}

unsafe extern "C" fn automatic_on_scan_devices(instance: *mut c_void) -> i32 {
    let Some(extension) = extension_mut(instance) else {
        return -1;
    };
    match extension.handle_event("devices-changed", Value::Null) {
        Ok(()) => 0,
        Err(err) => {
            extension.host.log(SKYDIMO_LOG_WARN, &err);
            -2
        }
    }
}

unsafe extern "C" fn automatic_on_event_json(
    instance: *mut c_void,
    event_ptr: *const c_char,
    event_len: usize,
    data_ptr: *const c_char,
    data_len: usize,
) -> i32 {
    let Some(extension) = extension_mut(instance) else {
        return -1;
    };
    let event = ptr_len_to_string(event_ptr, event_len);
    let data = parse_json_ptr(data_ptr, data_len).unwrap_or(Value::Null);
    match extension.handle_event(&event, data) {
        Ok(()) => 0,
        Err(err) => {
            extension.host.log(SKYDIMO_LOG_WARN, &err);
            -2
        }
    }
}

unsafe extern "C" fn automatic_on_page_message_json(
    instance: *mut c_void,
    data_ptr: *const c_char,
    data_len: usize,
) -> i32 {
    let Some(extension) = extension_mut(instance) else {
        return -1;
    };
    let data = match parse_json_ptr(data_ptr, data_len) {
        Ok(data) => data,
        Err(err) => {
            extension.host.log(SKYDIMO_LOG_WARN, &err);
            return -2;
        }
    };
    match extension.handle_page_message(data) {
        Ok(()) => 0,
        Err(err) => {
            extension.host.log(SKYDIMO_LOG_WARN, &err);
            -3
        }
    }
}

#[no_mangle]
/// # Safety
///
/// `out_api` must be a valid, writable pointer to a `SkydimoPluginApiV1`.
/// The host must pass the ABI version it expects in `requested_abi_version`.
pub unsafe extern "C" fn skydimo_plugin_get_api(
    requested_abi_version: u32,
    _host: *const SkydimoHostApiV1,
    out_api: *mut SkydimoPluginApiV1,
) -> i32 {
    if out_api.is_null() || requested_abi_version != SKYDIMO_NATIVE_C_ABI_VERSION {
        return -1;
    }

    unsafe {
        *out_api = SkydimoPluginApiV1 {
            size: std::mem::size_of::<SkydimoPluginApiV1>() as u32,
            abi_version: SKYDIMO_NATIVE_C_ABI_VERSION,
            kind_mask: SKYDIMO_PLUGIN_KIND_EXTENSION,
            effect: SkydimoEffectApiV1 {
                size: std::mem::size_of::<SkydimoEffectApiV1>() as u32,
                ..SkydimoEffectApiV1::default()
            },
            controller: SkydimoControllerApiV1 {
                size: std::mem::size_of::<SkydimoControllerApiV1>() as u32,
                ..SkydimoControllerApiV1::default()
            },
            extension: SkydimoExtensionApiV1 {
                size: std::mem::size_of::<SkydimoExtensionApiV1>() as u32,
                create: Some(automatic_create),
                destroy: Some(automatic_destroy),
                start: Some(automatic_start),
                stop: Some(automatic_stop),
                on_scan_devices: Some(automatic_on_scan_devices),
                on_event_json: Some(automatic_on_event_json),
                on_page_message_json: Some(automatic_on_page_message_json),
                on_device_frame: None,
            },
            shutdown_plugin: None,
        };
    }
    0
}

unsafe fn extension_mut(instance: *mut c_void) -> Option<&'static mut AutomaticExtension> {
    if instance.is_null() {
        None
    } else {
        Some(unsafe { &mut *instance.cast::<AutomaticExtension>() })
    }
}

fn parse_json_ptr(ptr: *const c_char, len: usize) -> Result<Value, String> {
    if ptr.is_null() || len == 0 {
        return Ok(Value::Null);
    }
    let bytes = unsafe { std::slice::from_raw_parts(ptr.cast::<u8>(), len) };
    serde_json::from_slice(bytes).map_err(|err| err.to_string())
}

fn ptr_len_to_string(ptr: *const c_char, len: usize) -> String {
    if ptr.is_null() || len == 0 {
        return String::new();
    }
    let bytes = unsafe { std::slice::from_raw_parts(ptr.cast::<u8>(), len) };
    String::from_utf8_lossy(bytes).into_owned()
}
