import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Grid,
  GridItem,
  Heading,
  HStack,
  Separator,
  SimpleGrid,
  Stack,
  Text,
  VStack,
  Card,
} from '@chakra-ui/react'
import { startTransition, useEffect, useEffectEvent, useState } from 'react'
import { bridge } from './bridge'
import { t, useLocale } from './i18n'
import { RuleEditorDrawer, type EditorState } from './components/RuleEditorDrawer'
import type {
  ActivityEntry,
  AutomaticConfig,
  BridgeEvent,
  BridgeStatus,
  RuleConfig,
  SchedulerStatePayload,
  SnapshotPayload,
  ScopeAction,
  ScopeOption,
  SystemStatePayload,
} from './types'
import {
  cloneData,
  createEmptyConditionGroup,
  createEmptyRule,
  EMPTY_SCHEDULER_STATE,
  EMPTY_SNAPSHOT,
  EMPTY_SYSTEM_STATE,
} from './types'

function flattenScopeOptions(devices: typeof EMPTY_SNAPSHOT.devices): ScopeOption[] {
  const options: ScopeOption[] = []

  for (const device of devices) {
    const outputs = Array.isArray(device.outputs) ? device.outputs : []
    options.push({
      key: `${device.port}::device`,
      label: device.name,
      scope: { port: device.port },
    })

    for (const output of outputs) {
      const segments = Array.isArray(output.segments) ? output.segments : []
      options.push({
        key: `${device.port}::${output.id}`,
        label: `${device.name} / ${output.name}`,
        scope: { port: device.port, output_id: output.id },
      })

      for (const segment of segments) {
        options.push({
          key: `${device.port}::${output.id}::${segment.id}`,
          label: `${device.name} / ${output.name} / ${segment.name}`,
          scope: {
            port: device.port,
            output_id: output.id,
            segment_id: segment.id,
          },
        })
      }
    }
  }

  return options
}

function normalizeActions(actions: unknown): ScopeAction[] {
  if (!Array.isArray(actions)) {
    return []
  }

  return actions
    .filter((action) => action && typeof action === 'object')
    .map((action) => {
      const value = action as Partial<ScopeAction>
      return {
        scope:
          value.scope && typeof value.scope === 'object' && typeof value.scope.port === 'string'
            ? value.scope
            : { port: '' },
        effectId: typeof value.effectId === 'string' ? value.effectId : undefined,
        params:
          value.params && typeof value.params === 'object' && !Array.isArray(value.params)
            ? value.params
            : {},
        brightness: typeof value.brightness === 'number' ? value.brightness : undefined,
        powerOff: typeof value.powerOff === 'boolean' ? value.powerOff : undefined,
        paused: typeof value.paused === 'boolean' ? value.paused : undefined,
      }
    })
}

function normalizeConditionGroup(input: unknown): RuleConfig['conditions'] {
  if (!input || typeof input !== 'object') {
    return createEmptyConditionGroup()
  }

  const value = input as {
    logic?: unknown
    negated?: unknown
    items?: unknown
    kind?: unknown
    app_name?: unknown
    value?: unknown
  }

  if (!Array.isArray(value.items)) {
    return createEmptyConditionGroup()
  }

  return {
    logic: value.logic === 'or' ? 'or' : 'and',
    negated: value.negated === true,
    items: value.items
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const child = item as {
          items?: unknown
          logic?: unknown
          negated?: unknown
          kind?: unknown
          app_name?: unknown
          value?: unknown
        }

        if (Array.isArray(child.items)) {
          return normalizeConditionGroup(child)
        }

        return {
          kind:
            child.kind === 'app_foreground' || child.kind === 'window_title_contains'
              ? child.kind
              : 'app_running',
          app_name: typeof child.app_name === 'string' ? child.app_name : undefined,
          value: typeof child.value === 'string' ? child.value : undefined,
        }
      }),
  }
}

