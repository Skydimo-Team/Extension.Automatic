import {
  ChakraProvider,
  createSystem,
  defaultConfig,
  defineConfig,
} from '@chakra-ui/react'
import type { PropsWithChildren } from 'react'

const config = defineConfig({
  theme: {
    tokens: {
      fonts: {
        heading: { value: "'IBM Plex Sans', 'Segoe UI', sans-serif" },
        body: { value: "'IBM Plex Sans', 'Segoe UI', sans-serif" },
      },
    },
    semanticTokens: {
      colors: {
        // Override gray palette so outline/ghost buttons follow CSS-variable dark mode
        gray: {
          fg: { value: 'var(--auto-fg-primary)' },
          subtle: { value: 'var(--auto-bg-hover)' },
          muted: { value: 'var(--auto-bg-active)' },
        },
        fg: {
          DEFAULT: { value: 'var(--auto-fg-primary)' },
          muted: { value: 'var(--auto-fg-secondary)' },
          subtle: { value: 'var(--auto-fg-muted)' },
        },
        bg: {
          DEFAULT: { value: 'var(--auto-bg-app)' },
          subtle: { value: 'var(--auto-bg-subtle)' },
          muted: { value: 'var(--auto-bg-muted)' },
          panel: { value: 'var(--auto-bg-panel)' },
        },
        border: {
          DEFAULT: { value: 'var(--auto-border-strong)' },
          muted: { value: 'var(--auto-border-muted)' },
          subtle: { value: 'var(--auto-border-muted)' },
        },
        focusRing: { value: 'var(--auto-focus-ring)' },
      },
    },
  },
})

const system = createSystem(defaultConfig, config)

export function AppProvider({ children }: PropsWithChildren) {
  return <ChakraProvider value={system}>{children}</ChakraProvider>
}
