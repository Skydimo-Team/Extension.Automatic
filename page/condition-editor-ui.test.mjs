import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from '@playwright/test'

// Run from the workspace: node --test plugins/dev/extension.automatic/page/condition-editor-ui.test.mjs
// Uses existing workspace Playwright and child Vite/React/Chakra. No App, bridge,
// API, dev server, plugin, or Core is started. No bundle or screenshot is written
// unless SKYDIMO_KEEP_UI_TEST_ARTIFACTS=1 explicitly retains review screenshots.
const source = relative => JSON.stringify(fileURLToPath(new URL(relative, import.meta.url)).replaceAll('\\', '/'))
const entry = fileURLToPath(new URL('./owned-condition-editor-fixture.js', import.meta.url))
const virtualId = '\0owned-condition-editor-fixture.js'
const opaque = { kind: 'future_condition', logic: 'custom', items: [{ payload: [1, true, null] }], extra: 'preserve' }
const group = {
  logic: 'and', negated: false, groupExtra: { keep: true }, items: [
    { kind: 'app_running', app_name: 'synthetic.exe' },
    { kind: 'media_source_app', source_app_id: 'Example.Player_123!App', extra: { keep: true } },
    opaque,
    null,
    { logic: 'and', negated: false, items: [opaque, { kind: 'media_playing' }] },
  ],
}
const fixture = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { ConditionGroupEditor } from ${source('./src/components/ConditionGroupEditor.tsx')};
  import { AppProvider } from ${source('./src/theme.tsx')};
  import { normalizeConditionGroup } from ${source('./src/config.ts')};
  import ${source('./src/theme.css')};
  const h = React.createElement;
  function Fixture() {
    const [group, setGroup] = useState(() => normalizeConditionGroup(window.fixtureInitial));
    const change = next => {
      window.fixtureChanges += 1;
      window.fixtureCurrent = JSON.parse(JSON.stringify(next));
      setGroup(next);
    };
    return h(AppProvider, null, h('main', { 'data-testid': 'condition-editor-fixture', style: { padding: 12 } },
      h(ConditionGroupEditor, { group, onChange: change, runningApps: ['synthetic.exe'] }),
      h('datalist', { id: 'automatic-running-apps' }, h('option', { value: 'synthetic.exe' }))));
  }
  createRoot(document.getElementById('root')).render(h(Fixture));