function normalizeConfig(config?: Partial<AutomaticConfig>): AutomaticConfig {
  return {
    enabled: config?.enabled !== false,
    baseline: {
      actions: normalizeActions(config?.baseline?.actions),
    },
    rules: Array.isArray(config?.rules)
      ? config.rules
          .filter((rule) => rule && typeof rule === 'object')
          .map((rule, index) => {
            const value = rule as Partial<RuleConfig>
            return {
              id:
                typeof value.id === 'string' && value.id.length > 0
                  ? value.id
                  : `rule-${index}`,
              enabled: value.enabled !== false,
              name: typeof value.name === 'string' ? value.name : '',
              conditions: normalizeConditionGroup(value.conditions),
              actions: normalizeActions(value.actions),
            }
          })
      : [],
  }
}

function normalizeSnapshot(snapshot?: Partial<SnapshotPayload>): SnapshotPayload {
  return {
    config: normalizeConfig(snapshot?.config),
    devices: Array.isArray(snapshot?.devices)
      ? snapshot.devices
          .filter((device) => device && typeof device === 'object')
          .map((device) => {
            const value = device as SnapshotPayload['devices'][number]
            const outputs = Array.isArray(value.outputs) ? value.outputs : []
            return {
              ...value,
              outputs: outputs.map((output) => ({
                ...output,
                segments: Array.isArray(output.segments) ? output.segments : [],
              })),
            }
          })
      : [],
    effects: Array.isArray(snapshot?.effects)
      ? snapshot.effects
          .filter((effect) => effect && typeof effect === 'object')
          .map((effect) => ({
            ...effect,
            params: Array.isArray(effect.params) ? effect.params : [],
          }))
      : [],
  }
}

function normalizeProcessApps(
  apps: unknown,
): SystemStatePayload['process']['apps'] {
  if (!Array.isArray(apps)) {
    return []
  }

  return apps
    .filter((app) => app && typeof app === 'object')
    .map((app) => {
      const value = app as Partial<SystemStatePayload['process']['apps'][number]>
      return {
        name: typeof value.name === 'string' ? value.name : '',
        instance_count:
          typeof value.instance_count === 'number' && Number.isFinite(value.instance_count)
            ? Math.max(0, Math.floor(value.instance_count))
            : 0,
      }
    })
    .filter((app) => app.name.length > 0)
}

function normalizeFocusTarget(
  target: unknown,
): SystemStatePayload['focus']['current'] {
  if (!target || typeof target !== 'object') {
    return undefined
  }

  const value = target as Partial<NonNullable<SystemStatePayload['focus']['current']>>
  const app_name = typeof value.app_name === 'string' ? value.app_name : undefined
  const window_title =
    typeof value.window_title === 'string' ? value.window_title : undefined

  if (!app_name && !window_title) {
    return undefined
  }

  return {
    app_name,
    window_title,
  }
}

function normalizeSystemState(
  systemState?: Partial<SystemStatePayload>,
): SystemStatePayload {
  return {
    process: {
      supported: systemState?.process?.supported === true,
      apps: normalizeProcessApps(systemState?.process?.apps),
    },
    focus: {
      supported: systemState?.focus?.supported === true,
      current: normalizeFocusTarget(systemState?.focus?.current),
    },
  }
}

function normalizeSchedulerState(
  schedulerState?: Partial<SchedulerStatePayload>,
): SchedulerStatePayload {
  return {
    enabled: schedulerState?.enabled !== false,
    matchedRuleIds: Array.isArray(schedulerState?.matchedRuleIds)
      ? schedulerState.matchedRuleIds.filter((value): value is string => typeof value === 'string')
      : [],
    activeRuleId:
      typeof schedulerState?.activeRuleId === 'string'
        ? schedulerState.activeRuleId
        : undefined,
    activeSource:
      schedulerState?.activeSource === 'rule' || schedulerState?.activeSource === 'baseline'
        ? schedulerState.activeSource
        : 'none',
    activeName:
      typeof schedulerState?.activeName === 'string'
        ? schedulerState.activeName
        : undefined,
    activeActions: normalizeActions(schedulerState?.activeActions),
    rules: Array.isArray(schedulerState?.rules)
      ? schedulerState.rules
          .filter((rule) => rule && typeof rule === 'object')
          .map((rule, index) => ({
            id: typeof rule.id === 'string' ? rule.id : `scheduler-rule-${index}`,
            name: typeof rule.name === 'string' ? rule.name : '',
            enabled: rule.enabled !== false,
            matched: rule.matched === true,
            active: rule.active === true,
          }))
      : [],
    lastRecomputeAt:
      typeof schedulerState?.lastRecomputeAt === 'string'
        ? schedulerState.lastRecomputeAt
        : undefined,
    lastAppliedAt:
      typeof schedulerState?.lastAppliedAt === 'string'
        ? schedulerState.lastAppliedAt
        : undefined,
    lastErrors: Array.isArray(schedulerState?.lastErrors)
      ? schedulerState.lastErrors
          .filter((error) => error && typeof error === 'object')
          .map((error) => ({
            message: typeof error.message === 'string' ? error.message : 'unknown error',
            scope: error.scope,
          }))
      : [],
  }
}

