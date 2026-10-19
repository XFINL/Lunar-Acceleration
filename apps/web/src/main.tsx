import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import App from './App'
import { GlassPreferencesProvider } from './components/common/GlassSurface'
import { SiteConfigProvider } from './components/common/SiteConfigProvider'
import { readThemePreference } from './lib/theme'
import './i18n'
import './index.css'

document.documentElement.classList.toggle('dark', readThemePreference())

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <GlassPreferencesProvider>
        <SiteConfigProvider>
          <App />
        </SiteConfigProvider>
        <Toaster position="top-right" closeButton toastOptions={{ className: 'glass-toast' }} />
      </GlassPreferencesProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
