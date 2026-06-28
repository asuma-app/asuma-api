import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const settingsPath = path.join(__dirname, '..', '..', 'src', 'settings.json')

const ONE_MINUTE = 60_000
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR

let settingsCache = null
let lastModified = 0
let flattenedItems = []

export function loadSettings() {
  try {
    const stats = fs.statSync(settingsPath)
    if (!settingsCache || stats.mtimeMs > lastModified) {
      const data = fs.readFileSync(settingsPath, 'utf8')
      settingsCache = JSON.parse(data)
      lastModified = stats.mtimeMs
      flattenedItems = buildEndpointIndex(settingsCache)
    }
    return settingsCache
  } catch (error) {
    console.error('[Settings] Error loading:', error)
    return null
  }
}

function buildEndpointIndex(settings) {
  if (!settings || !settings.categories) return []
  
  const items = []
  for (const category of settings.categories) {
    if (category.items && Array.isArray(category.items)) {
      for (const item of category.items) {
        if (item.path) {
          const match = item.path.match(/^\/([^?]+)/)
          if (match) {
            items.push({
              ...item,
              endpoint: match[1].toLowerCase().replace(/^\/|\/$/g, '')
            })
          }
        }
      }
    }
  }
  
  items.sort((a, b) => b.endpoint.length - a.endpoint.length)
  return items
}

export function findFeatureByEndpoint(endpointPath) {
  const cleanPath = endpointPath.toLowerCase().replace(/^\/|\/$/g, '')
  
  for (const item of flattenedItems) {
    if (item.endpoint === cleanPath || cleanPath.startsWith(item.endpoint + '/')) {
      return item
    }
  }
  
  return null
}

export function getSettingsCache() {
  return settingsCache
}

export function getFlattenedItems() {
  return flattenedItems
}
