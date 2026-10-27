import { useQuery } from '@tanstack/react-query'
import { getDataProvider } from '../services'

export function useDataSource() {
  return useQuery({
    queryKey: ['source-description'],
    queryFn: () => getDataProvider().describeSource(),
  })
}
