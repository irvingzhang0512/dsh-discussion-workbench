import type { IncomingHttpHeaders } from 'node:http'

function value(headers: IncomingHttpHeaders, name: string): string | undefined { const found = headers[name]; return typeof found === 'string' ? found : undefined }
function authority(raw: string): URL | undefined { try { return new URL(`http://${raw}`) } catch { return undefined } }
function loopback(host: string): boolean { return host === 'localhost' || host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) }

export function trustedRequest(request: { headers: IncomingHttpHeaders }, trustedHosts: readonly string[]): boolean {
  const host = value(request.headers, 'host')
  if (host === undefined) return false
  const parsed = authority(host)
  if (parsed === undefined) return false
  const trusted = loopback(parsed.hostname) || trustedHosts.some(item => {
    const candidate = authority(item)
    return candidate !== undefined && (candidate.port === '' || candidate.port === '80' || candidate.port === '443' ? candidate.hostname === parsed.hostname : candidate.host === parsed.host)
  })
  if (!trusted || value(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = value(request.headers, 'origin')
  if (origin === undefined) return true
  try { return new URL(origin).hostname === parsed.hostname } catch { return false }
}