function normalizeActivity(entries: unknown): ActivityEntry[] {
  if (!Array.isArray(entries)) {
    return []
  }

  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const value = entry as Partial<ActivityEntry>
      return {
        id:
          typeof value.id === 'string' && value.id.length > 0
            ? value.id
            : `activity-${index}`,
        timestamp: typeof value.timestamp === 'string' ? value.timestamp : '',
        kind: typeof value.kind === 'string' ? value.kind : 'info',
        title: typeof value.title === 'string' ? value.title : 'Event',
        detail: typeof value.detail === 'string' ? value.detail : undefined,
      }
    })
}

function formatTimestamp(value?: string) {
  if (!value) {
    return 'n/a'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

function statusText(status: BridgeStatus) {
  if (status === 'connected') {
    return t('statusConnected')
  }
  if (status === 'connecting') {
    return t('statusConnecting')
  }
  return t('statusDisconnected')
}

function activeSourceText(source: string) {
  if (source === 'rule') {
    return t('activeRule')
  }
  if (source === 'baseline') {
    return t('activeBaseline')
  }
  return t('idle')
}

function statusPalette(status: BridgeStatus) {
  if (status === 'connected') {
    return 'green'
  }
  if (status === 'connecting') {
    return 'orange'
  }
  return 'red'
}

function StatCard({ title, value, desc }: { title: string; value: string; desc: string }) {
  return (
    <Card.Root variant="outline" bg="bg.panel" size="sm">
      <Card.Body>
        <Text color="fg.muted" fontSize="sm" fontWeight="medium" mb={2}>
          {title}
        </Text>
        <Heading size="xl" letterSpacing="tight" mb={1}>
          {value}
        </Heading>
        <Text color="fg.subtle" fontSize="sm" lineClamp="1">
          {desc}
        </Text>
      </Card.Body>
    </Card.Root>
  )
}

function App() {
  useLocale()
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT)
  const [systemState, setSystemState] = useState(EMPTY_SYSTEM_STATE)
  const [schedulerState, setSchedulerState] = useState(EMPTY_SCHEDULER_STATE)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [status, setStatus] = useState<BridgeStatus>('disconnected')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [flash, setFlash] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const handleEvent = useEffectEvent((event: BridgeEvent) => {
    startTransition(() => {
      if (event.type === 'snapshot') {
        setSnapshot(normalizeSnapshot(event.data))
        return
      }
      if (event.type === 'system_state') {
        setSystemState(normalizeSystemState(event.data))
        return
      }
      if (event.type === 'scheduler_state') {
        setSchedulerState(normalizeSchedulerState(event.data))
        return
      }
      if (event.type === 'activity') {
        setActivity(normalizeActivity(event.data))
        return
      }
      if (event.type === 'save_result') {
        setFlash({ kind: 'success', text: t('saveOk') })
        setSnapshot((previous) => ({
          ...previous,
          config: normalizeConfig(event.data.config),
        }))
        return
      }
      if (event.type === 'error') {
        setFlash({ kind: 'error', text: `${event.data.action}: ${event.data.message}` })
      }
    })
  })

  const handleStatus = useEffectEvent((nextStatus: BridgeStatus) => {
    setStatus(nextStatus)
  })

  useEffect(() => {
    const unsubscribe = bridge.subscribe(handleEvent)
    const unsubscribeStatus = bridge.subscribeStatus(handleStatus)
    bridge.connect()

    return () => {
      unsubscribe()
      unsubscribeStatus()
      bridge.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!flash) {
      return
    }
    const timer = window.setTimeout(() => setFlash(null), 3200)
    return () => window.clearTimeout(timer)
  }, [flash])

  const scopeOptions = flattenScopeOptions(snapshot.devices)
  const runningApps = systemState.process.apps.map((app) => app.name)
  const currentFocus = systemState.focus.current
  function updateConfig(nextConfig: typeof snapshot.config) {
    bridge.send('save_config', { config: nextConfig })
  }

  function saveRule(rule: RuleConfig) {
    const nextConfig = cloneData(snapshot.config)
    const index = nextConfig.rules.findIndex((entry) => entry.id === rule.id)
    if (index >= 0) {
      nextConfig.rules[index] = rule
    } else {
      nextConfig.rules.push(rule)
    }
    updateConfig(nextConfig)
    setEditor(null)
  }

  function saveBaseline(actions: ScopeAction[]) {
    const nextConfig = cloneData(snapshot.config)
    nextConfig.baseline.actions = actions
    updateConfig(nextConfig)
    setEditor(null)
  }

  function toggleRule(ruleId: string, enabled: boolean) {
    const nextConfig = cloneData(snapshot.config)
    nextConfig.rules = nextConfig.rules.map((rule) =>
      rule.id === ruleId ? { ...rule, enabled } : rule,
    )
    updateConfig(nextConfig)
  }

  function moveRule(ruleId: string, delta: number) {
    const ids = snapshot.config.rules.map((rule) => rule.id)
    const index = ids.indexOf(ruleId)
    const target = index + delta
    if (index < 0 || target < 0 || target >= ids.length) {
      return
    }
    const nextIds = [...ids]
    const [moved] = nextIds.splice(index, 1)
    nextIds.splice(target, 0, moved)
    bridge.send('reorder_rules', { ruleIds: nextIds })
  }

  function deleteRule(ruleId: string) {
    if (!window.confirm(`${t('delete')}?`)) {
      return
    }
    bridge.send('delete_rule', { ruleId })
  }

  return (
    <Box minH="100vh" bg="bg.muted" px={{ base: 4, md: 8 }} py={{ base: 6, md: 8 }}>
      <datalist id="automatic-running-apps">
        {runningApps.map((appName) => (
          <option key={appName} value={appName} />
        ))}
      </datalist>

      <Stack gap={8} maxW="7xl" mx="auto">
        {/* Header */}
        <Flex justify="space-between" align="flex-start" wrap="wrap" gap={4}>
          <VStack align="start" gap={1}>
            <Heading size="2xl" fontWeight="bold" letterSpacing="tight">
              {t('title')}
            </Heading>
            <Text color="fg.muted" fontSize="lg">
              {t('subtitle')}
            </Text>
          </VStack>
          <HStack gap={4}>
            <Badge colorPalette={statusPalette(status)} variant="subtle" size="lg" px={3} py={1} rounded="full">
              {statusText(status)}
            </Badge>
            <Box bg="bg.panel" px={4} py={2} rounded="full" borderWidth={1} borderColor="border.subtle">
              <Checkbox.Root
                checked={snapshot.config.enabled}
                onCheckedChange={(e) => bridge.send('set_enabled', { enabled: !!e.checked })}
                colorPalette="blue"
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label fontWeight="medium">
                  {snapshot.config.enabled ? t('automationEnabled') : t('automationDisabled')}
                </Checkbox.Label>
              </Checkbox.Root>
            </Box>
          </HStack>
        </Flex>

        {/* Flash Message */}
        {flash && (
          <Box p={4} rounded="lg" bg={flash.kind === 'error' ? 'red.subtle' : 'green.subtle'} color={flash.kind === 'error' ? 'red.fg' : 'green.fg'}>
            <Text fontWeight="medium">{flash.text}</Text>
          </Box>
        )}

        {/* Stats Row */}
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={6}>
          <StatCard
            title={t('activeSource')}
            value={activeSourceText(schedulerState.activeSource)}
            desc={schedulerState.activeName ?? t('idle')}
          />
          <StatCard
            title={t('selectedActions')}
            value={schedulerState.activeActions.length.toString()}
            desc={t('scopeCount')}
          />
          <StatCard
            title={t('scheduler')}
            value={schedulerState.matchedRuleIds.length.toString()}
            desc={formatTimestamp(schedulerState.lastRecomputeAt)}
          />
        </SimpleGrid>

        {/* Main Content Grid */}
        <Grid templateColumns={{ base: '1fr', lg: '2fr 1fr' }} gap={8} alignItems="start">
          {/* Left Column: Rules */}
          <GridItem>
            <Stack gap={6}>
              <Flex justify="space-between" align="center">
                <Heading size="lg">{t('rulesTab')}</Heading>
                <HStack gap={3}>
                  <Button size="sm" variant="outline" onClick={() => bridge.send('recompute')}>
                    {t('recompute')}
                  </Button>
                  <Button
                    size="sm"
                    colorPalette="blue"
                    onClick={() => setEditor({ kind: 'rule', rule: createEmptyRule(), isNew: true })}
                  >
                    {t('addRule')}
                  </Button>
                </HStack>
              </Flex>

              {/* Rules List */}
              <Stack gap={4}>
                {snapshot.config.rules.length === 0 ? (
                  <Box p={8} textAlign="center" borderWidth={1} rounded="xl" borderStyle="dashed" borderColor="border.subtle">
                    <Text color="fg.muted">{t('noRules')}</Text>
                  </Box>
                ) : (
                  snapshot.config.rules.map((rule, index) => {
                    const runtimeRule = schedulerState.rules.find((r) => r.id === rule.id)
                    return (
                      <Card.Root key={rule.id} variant="outline" bg="bg.panel" opacity={rule.enabled ? 1 : 0.6}>
                        <Card.Body>
                          <Flex justify="space-between" align="flex-start" gap={4}>
                            <VStack align="start" gap={2} flex={1}>
                              <HStack gap={3} wrap="wrap">
                                <Heading size="md">{rule.name || `Rule ${index + 1}`}</Heading>
                                {runtimeRule?.matched && (
                                  <Badge colorPalette="green" variant="subtle">
                                    {t('matched')}
                                  </Badge>
                                )}
                                {runtimeRule?.active && (
                                  <Badge colorPalette="blue" variant="solid">
                                    {t('active')}
                                  </Badge>
                                )}
                                {!rule.enabled && (
                                  <Badge colorPalette="gray" variant="subtle">
                                    {t('disabled')}
                                  </Badge>
                                )}
                              </HStack>
                            </VStack>
                            <Checkbox.Root
                              checked={rule.enabled}
                              onCheckedChange={(e) => toggleRule(rule.id, !!e.checked)}
                              colorPalette="blue"
                            >
                              <Checkbox.HiddenInput />
                              <Checkbox.Control />
                            </Checkbox.Root>
                          </Flex>
                        </Card.Body>
                        <Separator />
                        <Card.Footer py={2} px={4}>
                          <HStack gap={2} ml="auto">
                            <Button size="xs" variant="ghost" onClick={() => setEditor({ kind: 'rule', rule, isNew: false })}>
                              {t('edit')}
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => moveRule(rule.id, -1)} disabled={index === 0}>
                              {t('moveUp')}
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => moveRule(rule.id, 1)}
                              disabled={index === snapshot.config.rules.length - 1}
                            >
                              {t('moveDown')}
                            </Button>
                            <Button size="xs" variant="ghost" colorPalette="red" onClick={() => deleteRule(rule.id)}>
                              {t('delete')}
                            </Button>
                          </HStack>
                        </Card.Footer>
                      </Card.Root>
                    )
                  })
                )}
              </Stack>

              {/* Baseline */}
              <Card.Root variant="outline" bg="bg.panel">
                <Card.Body>
                  <Flex justify="space-between" align="center">
                    <VStack align="start" gap={1}>
                      <HStack gap={3}>
                        <Heading size="md">{t('baseline')}</Heading>
                        {schedulerState.activeSource === 'baseline' && (
                          <Badge colorPalette="blue" variant="solid">
                            {t('active')}
                          </Badge>
                        )}
                      </HStack>
                      <Text color="fg.muted" fontSize="sm">
                        {snapshot.config.baseline.actions.length} {t('actions')}
                      </Text>
                    </VStack>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditor({ kind: 'baseline', actions: snapshot.config.baseline.actions })}
                    >
                      {t('edit')}
                    </Button>
                  </Flex>
                </Card.Body>
              </Card.Root>
            </Stack>
          </GridItem>

          {/* Right Column: Live State */}
          <GridItem>
            <Stack gap={6} position="sticky" top={8}>
              <Heading size="lg">{t('liveStateTab')}</Heading>

              {/* Current Focus */}
              <Card.Root variant="outline" bg="bg.panel">
                <Card.Header pb={2}>
                  <Heading size="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
                    {t('currentFocus')}
                  </Heading>
                </Card.Header>
                <Card.Body pt={0}>
                  <Heading size="md" mb={1}>
                    {currentFocus?.app_name ?? t('noForeground')}
                  </Heading>
                  <Text color="fg.muted" fontSize="sm" lineClamp="2">
                    {currentFocus?.window_title ?? t('windowTitle')}
                  </Text>
                </Card.Body>
              </Card.Root>

              {/* Activity */}
              <Card.Root variant="outline" bg="bg.panel">
                <Card.Header pb={2}>
                  <Heading size="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
                    {t('activity')}
                  </Heading>
                </Card.Header>
                <Card.Body pt={0}>
                  {activity.length === 0 ? (
                    <Text color="fg.muted" fontSize="sm">
                      {t('noActivity')}
                    </Text>
                  ) : (
                    <Stack gap={4}>
                      {activity.slice(0, 8).map((entry) => (
                        <Box
                          key={entry.id}
                          position="relative"
                          pl={4}
                          _before={{
                            content: '""',
                            position: 'absolute',
                            left: 0,
                            top: 2,
                            bottom: -6,
                            width: '2px',
                            bg: 'border.subtle',
                            borderRadius: 'full',
                          }}
                          _last={{ _before: { display: 'none' } }}
                        >
                          <Box
                            position="absolute"
                            left="-3px"
                            top="2"
                            boxSize="8px"
                            rounded="full"
                            bg={entry.kind === 'error' ? 'red.500' : 'blue.500'}
                            ring="4px"
                            ringColor="bg.panel"
                          />
                          <VStack align="start" gap={0.5}>
                            <HStack justify="space-between" w="full">
                              <Text fontSize="sm" fontWeight="medium">
                                {entry.title}
                              </Text>
                              <Text fontSize="xs" color="fg.muted">
                                {formatTimestamp(entry.timestamp).split(' ')[1] || formatTimestamp(entry.timestamp)}
                              </Text>
                            </HStack>
                            {entry.detail && (
                              <Text fontSize="xs" color="fg.muted" lineClamp="2">
                                {entry.detail}
                              </Text>
                            )}
                          </VStack>
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Card.Body>
              </Card.Root>

              {/* Running Apps */}
              <Card.Root variant="outline" bg="bg.panel">
                <Card.Header pb={2}>
                  <Heading size="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
                    {t('runningApps')} ({runningApps.length})
                  </Heading>
                </Card.Header>
                <Card.Body pt={0}>
                  {runningApps.length === 0 ? (
                    <Text color="fg.muted" fontSize="sm">
                      {t('noRunningApps')}
                    </Text>
                  ) : (
                    <Box
                      maxH="240px"
                      overflowY="auto"
                      pr={2}
                      css={{
                        '&::-webkit-scrollbar': { width: '4px' },
                        '&::-webkit-scrollbar-thumb': {
                          background: 'var(--chakra-colors-border-muted)',
                          borderRadius: '4px',
                        },
                      }}
                    >
                      <Stack gap={1}>
                        {runningApps.map((appName) => (
                          <Text
                            key={appName}
                            fontSize="sm"
                            py={1}
                            borderBottomWidth={1}
                            borderColor="border.subtle"
                            _last={{ borderBottomWidth: 0 }}
                          >
                            {appName}
                          </Text>
                        ))}
                      </Stack>
                    </Box>
                  )}
                </Card.Body>
              </Card.Root>
            </Stack>
          </GridItem>
        </Grid>
      </Stack>

      <RuleEditorDrawer
        open={editor !== null}
        editor={editor}
        effects={snapshot.effects}
        scopeOptions={scopeOptions}
        runningApps={runningApps}
        onClose={() => setEditor(null)}
        onSaveRule={saveRule}
        onSaveBaseline={saveBaseline}
      />
    </Box>
  )
}

export default App
