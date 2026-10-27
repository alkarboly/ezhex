import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { TooltipProvider } from '../components/ui/tooltip'
import { getDataProvider } from '../services'

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: 60_000,
          },
        },
      }),
  )

  useEffect(() => {
    void getDataProvider().describeSource().catch(() => {
      // Dataset queries surface this failure in the explorer.
    })
  }, [])

  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  )
}
