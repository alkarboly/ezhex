export type AuthUser = {
  id: string
  email: string | null
}

export type AuthSession = {
  user: AuthUser | null
  configured: boolean
}

export type AuthCredentials = {
  email: string
  password: string
}

export type AuthDeleteRequest = {
  password: string
  confirm: string
}
