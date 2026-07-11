import { getAppSession } from '../../utils/app-session'

/** POST /api/auth/logout — clears the session cookie. */
export default defineEventHandler(async (event) => {
  const { auth } = useRuntimeConfig()
  if (auth.sessionSecret) {
    const session = await getAppSession(event)
    await session.clear()
  }
  return { success: true as const, data: { authed: false }, error: null }
})
