import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, expect } from '@playwright/test'

// Real App, Chakra, translations, drawers and normalization; synthetic bridge only.
// No server, Core, native plugin, hardware, credentials, or user browser profile.
// Vite writes nothing. Optional screenshots go in the parent repository's ignored
// outputs/ directory, unique per test invocation; never overwrite release page/dist.
const root = fileURLToPath(new URL('./', import.meta.url))
const source = relative => JSON.stringify(fileURLToPath(new URL(relative, import.meta.url)).replaceAll('\\', '/'))
const entry = path.join(root, 'owned-automatic-app-fixture.js')
const entryId = '\0owned-automatic-app-fixture'
const bridgeId = '\0owned-automatic-app-bridge'
const opaque = { kind: 'future_condition', items: [{ token: [true, null, 'keep'] }], extra: 'preserve' }
const config = {
  enabled: true, baseline: { actions: [] }, rules: [{
    id: 'media-rule', enabled: true, name: 'Media rule', actions: [],
    conditions: { logic: 'and', negated: false, items: [
      { kind: 'media_playing' }, { kind: 'media_source_app', source_app_id: 'Synthetic.Player!App' }, opaque,
    ] },
  }],
}
const snapshot = { config, devices: [], effects: [] }
const mockBridge = `
  const listeners = new Set(), statusListeners = new Set();
  let status = 'disconnected';
  window.fixtureEmit = event => listeners.forEach(listener => listener(event));
  window.fixtureStatus = next => { status = next; statusListeners.forEach(listener => listener(next)); };
  export const bridge = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeStatus(listener) { statusListeners.add(listener); listener(status); return () => statusListeners.delete(listener); },
    connect() { window.fixtureStatus('connected'); window.fixtureEmit({type:'snapshot',data:window.fixtureInitial}); },
    disconnect() { window.fixtureStatus('disconnected'); },
    send(type, payload = {}) { window.fixtureRequests.push({type,...payload}); return window.fixtureCanSend; },
  };
`
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import App from ${source('./src/App.tsx')};
  import { AppProvider } from ${source('./src/theme.tsx')};
  import ${source('./src/theme.css')};
  createRoot(document.getElementById('root')).render(React.createElement(AppProvider,null,React.createElement(App)));
