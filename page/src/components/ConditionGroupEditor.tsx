import {
  Box,
  Button,
  Checkbox,
  Field,
  HStack,
  Input,
  NativeSelect,
  Stack,
  Text,
} from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { t } from '../i18n'
import { conditionText, createCondition, isEditableCondition } from '../config'
import type { ConditionGroup, ConditionLeaf } from '../types'
import { cloneData, createEmptyConditionGroup, isConditionGroup } from '../types'

interface Props {
  group: ConditionGroup
  onChange: (next: ConditionGroup) => void
  runningApps: string[]
  depth?: number
}

function SelectField(props: {
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <NativeSelect.Root size="sm" width="full">
      <NativeSelect.Field
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.children}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  )
}

function ConditionEditor({ condition, onChange, runningApps }: {
  condition: ConditionLeaf
  onChange: (next: ConditionLeaf) => void
  runningApps: string[]
}) {
  const field = condition.kind === 'media_source_app' ? 'source_app_id'
    : condition.kind === 'window_title_contains' ? 'value' : 'app_name'
  const text = conditionText(condition[field])
  const isApp = condition.kind === 'app_running' || condition.kind === 'app_foreground'
  return (
    <>
      <Field.Root>
        <Field.Label>{t('kind')}</Field.Label>
        <SelectField value={condition.kind} onChange={(value) => {
          const next = { kind: value }
          if (isEditableCondition(next)) {
            onChange(createCondition(next.kind))
          }
        }}>
          <option value="app_running">{t('appRunning')}</option>
          <option value="app_foreground">{t('appForeground')}</option>
          <option value="window_title_contains">{t('windowTitleContains')}</option>
          <option value="media_playing">{t('mediaPlaying')}</option>
          <option value="media_source_app">{t('mediaSourceApp')}</option>
        </SelectField>
      </Field.Root>
      {condition.kind === 'media_playing' ? (
        <Text fontSize="sm" color="fg.muted">{t('mediaPlayingHint')}</Text>
      ) : (
        <Field.Root invalid={!text.trim()}>
          <Field.Label>{t(isApp ? 'appName' : field === 'value' ? 'windowText' : 'mediaSourceId')}</Field.Label>
          <Input
            list={isApp ? 'automatic-running-apps' : undefined}
            value={text}
            onChange={(event) => onChange({ ...condition, [field]: event.currentTarget.value })}
          />
          {condition.kind === 'media_source_app' ? (
            <Field.HelperText>{t('mediaSourceHint')}</Field.HelperText>
          ) : isApp && runningApps.length > 0 ? (
            <Field.HelperText>{runningApps.slice(0, 6).join(', ')}</Field.HelperText>
          ) : null}
          <Field.ErrorText color="fg">{t('invalidConditionHint')}</Field.ErrorText>
        </Field.Root>
      )}
    </>
  )
}

export function ConditionGroupEditor({
  group,
  onChange,
  runningApps,
  depth = 0,
}: Props) {
  function updateItem(index: number, nextItem: unknown) {
    const nextGroup = cloneData(group)
    nextGroup.items[index] = nextItem
    onChange(nextGroup)
  }

  function removeItem(index: number) {
    const nextGroup = cloneData(group)
    nextGroup.items.splice(index, 1)
    onChange(nextGroup)
  }

  return (
    <Box
      borderWidth="1px"
      borderColor="border.subtle"
      bg={depth === 0 ? 'bg.panel' : 'bg.subtle'}
      borderRadius="2xl"
      p="4"
      boxShadow="sm"
    >
      <Stack gap="4">
        <HStack justify="space-between" align="flex-start" gap="3" flexWrap="wrap">
          <HStack gap="3" flexWrap="wrap">
            <Field.Root>
              <Field.Label>{t('logic')}</Field.Label>
              <SelectField
                value={group.logic}
                onChange={(value) =>
                  onChange({ ...group, logic: value === 'or' ? 'or' : 'and' })
                }
              >
                <option value="and">{t('all')}</option>
                <option value="or">{t('any')}</option>
              </SelectField>
            </Field.Root>

            <Checkbox.Root
              alignSelf="end"
              checked={group.negated}
              onCheckedChange={(event) =>
                onChange({ ...group, negated: !!event.checked })
              }
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>{t('negate')}</Checkbox.Label>
            </Checkbox.Root>
          </HStack>

          <HStack gap="2" flexWrap="wrap">
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                onChange({
                  ...group,
                  items: [...group.items, createCondition('app_running')],
                })
              }
            >
              {t('addCondition')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                onChange({
                  ...group,
                  items: [...group.items, createEmptyConditionGroup()],
                })
              }
            >
              {t('addGroup')}
            </Button>
          </HStack>
        </HStack>

        {group.items.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            {t('addCondition')}
          </Text>
        ) : null}

        <Stack gap="3">
          {group.items.map((item, index) => (
            <Box
              key={`${depth}-${index}`}
              borderWidth="1px"
              borderColor="border.subtle"
              borderRadius="xl"
              p="3"
              bg="bg.subtle"
            >
              {isConditionGroup(item) ? (
                <Stack gap="3">
                  <HStack justify="space-between">
                    <Text fontSize="sm" fontWeight="600">
                      {t('conditions')}
                    </Text>
                    <Button
                      size="2xs"
                      variant="ghost"
                      colorPalette="red"
                      onClick={() => removeItem(index)}
                    >
                      {t('remove')}
                    </Button>
                  </HStack>
                  <ConditionGroupEditor
                    group={item}
                    onChange={(next) => updateItem(index, next)}
                    runningApps={runningApps}
                    depth={depth + 1}
                  />
                </Stack>
              ) : (
                <Stack gap="3">
                  <HStack justify="space-between">
                    <Text fontSize="sm" fontWeight="600">
                      {t('kind')}
                    </Text>
                    <Button
                      size="2xs"
                      variant="ghost"
                      colorPalette="red"
                      onClick={() => removeItem(index)}
                    >
                      {t('remove')}
                    </Button>
                  </HStack>

                  {isEditableCondition(item) ? (
                    <ConditionEditor
                      condition={item}
                      onChange={(next) => updateItem(index, next)}
                      runningApps={runningApps}
                    />
                  ) : (
                    <Text fontSize="sm" color="fg.muted">{t('unsupportedConditionHint')}</Text>
                  )}
                </Stack>
              )}
            </Box>
          ))}
        </Stack>
      </Stack>
    </Box>
  )
}
