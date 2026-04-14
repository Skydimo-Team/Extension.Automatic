import type {
  ActivityEntry,
  AutomaticConfig,
  BridgeEvent,
  BridgeStatus,
  ErrorPayload,
  SaveResultPayload,
  SchedulerStatePayload,
  SnapshotPayload,
  SystemStatePayload,
} from './types'
import { setLocale } from './i18n'

interface ExtPageEnv {
  extId: string
  wsUrl: string
  locale?: string
}

declare global {
  interface Window {
    __SKYDIMO_EXT_PAGE__?: Partial<ExtPageEnv>
  }
}

type BridgeListener = (event: BridgeEvent) => void
type StatusListener = (status: BridgeStatus) => void

const PAGE: ExtPageEnv = {
  extId: window.__SKYDIMO_EXT_PAGE__?.extId ?? 'automatic',
  wsUrl: window.__SKYDIMO_EXT_PAGE__?.wsUrl ?? 'ws://127.0.0.1:38960',
  locale: window.__SKYDIMO_EXT_PAGE__?.locale,
}

function asRecord(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

function asArray<T>(value: unknown) {
  return Array.isArray(value) ? (value as T[]) : []
}

function normalizeSnapshot(value: unknown): SnapshotPayload {
  const payload = asRecord(value)
  return {
    config: (payload.config as AutomaticConfig | undefined) ?? {
      enabled: true,
      baseline: { actions: [] },
      rules: [],
    },
    devices: asArray(payload.devices),
    effects: asArray(payload.effects),
  }
}

function normalizeProcessApps(
  value: unknown,
): SystemStatePayload['process']['apps'] {
  return asArray<Record<string, unknown>>(value)
    .map((entry) => {
      const name = typeof entry.name === 'string' ? entry.name : undefined
      if (!name) {
        return null
      }

      return {
        name,
        instance_count:
          typeof entry.instance_count === 'number' && Number.isFinite(entry.instance_count)
            ? Math.max(0, Math.floor(entry.instance_count))
            : 0,
      }
    })
    .filter((entry): entry is SystemStatePayload['process']['apps'][number] => entry !== null)
}

function normalizeFocusTarget(
  value: unknown,
): SystemStatePayload['focus']['current'] {
  const payload = asRecord(value)
  const app_name = typeof payload.app_name === 'string' ? payload.app_name : undefined
  const window_title =
    typeof payload.window_title === 'string' ? payload.window_title : undefined

  if (!app_name && !window_title) {
    return undefined
  }

  return {
    app_name,
    window_title,
  }
}

function normalizeSystemState(value: unknown): SystemStatePayload {
  const payload = asRecord(value)
  const process = asRecord(payload.process)
  const focus = asRecord(payload.focus)

  return {
    process: {
      supported: process.supported === true,
      apps: normalizeProcessApps(process.apps),
    },
    focus: {
      supported: focus.supported === true,
      current: normalizeFocusTarget(focus.current),
    },
  }
}

function normalizeSchedulerState(value: unknown): SchedulerStatePayload {
  const payload = asRecord(value)
  return {
    enabled: payload.enabled !== false,
    matchedRuleIds: asArray<string>(payload.matchedRuleIds),
    activeRuleId:
      typeof payload.activeRuleId === 'string' ? payload.activeRuleId : undefined,
    activeSource:
      payload.activeSource === 'rule' || payload.activeSource === 'baseline'
        ? payload.activeSource
        : 'none',
    activeName:
      typeof payload.activeName === 'string' ? payload.activeName : undefined,
    activeActions: asArray(payload.activeActions),
    rules: asArray(payload.rules),
    lastRecomputeAt:
      typeof payload.lastRecomputeAt === 'string'
        ? payload.lastRecomputeAt
        : undefined,
    lastAppliedAt:
      typeof payload.lastAppliedAt === 'string' ? payload.lastAppliedAt : undefined,
    lastErrors: asArray(payload.lastErrors),
  }
}

function normalizeActivity(value: unknown) {
  return asArray<ActivityEntry>(value)
}

function normalizeSaveResult(value: unknown): SaveResultPayload {
  const payload = asRecord(value)
  return {
    action: typeof payload.action === 'string' ? payload.action : 'unknown',
    ok: payload.ok === true,
    config: (payload.config as AutomaticConfig | undefined) ?? {
      enabled: true,
      baseline: { actions: [] },
      rules: [],
    },
  }
}

function normalizeError(value: unknown): ErrorPayload {
  const payload = asRecord(value)
  return {
    action: typeof payload.action === 'string' ? payload.action : 'unknown',
    message: typeof payload.message === 'string' ? payload.message : 'Unknown error',
  }
}

class ExtensionBridge {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<BridgeListener>()
  private statusListeners = new Set<StatusListener>()
  private rpcId = 1
  private status: BridgeStatus = 'disconnected'

  subscribe(listener: BridgeListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeStatus(listener: StatusListener) {
    this.statusListeners.add(listener)
    listener(this.status)
    return () => this.statusListeners.delete(listener)
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    this.setStatus('connecting')
    this.ws = new WebSocket(PAGE.wsUrl)

    this.ws.onopen = () => {
      this.setStatus('connected')
      this.send('bootstrap')
    }

    this.ws.onmessage = (event) => {
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(event.data) as Record<string, unknown>
      } catch {
        return
      }

      if (payload.method !== 'event') {
        return
      }

      const params = asRecord(payload.params)
      if (params.event === 'locale-changed') {
        const locale = typeof asRecord(params.data).locale === 'string'
          ? (asRecord(params.data).locale as string)
          : null
        if (locale) {
          setLocale(locale)
        }
        return
      }

      if (params.event !== `ext-page-message:${PAGE.extId}`) {
        return
      }

      const data = asRecord(params.data)
      if (typeof data.type !== 'string') {
        return
      }

      let normalizedEvent: BridgeEvent | null = null
      if (data.type === 'snapshot') {
        normalizedEvent = { type: 'snapshot', data: normalizeSnapshot(data.data) }
      } else if (data.type === 'system_state') {
        normalizedEvent = {
          type: 'system_state',
          data: normalizeSystemState(data.data),
        }
      } else if (data.type === 'scheduler_state') {
        normalizedEvent = {
          type: 'scheduler_state',
          data: normalizeSchedulerState(data.data),
        }
      } else if (data.type === 'activity') {
        normalizedEvent = { type: 'activity', data: normalizeActivity(data.data) }
      } else if (data.type === 'save_result') {
        normalizedEvent = {
          type: 'save_result',
          data: normalizeSaveResult(data.data),
        }
      } else if (data.type === 'error') {
        normalizedEvent = { type: 'error', data: normalizeError(data.data) }
      }

      if (!normalizedEvent) {
        return
      }

      for (const listener of this.listeners) {
        listener(normalizedEvent)
      }
    }

    this.ws.onclose = () => {
      this.ws = null
      this.setStatus('disconnected')
      this.reconnectTimer = setTimeout(() => this.connect(), 3000)
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.setStatus('disconnected')
  }

  send(type: string, payload: Record<string, unknown> = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    this.ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: this.rpcId++,
      method: 'ext_page_send',
      params: {
        extId: PAGE.extId,
        data: {
          type,
          ...payload,
        },
      },
    }))
  }

  private setStatus(status: BridgeStatus) {
    this.status = status
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }
}

export const bridge = new ExtensionBridge()
