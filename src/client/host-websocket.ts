/** Desktop sockets use the injected Host origin; web URLs retain their proxy directory. */
export function websocketRoute(route: string, sessionId: string, pageBase: string, streamBase?: string): string {
  const base = new URL(streamBase || pageBase)
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('宿主连接地址尚未就绪。')
  base.search = ''; base.hash = ''
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  const url = new URL(route.replace(/^\/+/, ''), base)
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('sessionId', sessionId)
  return url.href
}
export function hostWebSocketUrl(route: string, sessionId: string): string {
  const transport = (window as unknown as { __DSH_TRANSPORT__?: { streamBaseUrl?: string } }).__DSH_TRANSPORT__
  const page = typeof document !== 'undefined' ? document.baseURI : window.location.href || `${window.location.protocol}//${window.location.host}/`
  return websocketRoute(route, sessionId, page, transport?.streamBaseUrl)
}
