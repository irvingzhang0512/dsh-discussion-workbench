import { describe, expect, it } from 'vitest'
import { websocketRoute } from '../src/client/host-websocket.ts'
describe('宿主桥地址', () => {
  it('Desktop 使用注入宿主并丢弃启动参数', () => {
    expect(websocketRoute('/bridge', 'a/b', 'dsh-app://app/', 'http://127.0.0.1:1234/?auth=private')).toBe('ws://127.0.0.1:1234/bridge?sessionId=a%2Fb')
  })
  it('web 保留代理目录和安全协议', () => {
    expect(websocketRoute('/bridge', 's1', 'https://host/proxy/3080/?auth=private')).toBe('wss://host/proxy/3080/bridge?sessionId=s1')
  })
  it('未注入地址时拒绝把 Desktop 的 app 当成远程主机', () => {
    expect(() => websocketRoute('/bridge', 's1', 'dsh-app://app/')).toThrow('尚未就绪')
  })
})