`

test('isolated actual Automatic page: ownership feedback and correlated, lossless saves', async t => {
  const bundle = await build({
    configFile: false, envFile: false, root,
    plugins: [{
      name: 'owned-automatic-app-fixture', enforce: 'pre',
      resolveId(id, importer) {
        if (id.replaceAll('\\', '/') === entry.replaceAll('\\', '/')) return entryId
        if (id === './bridge' && importer?.replaceAll('\\', '/').endsWith('/src/App.tsx')) return bridgeId
      },
      load(id) { if (id === entryId) return fixture; if (id === bridgeId) return mockBridge },
    }, react()],
    resolve: { dedupe: ['react', 'react-dom', '@chakra-ui/react', '@emotion/react'] },
    build: { write: false, emptyOutDir: false, copyPublicDir: false, minify: false,
      lib: { entry, formats: ['iife'], name: 'OwnedAutomaticFixture' } },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error',
  })
  const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(result => result.output)
  const chunks = output.filter(item => item.type === 'chunk')
  const moduleIds = chunks.flatMap(chunk => chunk.moduleIds).map(id => id.replaceAll('\\', '/'))
  assert.ok(moduleIds.some(id => id.endsWith('/src/App.tsx')), 'Actual product App must be bundled')
  assert.ok(moduleIds.includes(bridgeId))
  assert.deepEqual(moduleIds.filter(id => /\/(?:bridge|extensionPageSession)\.[cm]?[jt]sx?$|\/services\//i.test(id)), [], 'No production transport is bundled')
  const code = chunks.map(item => item.code).join('\n')
  const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n')
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chromium.executablePath()) ? {} : { channel: 'msedge' }) })
  let screenshotDir
  if (process.env.SKYDIMO_KEEP_UI_TEST_ARTIFACTS === '1') {
    const outputs = fileURLToPath(new URL('../../../../outputs/', import.meta.url))
    fs.mkdirSync(outputs, { recursive: true })
    screenshotDir = fs.mkdtempSync(path.join(outputs, 'automatic-isolated-ui-'))
    t.diagnostic(`Retained synthetic browser screenshots: ${screenshotDir}`)
  }
  async function open({ locale = 'en-US', colorScheme = 'light', width = 1024, initial = snapshot } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const requests = [], errors = []
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
    page.on('pageerror', error => errors.push(error.message))
    await page.clock.install()
    await page.goto('about:blank')
    await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
    await page.evaluate(({ locale, initial }) => {
      window.__SKYDIMO_EXT_PAGE__ = { locale }
      window.fixtureInitial = initial
      window.fixtureRequests = []
      window.fixtureCanSend = true
      window.fixtureSocketAttempts = 0
      window.WebSocket = class { constructor() { window.fixtureSocketAttempts += 1; throw new Error('Real sockets forbidden in fixture') } }
    }, { locale, initial })
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: code })
    await page.getByRole('heading', { name: locale === 'zh-CN' ? '自动化' : 'Automatic', exact: true }).waitFor()
    if (initial.config) {
      await expect(page.getByRole('button', { name: locale === 'zh-CN' ? '新增规则' : 'Add Rule', exact: true })).toBeEnabled()
      for (const rule of initial.config.rules) await expect(page.getByText(rule.name, { exact: true })).toBeVisible()
    }
    return { page, async close() {
      assert.deepEqual(requests, [], 'No HTTP request was attempted')
      assert.deepEqual(errors, [])
      assert.equal(await page.evaluate(() => window.fixtureSocketAttempts), 0, 'No WebSocket was constructed')
      await context.close()
    } }
  }
  const emit = (page, type, data) => page.evaluate(event => window.fixtureEmit(event), { type, data })
  const mutations = page => page.evaluate(() => window.fixtureRequests.filter(row => ['save_config', 'set_enabled', 'delete_rule', 'reorder_rules'].includes(row.type)))
  const settle = (page, request, ok = true, extra = {}) => emit(page, 'save_result', {
    action: request.type, requestId: request.requestId, ok, config: request.config ?? config, ...extra,
  })
  try {
    await t.test('media edits survive failure, unrelated/old replies, duplicate input, and baseline save', async () => {
      const instance = await open()
      const { page } = instance
      try {
        await expect(page.getByRole('button', { name: 'Add Rule', exact: true })).toBeEnabled()
        await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
        const dialog = page.getByRole('dialog')
        await dialog.getByLabel('Name', { exact: true }).fill('Renamed media rule')
        await dialog.getByLabel('Media AppUserModelId', { exact: true }).fill('Changed.Player!App')
        await expect(dialog.getByText(/^Unsupported or malformed condition/)).toBeVisible()
        const save = dialog.getByRole('button', { name: 'Save', exact: true })
        await save.click()
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        let submitted = await mutations(page)
        assert.equal(submitted.length, 1, 'Repeated keyboard input sends one request while busy')
        const first = submitted[0]
        assert.match(first.requestId, /^[a-f0-9]{32}:1$/)
        assert.deepEqual(first.config.rules[0].conditions.items, [config.rules[0].conditions.items[0],
          { kind: 'media_source_app', source_app_id: 'Changed.Player!App' }, opaque])
        await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
        await emit(page, 'snapshot', snapshot)
        await settle(page, first, true, { requestId: 'other-page' })
        await settle(page, first, true, { requestId: undefined })
        await settle(page, first, true, { action: 'set_enabled' })
        await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
        await settle(page, first, false)
        await expect(dialog.getByText('The change could not be saved. Your draft is still available.')).toBeVisible()
        await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Renamed media rule')
        await expect(page.getByText('Configuration saved.', { exact: true })).toHaveCount(0)
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'save-failed-draft.png'), fullPage: true, animations: 'disabled' })
        await save.click()
        submitted = await mutations(page)
        assert.equal(submitted.length, 2)
        assert.notEqual(submitted[1].requestId, first.requestId)
        await settle(page, first)
        await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
        await settle(page, submitted[1])
        await expect(dialog).toHaveCount(0)
        await expect(page.getByText('Configuration saved.', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Edit', exact: true }).last().click()
        await dialog.getByRole('button', { name: 'Save', exact: true }).click()
        const baselineSave = (await mutations(page)).at(-1)
        assert.deepEqual(baselineSave.config.rules, submitted[1].config.rules, 'Unrelated baseline save preserves media and future conditions')
        await settle(page, baselineSave)
        await expect(dialog).toHaveCount(0)
      } finally { await instance.close() }
    })

    await t.test('timeout keeps draft and blocks blind retry until explicit reload; late result cannot settle next request', async () => {
      const instance = await open()
      const { page } = instance
      try {
        await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
        const dialog = page.getByRole('dialog')
        await dialog.getByLabel('Name', { exact: true }).fill('Timeout draft')
        await dialog.getByRole('button', { name: 'Save', exact: true }).click()
        const first = (await mutations(page))[0]
        await emit(page, 'error', { action: first.type, requestId: first.requestId, outcomeUnknown: true, message: 'Core request timed out' })
        await expect(dialog.getByRole('button', { name: 'Reload state', exact: true })).toBeVisible()
        await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
        await page.clock.fastForward(30001)
        await expect(dialog.getByRole('button', { name: 'Reload state', exact: true })).toBeVisible()
        await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
        await dialog.getByRole('button', { name: 'Reload state', exact: true }).click()
        await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
        await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Timeout draft')
        await dialog.getByRole('button', { name: 'Save', exact: true }).click()
        await settle(page, first)
        await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
        const second = (await mutations(page))[1]
        await emit(page, 'error', { action: 'save_config', requestId: second.requestId, message: 'CORE_TOKEN=PRIVATE_SENTINEL C:\\private\\config' })
        await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
        assert.doesNotMatch(await page.locator('body').innerText(), /PRIVATE_SENTINEL|C:\\private/)
      } finally { await instance.close() }
    })

    await t.test('incomplete snapshot cannot enable edits; disconnected save never claims success', async () => {
      const instance = await open({ initial: { devices: [], effects: [] } })
      const { page } = instance
      try {
        await expect(page.getByRole('button', { name: 'Add Rule', exact: true })).toBeDisabled()
        await emit(page, 'snapshot', snapshot)
        const enabled = page.getByRole('checkbox', { name: 'Automation enabled', exact: true })
        await enabled.press('Space')
        assert.equal((await mutations(page)).length, 1)
        await page.evaluate(() => window.fixtureStatus('disconnected'))
        await expect(page.getByText(/^Save outcome is unknown/)).toBeVisible()
        await expect(page.getByRole('button', { name: 'Add Rule', exact: true })).toBeDisabled()
        await settle(page, (await mutations(page))[0])
        await expect(page.getByText('Configuration saved.', { exact: true })).toHaveCount(0)
        await page.evaluate(() => window.fixtureStatus('connected'))
        await expect(page.getByRole('button', { name: 'Add Rule', exact: true })).toBeDisabled()
        await emit(page, 'snapshot', snapshot)
        await expect(page.getByRole('button', { name: 'Add Rule', exact: true })).toBeEnabled()
      } finally { await instance.close() }
    })

    for (const locale of ['en-US', 'zh-CN']) for (const colorScheme of ['light', 'dark']) {
      await t.test(`${locale} ${colorScheme}: manual priority, other holds, unknown compatibility, narrow layout`, async () => {
        const instance = await open({ locale, colorScheme, width: 375 })
        const { page } = instance
        try {
          await expect(page.getByText(locale === 'en-US' ? 'Control status is unavailable from this plugin version.' : '此插件版本尚未提供控制状态。')).toBeVisible()
          await emit(page, 'scheduler_state', {
            activeSource: 'rule', activeRuleId: 'media-rule', activeName: 'Media rule', activeActions: [], matchedRuleIds: ['media-rule'],
            rules: [{ id: 'media-rule', active: true, matched: true }], lastErrors: [{ message: 'PRIVATE_SENTINEL' }],
            lastSkipped: ['manual_override', 'calibration', 'preview', 'busy', 'linked_control', 'offline', 'future_reason', 'unchanged']
              .map(reason => ({ scope: { port: `synthetic-${reason}` }, reason })),
          })
          const notice = page.getByRole('status').filter({ hasText: locale === 'en-US' ? 'Plan and control status' : '计划与控制状态' })
          await expect(notice.getByText(locale === 'en-US' ? 'synthetic-manual_override — Manual control has priority' : 'synthetic-manual_override — 手动控制优先', { exact: true })).toBeVisible()
          assert.equal(await notice.getByText(/synthetic-/).count(), 7, 'unchanged is not displayed as yielding control')
          assert.doesNotMatch(await page.locator('body').innerText(), /PRIVATE_SENTINEL|synthetic-unchanged/)
          await expect(page.getByText(locale === 'en-US' ? 'Selected plan' : '已选计划', { exact: true })).toBeVisible()
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'Narrow fixture has no horizontal overflow')
          if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `manual-priority-${locale}-${colorScheme}.png`), fullPage: true, animations: 'disabled' })
          await emit(page, 'scheduler_state', { lastSkipped: [], lastErrors: [] })
          await expect(page.getByText(locale === 'en-US' ? 'No held actions were reported.' : '未报告被暂停的动作。')).toBeVisible()
        } finally { await instance.close() }
      })
    }
  } finally { await browser.close() }
})
