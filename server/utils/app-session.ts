import type { H3Event } from 'h3'

const SESSION_NAME = 'watt-session'
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 90 // 90 days — personal device, low friction

export interface AppSessionData {
  authed?: boolean
  at?: number
}

/**
 * h3 sealed session over the signed cookie. The seal password must be
 * ≥ 32 chars — we derive it from NUXT_AUTH_SESSION_SECRET via SHA-256 so any
 * user-provided secret length works.
 */
async function sealPassword(): Promise<string> {
  const { auth } = useRuntimeConfig()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(auth.sessionSecret))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function getAppSession(event: H3Event) {
  return useSession<AppSessionData>(event, {
    name: SESSION_NAME,
    password: await sealPassword(),
    maxAge: SESSION_MAX_AGE_S,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: !import.meta.dev
    }
  })
}

export async function isSessionAuthed(event: H3Event): Promise<boolean> {
  const { auth } = useRuntimeConfig()
  if (!auth.sessionSecret) {
    return false
  }
  const session = await getAppSession(event)
  return session.data.authed === true
}
