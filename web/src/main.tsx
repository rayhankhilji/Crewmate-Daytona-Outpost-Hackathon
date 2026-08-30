import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'

const container = document.getElementById('root')
if (container === null) {
  throw new Error('Crewmate: #root is missing from index.html; the app cannot mount.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
