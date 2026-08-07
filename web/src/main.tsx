import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyStoredTheme } from './lib/useTheme.ts'

// Before the first render, not inside a component effect — an effect runs after
// the browser has already had a chance to paint, which would show a returning
// light-mode visitor a frame of dark first. Only affects people who overrode
// the default; everyone else is already correct from CSS alone.
applyStoredTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
