import {
  Box,
  Button,
  Checkbox,
  CloseButton,
  Drawer,
  Field,
  HStack,
  Input,
  Portal,
  Stack,
  Text,
} from '@chakra-ui/react'
import { useState } from 'react'
import { t } from '../i18n'
import type {
  RuleConfig,
  ScopeAction,
  ScopeOption,
  EffectInfo,
} from '../types'
import { cloneData } from '../types'
import { ActionEditor } from './ActionEditor'
import { ConditionGroupEditor } from './ConditionGroupEditor'

export type EditorState =
  | { kind: 'rule'; rule: RuleConfig; isNew: boolean }
  | { kind: 'baseline'; actions: ScopeAction[] }

interface Props {
  open: boolean
  editor: EditorState | null
  effects: EffectInfo[]
  scopeOptions: ScopeOption[]
  runningApps: string[]
  onClose: () => void
  onSaveRule: (rule: RuleConfig) => void
  onSaveBaseline: (actions: ScopeAction[]) => void
}

function DrawerEditorContent(props: Props & { editor: EditorState }) {
  const [ruleDraft, setRuleDraft] = useState<RuleConfig | null>(
    props.editor.kind === 'rule' ? cloneData(props.editor.rule) : null,
  )
  const [baselineDraft, setBaselineDraft] = useState<ScopeAction[]>(
    props.editor.kind === 'baseline' ? cloneData(props.editor.actions) : [],
  )

  const title = props.editor.kind === 'baseline'
    ? t('baselineDrawerTitle')
    : t('ruleDrawerTitle')

  return (
    <>
      <Drawer.Header>
        <Drawer.Title>{title}</Drawer.Title>
        <Drawer.CloseTrigger asChild>
          <CloseButton size="sm" />
        </Drawer.CloseTrigger>
      </Drawer.Header>

      <Drawer.Body>
        {props.editor.kind === 'baseline' ? (
          <Stack gap="5">
            <Box
              borderWidth="1px"
              borderColor="border.subtle"
              borderRadius="2xl"
              p="4"
              bg="bg.subtle"
            >
              <Text fontSize="sm" color="fg.muted">
                {t('baseline')}
              </Text>
            </Box>
            <ActionEditor
              actions={baselineDraft}
              effects={props.effects}
              scopeOptions={props.scopeOptions}
              onChange={setBaselineDraft}
            />
          </Stack>
        ) : ruleDraft ? (
          <Stack gap="5">
            <Checkbox.Root
              checked={ruleDraft.enabled}
              onCheckedChange={(event) =>
                setRuleDraft({
                  ...ruleDraft,
                  enabled: !!event.checked,
                })
              }
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>{t('enabled')}</Checkbox.Label>
            </Checkbox.Root>

            <Field.Root required>
              <Field.Label>{t('name')}</Field.Label>
              <Input
                value={ruleDraft.name}
                onChange={(event) =>
                  setRuleDraft({
                    ...ruleDraft,
                    name: event.currentTarget.value,
                  })
                }
              />
            </Field.Root>

            <Stack gap="3">
              <Text fontSize="sm" fontWeight="700">
                {t('conditions')}
              </Text>
              <ConditionGroupEditor
                group={ruleDraft.conditions}
                onChange={(conditions) =>
                  setRuleDraft({
                    ...ruleDraft,
                    conditions,
                  })
                }
                runningApps={props.runningApps}
              />
            </Stack>

            <Stack gap="3">
              <Text fontSize="sm" fontWeight="700">
                {t('actions')}
              </Text>
              <ActionEditor
                actions={ruleDraft.actions}
                effects={props.effects}
                scopeOptions={props.scopeOptions}
                onChange={(actions) =>
                  setRuleDraft({
                    ...ruleDraft,
                    actions,
                  })
                }
              />
            </Stack>
          </Stack>
        ) : null}
      </Drawer.Body>

      <Drawer.Footer>
        <HStack gap="3">
          <Button variant="outline" onClick={props.onClose}>
            {t('cancel')}
          </Button>
          <Button
            colorPalette="orange"
            onClick={() => {
              if (props.editor.kind === 'baseline') {
                props.onSaveBaseline(baselineDraft)
                return
              }

              if (ruleDraft) {
                props.onSaveRule(ruleDraft)
              }
            }}
          >
            {t('save')}
          </Button>
        </HStack>
      </Drawer.Footer>
    </>
  )
}

export function RuleEditorDrawer(props: Props) {
  return (
    <Drawer.Root
      open={props.open}
      size="xl"
      placement={{ mdDown: 'bottom', md: 'end' }}
      onOpenChange={(event) => {
        if (!event.open) {
          props.onClose()
        }
      }}
    >
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner padding="4">
          <Drawer.Content borderRadius="2xl" bg="bg.panel">
            {props.editor ? (
              <DrawerEditorContent
                key={
                  props.editor.kind === 'rule'
                    ? `rule:${props.editor.rule.id}`
                    : `baseline:${props.editor.actions.length}`
                }
                {...props}
                editor={props.editor}
              />
            ) : null}
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  )
}