`

async function minimumTextContrast(locator) {
  return locator.evaluateAll(elements => {
    if (elements.length === 0) throw new Error('Expected visible text for contrast measurement')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    // The browser converts CSS colors (including oklch) to sRGB. Compose each
    // translucent ancestor background before applying WCAG relative luminance.
    const rgba = value => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
      return [r, g, b, a / 255]
    }
    const over = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]))
    const background = element => {
      if (!element) return [255, 255, 255]
      const style = getComputedStyle(element)
      if (style.opacity !== '1' || style.backgroundImage !== 'none') throw new Error('Contrast fixture requires opaque layout layers without background images')
      return over(rgba(style.backgroundColor), background(element.parentElement))
    }
    const luminance = color => color.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
    return Math.min(...elements.map(element => {
      const bg = background(element)
      const lightness = [luminance(over(rgba(getComputedStyle(element).color), bg)), luminance(bg)].sort((a, b) => b - a)
      return (lightness[0] + 0.05) / (lightness[1] + 0.05)
    }))
  })
}

test('actual condition editor preserves opaque data and supports media inputs without Core', async t => {
  const bundle = await build({
    configFile: false, envFile: false, root: fileURLToPath(new URL('./', import.meta.url)),
    plugins: [{
      name: 'owned-condition-editor-fixture', enforce: 'pre',
      resolveId(id) { if (id.replaceAll('\\', '/') === entry.replaceAll('\\', '/')) return virtualId },
      load(id) { if (id === virtualId) return fixture },
    }, react()],
    resolve: { dedupe: ['react', 'react-dom', '@chakra-ui/react', '@emotion/react'] },
    build: { write: false, emptyOutDir: false, copyPublicDir: false, minify: false,
      lib: { entry, formats: ['iife'], name: 'OwnedConditionEditorFixture' } },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error',
  })
  const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(result => result.output)
  const chunks = output.filter(item => item.type === 'chunk')
  for (const chunk of chunks) {
    assert.deepEqual(chunk.moduleIds.filter(id => /\/(?:App|bridge|api)\.[cm]?[jt]sx?$|\/services\//i.test(id.replaceAll('\\', '/'))), [], 'No product entry point, bridge, or API is bundled')
  }
  const code = chunks.map(item => item.code).join('\n')
  const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n')
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chromium.executablePath()) ? {} : { channel: 'msedge' }) })
  try {
    const screenshotDir = process.env.SKYDIMO_KEEP_UI_TEST_ARTIFACTS === '1'
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'skydimo-automatic-editor-ui-')) : null
    if (screenshotDir) t.diagnostic(`Retained condition editor screenshots: ${screenshotDir}`)
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    const requests = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
    for (const colorScheme of ['light', 'dark']) {
      for (const width of [375, 1024]) {
        await t.test(`${colorScheme} ${width}px: media choices, keyboard edits, opaque siblings and layout`, async () => {
          await page.setViewportSize({ width, height: width === 375 ? 812 : 768 })
          await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
          await page.goto('about:blank')
          await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
          await page.evaluate(initial => {
            window.__SKYDIMO_EXT_PAGE__ = { locale: 'en-US' }
            window.fixtureInitial = initial
            window.fixtureCurrent = structuredClone(initial)
            window.fixtureChanges = 0
          }, group)
          await page.addStyleTag({ content: css })
          await page.addScriptTag({ content: code })
          await page.getByTestId('condition-editor-fixture').waitFor({ state: 'visible' })
          await page.keyboard.press('Tab')
          assert.equal(await page.getByRole('combobox', { name: 'Logic', exact: true }).first()
            .evaluate(element => document.activeElement === element), true, 'Tab reaches the actual labeled native control')
          const unsupported = page.getByText(/^Unsupported or malformed condition\./)
          assert.equal(await unsupported.count(), 3)
          for (const notice of await unsupported.all()) {
            assert.equal(await notice.locator('..').locator('input, select, textarea').count(), 0, 'Opaque conditions expose no editable replacement control')
          }
          assert.equal(await page.evaluate(() => window.fixtureChanges), 0, 'Rendering opaque conditions must not rewrite them')
          const kinds = page.getByRole('combobox', { name: 'Type', exact: true })
          assert.equal(await kinds.count(), 3, 'Opaque logic/items payloads are not treated as editable groups')
          const app = page.getByLabel('App name', { exact: true })
          assert.equal(await app.getAttribute('list'), 'automatic-running-apps')
          await kinds.first().selectOption('media_playing')
          assert.equal(await app.count(), 0)
          assert.deepEqual((await page.evaluate(() => window.fixtureCurrent)).items[0], { kind: 'media_playing' })
          await kinds.first().selectOption('media_source_app')
          const sources = page.getByRole('textbox', { name: 'Media AppUserModelId', exact: true })
          assert.equal(await sources.count(), 2)
          for (const input of await sources.all()) assert.equal(await input.getAttribute('list'), null, 'Media source identity never uses executable-name suggestions')
          assert.equal(await sources.first().getAttribute('aria-invalid'), 'true', 'Blank source ID is visibly invalid, not removed')
          await sources.first().focus()
          await page.keyboard.type('Synthetic.Player!App')
          await sources.nth(1).fill('Changed.Player!App')
          await page.getByRole('combobox', { name: 'Logic', exact: true }).first().selectOption('or')
          await page.getByRole('checkbox', { name: 'Negate', exact: true }).first().press('Space')
          const current = await page.evaluate(() => window.fixtureCurrent)
          assert.equal(current.logic, 'or')
          assert.equal(current.negated, true)
          assert.equal(current.items[0].source_app_id, 'Synthetic.Player!App')
          assert.deepEqual(current.items[1], { ...group.items[1], source_app_id: 'Changed.Player!App' })
          assert.deepEqual(current.items.slice(2), group.items.slice(2), 'Known edits preserve every opaque sibling and nested group')
          assert.deepEqual(current.groupExtra, group.groupExtra)
          assert.deepEqual(await page.evaluate(() => window.fixtureInitial), group, 'The received snapshot is never mutated')
          await page.getByRole('button', { name: 'Add condition', exact: true }).first().focus()
          await page.keyboard.press('Enter')
          const added = await page.evaluate(() => window.fixtureCurrent)
          assert.deepEqual(added.items.slice(0, -1), current.items)
          assert.deepEqual(added.items.at(-1), { kind: 'app_running', app_name: '' })
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'No horizontal overflow at the owned viewport')
          const errorContrast = await minimumTextContrast(page.locator('[data-scope="field"][data-part="error-text"]'))
          const mediaContrast = await minimumTextContrast(page.getByText(/^Exact AppUserModelId match|^Uses the current Windows media session/))
          t.diagnostic(`${colorScheme} ${width}px contrast: error ${errorContrast.toFixed(2)}:1; media hints ${mediaContrast.toFixed(2)}:1`)
          assert.ok(errorContrast >= 4.5, `Error text requires 4.5:1, received ${errorContrast.toFixed(2)}:1`)
          assert.ok(mediaContrast >= 4.5, `Media hints require 4.5:1, received ${mediaContrast.toFixed(2)}:1`)
          if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${colorScheme}-${width}.png`), fullPage: true })
        })
      }
    }
    assert.deepEqual(requests, [], 'The component fixture performs no network request')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
