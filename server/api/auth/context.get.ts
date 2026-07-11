import { isSessionAuthed } from '../../utils/app-session'
import { getClientIp } from '../../utils/client-ip'
import { isIpAllowed } from '../../utils/ip-match'

/**
 * GET /api/auth/context — what the login page needs to render:
 * the visitor's IP (shown in the "unrecognized IP" notice), whether that IP
 * is allowlisted, and whether a session already exists.
 */
export default defineEventHandler(async (event) => {
  const { auth } = useRuntimeConfig()
  const ip = getClientIp(event) ?? 'unknown'
  const configured = Boolean(auth.appPin && auth.sessionSecret)

  return {
    success: true as const,
    data: {
      ip,
      configured,
      ipAllowed: configured && isIpAllowed(ip, auth.allowedIps),
      authed: configured && await isSessionAuthed(event)
    },
    error: null
  }
})
