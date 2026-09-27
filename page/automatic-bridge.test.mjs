import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

// Bundle the actual bridge/session helper in memory. The only available socket
// is this synchronous fake: no network, credentials, Core or browser is used.
function harness(code) {
  const sockets = [], events = [], statuses = [], timers = new Map()
  let nextTimer = 0
  class FakeSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSED = 3
    readyState = 0
    sent = []
    constructor(url) { this.url = url; sockets.push(this) }
    send(value) { this.sent.push(JSON.parse(value)) }
    open() { this.readyState = 1; this.onopen?.({}) }
    receive(value) { this.onmessage?.({ data: JSON.stringify(value) }) }
    close() { this.readyState = 3; this.onclose?.({}) }
  }
  const context = vm.createContext({
    WebSocket: FakeSocket, URLSearchParams,
    window: { __SKYDIMO_EXT_PAGE__: { extId: 'automatic', wsUrl: 'ws://owned.invalid', wsToken: 'synthetic-only', locale: 'en-US' } },
    navigator: { language: 'en-US', languages: [] },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
  })
  vm.runInContext(code, context)
  const bridge = context.OwnedAutomaticBridge.bridge
  bridge.subscribe(event => events.push(event))
  bridge.subscribeStatus(status => statuses.push(status))
  function authenticate() {
    bridge.connect()
    const socket = sockets.at(-1)
    socket.open()
    socket.receive({ jsonrpc: '2.0', id: 'skydimo-page-authenticate', result: { authenticated: true } })
    socket.receive({ jsonrpc: '2.0', id: socket.sent.at(-1).id, result: null })
    return socket
  }
  const notify = (socket, type, data) => socket.receive({ method: 'event', params: {
    event: 'ext-page-message:automatic', data: { type, data },
  } })
  return { bridge, sockets, events, statuses, timers, authenticate, notify }
}

test('actual Automatic bridge keeps authentication, correlation and uncertainty boundaries', async t => {
  const bundle = await build({
    configFile: false, envFile: false, root: fileURLToPath(new URL('./', import.meta.url)),
    build: { write: false, emptyOutDir: false, copyPublicDir: false, minify: false,
      lib: { entry: fileURLToPath(new URL('./src/bridge.ts', import.meta.url)), formats: ['iife'], name: 'OwnedAutomaticBridge' } },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error',
  })
  const code = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(result => result.output)
    .filter(item => item.type === 'chunk').map(item => item.code).join('\n')
  await t.test('mutations are rejected until authentication and missing config stays invalid', () => {
    const h = harness(code)
    try {
      assert.equal(h.bridge.send('save_config', {}), false)
      h.bridge.connect()
      const socket = h.sockets[0]
      socket.open()
      assert.equal(h.bridge.send('save_config', {}), false)
      assert.deepEqual(socket.sent.map(row => row.method), ['authenticate'])
      socket.receive({ id: 'skydimo-page-authenticate', result: { authenticated: true } })
      assert.equal(h.statuses.at(-1), 'connected')
      h.notify(socket, 'snapshot', { devices: [] })
      assert.equal(h.events.at(-1).data.config, undefined, 'Missing snapshot is not an editable empty config')
      h.notify(socket, 'save_result', { action: 'save_config', requestId: 'page:1', ok: 'true' })
      assert.equal(h.events.at(-1).data.ok, false)
      assert.equal(h.events.at(-1).data.config, undefined)
      assert.equal(h.events.at(-1).data.requestId, 'page:1')
    } finally { h.bridge.disconnect() }
    assert.equal(h.timers.size, 0)
  })
  await t.test('RPC error echoes mutation ID and RPC timeout remains explicitly indeterminate', () => {
    const h = harness(code)
    try {
      const socket = h.authenticate()
      assert.equal(h.bridge.send('save_config', { requestId: 'page:1' }), true)
      const first = socket.sent.at(-1)
      socket.receive({ id: first.id, error: { code: 123, message: 'synthetic rejection' } })
      assert.equal(h.events.at(-1).data.requestId, 'page:1')
      assert.equal(h.events.at(-1).data.action, 'save_config')
      assert.equal(h.events.at(-1).data.outcomeUnknown, false)
      h.bridge.send('save_config', { requestId: 'page:2' })
      assert.equal(h.timers.size, 1)
      const [id, timer] = h.timers.entries().next().value
      assert.equal(timer.delay, 30000)
      h.timers.delete(id)
      timer.callback()
      assert.equal(h.events.at(-1).data.requestId, 'page:2')
      assert.equal(h.events.at(-1).data.outcomeUnknown, true)
    } finally { h.bridge.disconnect() }
    assert.equal(h.timers.size, 0)
  })
  await t.test('unknown ownership is preserved and detached sockets cannot publish late results', () => {
    const h = harness(code)
    try {
      const socket = h.authenticate()
      h.notify(socket, 'scheduler_state', {})
      assert.equal(h.events.at(-1).data.lastSkipped, undefined)
      h.notify(socket, 'scheduler_state', { lastSkipped: [null, { reason: 'future_reason' }, { reason: 'unchanged' }] })
      assert.equal(h.events.at(-1).data.lastSkipped.length, 3)
      assert.equal(h.events.at(-1).data.lastSkipped[1].reason, 'future_reason')
      h.bridge.disconnect()
      h.authenticate()
      const count = h.events.length
      h.notify(socket, 'save_result', { action: 'save_config', requestId: 'late', ok: true })
      assert.equal(h.events.length, count)
    } finally { h.bridge.disconnect() }
    assert.equal(h.timers.size, 0)
  })
})
