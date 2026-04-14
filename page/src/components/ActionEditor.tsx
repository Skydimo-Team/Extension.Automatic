import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Stack,
  Text,
} from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { t } from '../i18n'
import type {
  EffectInfo,
  EffectParamValue,
  ScopeAction,
  ScopeOption,
} from '../types'
import {
  checkDependency,
  cloneData,
  createEmptyAction,
  getEffectDefaults,
} from '../types'

interface Props {
  actions: ScopeAction[]
  effects: EffectInfo[]
  scopeOptions: ScopeOption[]
  onChange: (next: ScopeAction[]) => void
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

function ParameterFields(props: {
  effect?: EffectInfo
  values: Record<string, EffectParamValue>
  onChange: (next: Record<string, EffectParamValue>) => void
}) {
  const { effect, values, onChange } = props
  function updateParam(key: string, value: EffectParamValue) {
    onChange({
      ...values,
      [key]: value,
    })
  }

  if (!effect) {
    return null
  }

  return (
    <Stack gap="3">
      {effect.params.map((param) => {
        const dependency = checkDependency(effect, param.dependency, values)
        if (!dependency.visible) {
          return null
        }

        const currentValue = values[param.key] ?? param.default

        if (param.type === 'toggle') {
          return (
            <Field.Root key={param.key} disabled={dependency.disabled}>
              <Field.Label>{param.label}</Field.Label>
              <SelectField
                value={currentValue ? 'true' : 'false'}
                onChange={(value) => updateParam(param.key, value === 'true')}
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </SelectField>
            </Field.Root>
          )
        }

        if (param.type === 'select') {
          return (
            <Field.Root key={param.key} disabled={dependency.disabled}>
              <Field.Label>{param.label}</Field.Label>
              <SelectField
                value={String(currentValue)}
                onChange={(value) => updateParam(param.key, Number(value))}
              >
                {param.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </Field.Root>
          )
        }

        if (param.type === 'color') {
          return (
            <Field.Root key={param.key} disabled={dependency.disabled}>
              <Field.Label>{param.label}</Field.Label>
              <Input
                type="color"
                value={String(currentValue)}
                onChange={(event) =>
                  updateParam(param.key, event.currentTarget.value)
                }
              />
            </Field.Root>
          )
        }

        if (param.type === 'multi-color') {
          const colors = (
            Array.isArray(currentValue) ? currentValue : param.default
          ).map((value) => String(value))
          return (
            <Box
              key={param.key}
              borderWidth="1px"
              borderColor="border.subtle"
              borderRadius="xl"
              p="3"
            >
              <Stack gap="3">
                <Text fontSize="sm" fontWeight="600">
                  {param.label}
                </Text>
                {colors.map((color, index) => (
                  <HStack key={`${param.key}-${index}`} align="center">
                    <Input
                      type="color"
                      value={color}
                      onChange={(event) => {
                        const nextColors = [...colors]
                        nextColors[index] = event.currentTarget.value
                        updateParam(param.key, nextColors)
                      }}
                    />
                    <Button
                      size="xs"
                      variant="ghost"
                      colorPalette="red"
                      onClick={() => {
                        const nextColors = colors.filter((_, colorIndex) => colorIndex !== index)
                        updateParam(param.key, nextColors)
                      }}
                    >
                      {t('remove')}
                    </Button>
                  </HStack>
                ))}
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => updateParam(param.key, [...colors, '#ffffff'])}
                >
                  {t('addAction')}
                </Button>
              </Stack>
            </Box>
          )
        }

        if (param.type === 'range-slider') {
          const currentRange = Array.isArray(currentValue)
            ? currentValue
            : param.default
          const minValue = Number(currentRange[0])
          const maxValue = Number(currentRange[1])
          return (
            <Field.Root key={param.key} disabled={dependency.disabled}>
              <Field.Label>{param.label}</Field.Label>
              <HStack align="stretch">
                <Input
                  type="number"
                  value={minValue}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  onChange={(event) =>
                    updateParam(param.key, [
                      Number(event.currentTarget.value),
                      Number(maxValue),
                    ])
                  }
                />
                <Input
                  type="number"
                  value={maxValue}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  onChange={(event) =>
                    updateParam(param.key, [
                      Number(minValue),
                      Number(event.currentTarget.value),
                    ])
                  }
                />
              </HStack>
            </Field.Root>
          )
        }

        return (
          <Field.Root key={param.key} disabled={dependency.disabled}>
            <Field.Label>{param.label}</Field.Label>
            <Input
              type="number"
              value={Number(currentValue)}
              min={param.min}
              max={param.max}
              step={param.step}
              onChange={(event) =>
                updateParam(param.key, Number(event.currentTarget.value))
              }
            />
          </Field.Root>
        )
      })}
    </Stack>
  )
}

export function ActionEditor({ actions, effects, scopeOptions, onChange }: Props) {
  function updateAction(index: number, nextAction: ScopeAction) {
    const next = cloneData(actions)
    next[index] = nextAction
    onChange(next)
  }

  function removeAction(index: number) {
    const next = cloneData(actions)
    next.splice(index, 1)
    onChange(next)
  }

  return (
    <Stack gap="4">
      {actions.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          {t('addAction')}
        </Text>
      ) : null}

      {actions.map((action, index) => {
        const effect = effects.find((entry) => entry.id === action.effectId)
        const currentScopeKey = scopeOptions.find((option) =>
          option.scope.port === action.scope.port &&
          option.scope.output_id === action.scope.output_id &&
          option.scope.segment_id === action.scope.segment_id,
        )?.key ?? ''

        return (
          <Box
            key={`${action.scope.port}-${index}`}
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="2xl"
            p="4"
            bg="bg.panel"
          >
            <Stack gap="4">
              <HStack justify="space-between" align="center">
                <Text fontSize="sm" fontWeight="700">
                  {t('actions')} #{index + 1}
                </Text>
                <Button
                  size="2xs"
                  variant="ghost"
                  colorPalette="red"
                  onClick={() => removeAction(index)}
                >
                  {t('remove')}
                </Button>
              </HStack>

              <Field.Root required>
                <Field.Label>{t('scope')}</Field.Label>
                <SelectField
                  value={currentScopeKey}
                  onChange={(value) => {
                    const scope = scopeOptions.find((option) => option.key === value)?.scope
                    updateAction(index, {
                      ...action,
                      scope: scope ?? { port: '' },
                    })
                  }}
                >
                  <option value="">{t('selectScope')}</option>
                  {scopeOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </SelectField>
              </Field.Root>

              <Field.Root>
                <Field.Label>{t('effect')}</Field.Label>
                <SelectField
                  value={action.effectId ?? ''}
                  onChange={(value) => {
                    const nextEffect = effects.find((entry) => entry.id === value)
                    updateAction(index, {
                      ...action,
                      effectId: value || undefined,
                      params: nextEffect ? getEffectDefaults(nextEffect) : {},
                    })
                  }}
                >
                  <option value="">{t('keepCurrent')}</option>
                  {effects.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </SelectField>
              </Field.Root>

              <Field.Root>
                <Field.Label>{t('brightness')}</Field.Label>
                <Input
                  type="number"
                  value={action.brightness ?? ''}
                  min={0}
                  max={100}
                  onChange={(event) =>
                    updateAction(index, {
                      ...action,
                      brightness:
                        event.currentTarget.value === ''
                          ? undefined
                          : Number(event.currentTarget.value),
                    })
                  }
                />
              </Field.Root>

              <Field.Root>
                <Field.Label>{t('power')}</Field.Label>
                <SelectField
                  value={
                    action.powerOff === undefined
                      ? ''
                      : action.powerOff
                        ? 'off'
                        : 'on'
                  }
                  onChange={(value) =>
                    updateAction(index, {
                      ...action,
                      powerOff:
                        value === ''
                          ? undefined
                          : value === 'off',
                    })
                  }
                >
                  <option value="">{t('noChange')}</option>
                  <option value="on">{t('powerOn')}</option>
                  <option value="off">{t('powerOff')}</option>
                </SelectField>
              </Field.Root>

              <Field.Root>
                <Field.Label>{t('pause')}</Field.Label>
                <SelectField
                  value={
                    action.paused === undefined
                      ? ''
                      : action.paused
                        ? 'pause'
                        : 'resume'
                  }
                  onChange={(value) =>
                    updateAction(index, {
                      ...action,
                      paused:
                        value === ''
                          ? undefined
                          : value === 'pause',
                    })
                  }
                >
                  <option value="">{t('noChange')}</option>
                  <option value="resume">{t('resume')}</option>
                  <option value="pause">{t('pause')}</option>
                </SelectField>
              </Field.Root>

              <ParameterFields
                effect={effect}
                values={action.params ?? {}}
                onChange={(nextParams) =>
                  updateAction(index, {
                    ...action,
                    params: nextParams,
                  })
                }
              />
            </Stack>
          </Box>
        )
      })}

      <Button
        alignSelf="flex-start"
        size="sm"
        variant="outline"
        onClick={() =>
          onChange([
            ...actions,
            createEmptyAction(scopeOptions[0]?.scope),
          ])
        }
      >
        {t('addAction')}
      </Button>
    </Stack>
  )
}
