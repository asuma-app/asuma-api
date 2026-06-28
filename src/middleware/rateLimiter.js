const ONE_MINUTE = 60_000
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR

const rateLimitMap = new Map()

setInterval(() => {
  if (rateLimitMap.size === 0) return
  const now = Date.now()
  for (const [key, limitData] of rateLimitMap.entries()) {
    if (now > limitData.resetTime + ONE_MINUTE) {
      rateLimitMap.delete(key)
    }
  }
}, ONE_MINUTE)

export function parseRateLimit(rateLimitString) {
  if (rateLimitString === 'unlimited') {
    return { maxRequests: Infinity, windowMs: 0 }
  }

  const match = rateLimitString.match(/^(\d+)\/(minute|hour|day)$/)
  if (!match) {
    return { maxRequests: 50, windowMs: ONE_MINUTE }
  }

  const [, maxRequests, unit] = match
  let windowMs

  switch (unit) {
    case 'minute': windowMs = ONE_MINUTE; break
    case 'hour': windowMs = ONE_HOUR; break
    case 'day': windowMs = ONE_DAY; break
    default: windowMs = ONE_MINUTE
  }

  return { maxRequests: parseInt(maxRequests, 10), windowMs }
}

export function checkRateLimit(apikey, apikeyConfig) {
  if (!apikeyConfig || !apikeyConfig.enabled) return false
  if (apikeyConfig.rateLimit === 'unlimited') return true

  const { maxRequests, windowMs } = parseRateLimit(apikeyConfig.rateLimit)
  const now = Date.now()
  const key = `${apikey}_${Math.floor(now / windowMs)}`

  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, { count: 0, resetTime: now + windowMs })
  }

  const limitData = rateLimitMap.get(key)
  
  if (now > limitData.resetTime) {
    limitData.count = 0
    limitData.resetTime = now + windowMs
  }

  if (limitData.count >= maxRequests) {
    return false
  }

  limitData.count++
  return true
}

export function getRateLimitMap() {
  return rateLimitMap
}
