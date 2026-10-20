export async function apiRequest(url, options = {}, csrfToken = '') {
  const headers = new Headers(options.headers || {})
  const method = (options.method || 'GET').toUpperCase()
  let body = options.body
  if (body && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(body)
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken)
  }
  const response = await fetch(url, { ...options, body, method, headers })
  if (response.status === 204) return null
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la solicitud.')
  return result
}

export const money = (value, locale = 'es-NI') => `C$ ${Number(value || 0).toLocaleString(locale, { maximumFractionDigits: 2 })}`

export function imageUrl(value) {
  if (typeof value !== 'string') return ''
  if (value.startsWith('/')) return value
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}
