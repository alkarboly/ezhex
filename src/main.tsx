import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/index.css'
import { Providers } from './app/providers'
import { AppRouter } from './app/router'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root is missing.')

createRoot(root).render(
  <StrictMode>
    <Providers>
      <AppRouter />
    </Providers>
  </StrictMode>,
)
