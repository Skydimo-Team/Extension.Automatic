import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from './theme'
import './theme.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)
