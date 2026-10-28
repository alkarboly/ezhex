export const ACCESS_COOKIE = 'wp_access'
export const REFRESH_COOKIE = 'wp_refresh'

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    const key = part.slice(0, separator).trim()
    if (!key) continue
    try {
      cookies[key] = decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      cookies[key] = part.slice(separator + 1).trim()
    }
  }
  return cookies
}

export function sessionCookieHeader(name: string, value: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearCookieHeader(name: string, secure: boolean): string {
  return sessionCookieHeader(name, '', 0, secure)
}

export function sessionCookies(accessToken: string, refreshToken: string, secure: boolean): string[] {
  return [
    sessionCookieHeader(ACCESS_COOKIE, accessToken, 60 * 60, secure),
    sessionCookieHeader(REFRESH_COOKIE, refreshToken, 60 * 60 * 24 * 60, secure),
  ]
}

export function clearedSessionCookies(secure: boolean): string[] {
  return [clearCookieHeader(ACCESS_COOKIE, secure), clearCookieHeader(REFRESH_COOKIE, secure)]
}

export function cookieSecure(): boolean {
  return process.env.NODE_ENV === 'production'
}
