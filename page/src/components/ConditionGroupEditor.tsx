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

function createEmptyCondition(): ConditionLeaf {
  return {
    kind: 'app_running',
    app_name: '',
  }
}

export function ConditionGroupEditor({
  group,
  onChange,
  runningApps,
  depth = 0,
}: Props) {
  function updateItem(index: number, nextItem: ConditionGroup | ConditionLeaf) {
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
                  items: [...group.items, createEmptyCondition()],
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

                  <Field.Root>
                    <Field.Label>{t('kind')}</Field.Label>
                    <SelectField
                      value={item.kind}
                      onChange={(value) => {
                        const nextKind =
                          value === 'app_foreground' || value === 'window_title_contains'
                            ? value
                            : 'app_running'
                        updateItem(index, {
                          kind: nextKind,
                          app_name: nextKind === 'window_title_contains' ? undefined : '',
                          value: nextKind === 'window_title_contains' ? '' : undefined,
                        })
                      }}
                    >
                      <option value="app_running">{t('appRunning')}</option>
                      <option value="app_foreground">{t('appForeground')}</option>
                      <option value="window_title_contains">
                        {t('windowTitleContains')}
                      </option>
                    </SelectField>
                  </Field.Root>

                  {item.kind === 'window_title_contains' ? (
                    <Field.Root>
                      <Field.Label>{t('windowText')}</Field.Label>
                      <Input
                        value={item.value ?? ''}
                        onChange={(event) =>
                          updateItem(index, {
                            ...item,
                            value: event.currentTarget.value,
                          })
                        }
                      />
                    </Field.Root>
                  ) : (
                    <Field.Root>
                      <Field.Label>{t('appName')}</Field.Label>
                      <Input
                        list="automatic-running-apps"
                        value={item.app_name ?? ''}
                        onChange={(event) =>
                          updateItem(index, {
                            ...item,
                            app_name: event.currentTarget.value,
                          })
                        }
                      />
                      {runningApps.length > 0 ? (
                        <Field.HelperText>
                          {runningApps.slice(0, 6).join(', ')}
                        </Field.HelperText>
                      ) : null}
                    </Field.Root>
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
