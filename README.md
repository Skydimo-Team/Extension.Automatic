# Automatic native extension

This Windows native extension evaluates application/window and media-session
conditions, then applies the first matching rule in the configured list. Existing
rule order, baseline actions, action caching and restore behavior are unchanged.

## Media-session conditions

The extension requests `media:session`. It reads the existing Host
`get_media_session` snapshot at startup and refreshes it when
`system.media.changed` or `system.media.playback_changed` invalidates it. Event
payloads are not copied over newer snapshots. While the extension is running,
its existing monitor thread also reconciles the Host cache at most once every
5 seconds (no catch-up burst). This recovers a missed Core-to-plugin event.
Timeline-only changes and track metadata do not affect rules. No audio capture,
RMS detection, extra thread or additional OS media collector is added.

`media_playing` means the **current Core media session reports playing**, not that
the computer is producing audible sound. Muted players may report playing; games,
unregistered players and other audio without a media session are not detected.
This is not an enumeration of every media session on the computer.

```json
{
  "logic": "and",
  "negated": false,
  "items": [
    { "kind": "media_playing" },
    { "kind": "media_source_app", "source_app_id": "example.player_123!app" }
  ]
}
```

- `media_playing` has no additional fields. Only `playing` matches; valid `paused`
  and `stopped` states do not match and may be negated.
- `media_source_app` compares `source_app_id` using exact, trimmed,
  ASCII-case-insensitive equality. This is the media source AppUserModelId, **not**
  the process executable name used by `app_running` / `app_foreground`. It does not
  require playback by itself; combine it with `media_playing` as above.
- Missing session, failed Host query, unsupported platform or invalid playback
  status is **unknown**, not paused/stopped. A rule referencing an unknown media
  condition is ineligible, even within a negated group or an OR with another true
  condition. Missing/invalid source identity similarly blocks rules that reference
  `media_source_app`, but does not block a valid `media_playing` condition.
- Blank/non-string `source_app_id` is retained as an invalid condition on config
  normalization, so it cannot disappear into an unconditional empty AND group.
- Existing configurations need no migration: application/window-only conditions
  and baseline behavior do not depend on the new media state.

`system_state` page events now include the following additive field:

```json
{
  "media": {
    "supported": true,
    "available": true,
    "playback_status": "playing",
    "source_app_id": "example.player_123!app"
  }
}
```

`supported` reflects the current Windows media backend, while `available` requires
a valid current Host snapshot. Unknown state has `available: false` and null
`playback_status` / `source_app_id`. A known playback state can still have a null
source ID. Only status and source ID are cached/emitted: title, artist and artwork
are discarded. The existing snapshot Host includes artwork, so each snapshot query
requests its minimum size (`max_edge: 1`); it does not add an album-art permission.
That getter only reads Core's existing memory cache and samples one cached pixel;
it does not perform thumbnail I/O. Unchanged reconciliations do not recompute or
repeat actions. Host errors clear the old media state to unknown; later successful
reconciliation can recover it. Monitoring stops with the extension.

Core reports `playback_status: "unknown"` if Windows playback information fails,
is transitional, or is unrecognized; only an explicit Windows `Stopped` maps to
`stopped`. Consumers must not label unknown as stopped or use it as a negated
condition. This adds a status value, not a Native ABI layout change.

This is not end-to-end delivery or freshness assurance: the current Windows Core
watcher is still event-driven. If Windows-to-Core notifications themselves are
lost, or that watcher fails, rereading its cache cannot manufacture fresh OS
state. A watcher-side reconciliation/health design is separate follow-up work.

## Condition editor and lossless saves

The source page editor exposes `media_playing` and `media_source_app`. The latter
has its own AppUserModelId field; it does not reuse the executable-name picker.
Inline English, Simplified Chinese and Traditional Chinese hints explain current
media-session semantics and unknown-state handling; other existing locales fall
back to English for these new hints. Existing Chakra components and theme tokens
are retained. The live-state panel is not a full media-session browser.

Both page normalization and native config normalization preserve unsupported
condition leaves, including opaque payload fields named `items` / `logic` and
non-object JSON values. The page displays an unsupported/malformed notice instead
of converting them to application conditions. An unrelated rule, baseline or
enable-state edit cannot remove those leaves. Only explicit removal or an explicit
change of an editable condition type replaces a condition in the editor.

Before evaluating AND / OR / NOT, the native scheduler validates the entire tree.
Any unsupported condition, missing/blank application or window operand, invalid
media source identity, or malformed group makes the **whole rule ineligible**.
This is deliberately more conservative than treating an unknown leaf as `false`,
which NOT or an OR with another true condition could turn into a match. Invalid
known leaves are not discarded by normalization. Valid legacy application/window
conditions and explicit empty groups retain their behavior; genuinely absent
conditions still use the existing default empty AND. Malformed present roots are
preserved as an ineligible leaf rather than silently becoming that default.

These are source changes only. Ship the updated page and native plugin together:
older native builds may still discard kinds they do not recognize. No installed
DLL or `page/dist` output is replaced by the pure tests below.

## Verification

```powershell
cargo test --manifest-path plugins/dev/extension.automatic/Cargo.toml --locked
cargo clippy --manifest-path plugins/dev/extension.automatic/Cargo.toml --locked --all-targets --all-features -- -D warnings
npm --prefix plugins/dev/extension.automatic/page test
node --test plugins/dev/extension.automatic/page/condition-editor-ui.test.mjs
node plugins/dev/extension.automatic/page/node_modules/typescript/bin/tsc -p plugins/dev/extension.automatic/page/tsconfig.app.json --noEmit
```

Tests use synthetic snapshots and a fake Native Host. They do not start the
extension/Core, collect processes/current media, capture audio or operate hardware.
Tests do not replace the installed `native/windows-x86_64/automatic.dll`.
The page tests import the same pure normalizer used for snapshots and save results;
they exercise media/opaque-data round trips and unrelated rule/baseline edits without
a browser, bridge connection or DOM. Rust condition tests also check nested NOT/OR
and malformed inputs after JSON save/load. Type checking emits no page bundle.

The separate editor UI test runs from the main Skydimo workspace with its existing
Playwright dependency and this page's installed frontend dependencies. It renders
only the real condition editor in an owned, headless browser with network blocked;
it does not load App, the bridge, Core or a plugin. It covers keyboard interaction,
media identity inputs, opaque sibling preservation, dark/light themes and narrow
viewports. Vite builds in memory (`write: false`). Screenshots are off by default;
`SKYDIMO_KEEP_UI_TEST_ARTIFACTS=1` explicitly retains them in a unique temporary
directory for review. Such retained screenshots require later manual cleanup.

References: [Windows media sessions and source identity](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession),
[Rust test execution](https://doc.rust-lang.org/cargo/commands/cargo-test.html).
