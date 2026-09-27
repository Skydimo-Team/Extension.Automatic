import { Alert, Stack, Text } from '@chakra-ui/react'
import { t } from '../i18n'
import { skippedReasonKey } from '../scheduler'
import type { SchedulerStatePayload } from '../types'

export function SchedulerFeedback({ state }: { state: SchedulerStatePayload }) {
  const held = state.lastSkipped?.filter((entry) => entry.reason !== 'unchanged')
  return (
    <Alert.Root status={held?.length || state.lastErrors.length ? 'warning' : 'info'} role="status"
      bg="bg.panel" color="fg" borderWidth="1px" borderColor="border.subtle">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{t('selectedPlanStatus')}</Alert.Title>
        <Alert.Description>
          <Stack gap="2">
            <Text>{t('runtimeOverlayHint')}</Text>
            {state.lastErrors.length > 0 ? <Text>{t('selectedPlanErrors')}</Text> : null}
            {held === undefined ? <Text>{t('ownershipUnknown')}</Text>
              : held.length === 0 ? <Text>{t('noActionsHeld')}</Text>
                : <>
                  <Text>{t('actionsHeld')}</Text>
                  {held.map((entry, index) => (
                    <Text key={index} overflowWrap="anywhere">
                      {entry.scope ? [entry.scope.port, entry.scope.output_id, entry.scope.segment_id].filter(Boolean).join(' / ') : t('unknownScope')}
                      {' — '}{t(skippedReasonKey(entry.reason))}
                    </Text>
                  ))}
                </>}
            <Text>{t('resumeManualHint')}</Text>
          </Stack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  )
}
