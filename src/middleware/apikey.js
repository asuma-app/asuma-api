import { loadSettings, findFeatureByEndpoint } from './settings.js'
import { checkRateLimit } from './rateLimiter.js'

const sendJson = (res, statusCode, data) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

export function createApiKeyMiddleware() {
  return (req, res, next) => {
    try {
      const settings = loadSettings()
      
      if (!settings || !settings.apiSettings) {
        return next()
      }
      
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
      const currentPath = url.pathname
      const apikey = url.searchParams.get('apikey')
      
      const feature = findFeatureByEndpoint(currentPath)
      
      let requiresApiKey = false
      
      if (settings.apiSettings.requireApikey === true) {
        requiresApiKey = true
      } else if (feature) {
        requiresApiKey = feature.isApikey === true
      }
      
      if (!requiresApiKey) {
        return next()
      }
      
      if (!apikey) {
        return sendJson(res, 401, {
          status: false,
          creator: settings.apiSettings.creator || "Ditss",
          error: "API key required",
          message: "Please provide a valid API key in the query parameters (apikey=...)",
          endpoint: currentPath
        })
      }
      
      if (!settings.apiSettings.apikey || !settings.apiSettings.apikey[apikey]) {
        return sendJson(res, 403, {
          status: false,
          creator: settings.apiSettings.creator || "Ditss",
          error: "Invalid API key",
          message: "The provided API key is not valid or does not exist"
        })
      }
      
      const apikeyConfig = settings.apiSettings.apikey[apikey]
      
      if (!apikeyConfig.enabled) {
        return sendJson(res, 403, {
          status: false,
          creator: settings.apiSettings.creator || "Ditss",
          error: "API key disabled",
          message: "This API key has been disabled"
        })
      }
      
      if (!checkRateLimit(apikey, apikeyConfig)) {
        return sendJson(res, 429, {
          status: false,
          creator: settings.apiSettings.creator || "Ditss",
          error: "Rate limit exceeded",
          message: `You have exceeded the rate limit for this API key (${apikeyConfig.rateLimit})`
        })
      }
      
      next()
      
    } catch (error) {
      console.error('[ApiKey Middleware] Error:', error)
      next()
    }
  }
}

export function testEndpoint(endpointPath) {
  const settings = loadSettings()
  const feature = findFeatureByEndpoint(endpointPath)
  
  return {
    endpoint: endpointPath,
    feature: feature ? {
      name: feature.name,
      isApikey: feature.isApikey
    } : null,
    globalRequireApikey: settings?.apiSettings?.requireApikey || false,
    requiresApiKey: settings?.apiSettings?.requireApikey === true || feature?.isApikey === true
  }
}
