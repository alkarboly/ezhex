import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteAccount, fetchAuthSession, signInAccount, signOutAccount, signUpAccount } from '../services/auth'

export function useAuth() {
  const client = useQueryClient()
  const session = useQuery({
    queryKey: ['auth-session'],
    queryFn: fetchAuthSession,
  })

  const invalidate = () => client.invalidateQueries({ queryKey: ['auth-session'] })

  const signUp = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => signUpAccount(email, password),
    onSuccess: (data) => client.setQueryData(['auth-session'], { user: data.user, configured: data.configured }),
  })
  const signIn = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => signInAccount(email, password),
    onSuccess: (data) => client.setQueryData(['auth-session'], data),
  })
  const signOut = useMutation({
    mutationFn: signOutAccount,
    onSuccess: (data) => client.setQueryData(['auth-session'], data),
  })
  const remove = useMutation({
    mutationFn: (password: string) => deleteAccount(password),
    onSuccess: (data) => client.setQueryData(['auth-session'], data),
  })

  return { session, signUp, signIn, signOut, remove, invalidate }
}
