import { describe, expect, it } from 'vitest'
import { DockVisibility, isWorkbenchUsed, resolveDockMode } from '../src/host/dock.ts'
import type { MeetingWorkspace, WorkbenchState } from '../src/shared/types.ts'

const MATERIAL: WorkbenchState['materials'][number] = { id: 'm1', label: '转写.txt', kind: 'file', path: 'C:/w/转写.txt', addedAt: 1 }
const MEETING: MeetingWorkspace = {
  folder: 'C:/w/会议', recordFile: null, minutesFile: null, activeDocument: 'record', phase: 'materials',
  info: { date: '', time: '', location: '', attendees: '', topic: '', recorder: '' },
  sourceLinks: [], pendingSync: [], referencePanelOpen: false, pdf: null,
}

/** 按痕迹构造判定输入；未给出的痕迹一律为空。 */
function used(patch: { targetFile?: string | null, materials?: WorkbenchState['materials'], meeting?: WorkbenchState['meeting'] } = {}): boolean {
  return isWorkbenchUsed({
    targetFile: patch.targetFile ?? null,
    materials: patch.materials ?? [],
    meeting: patch.meeting ?? null,
  })
}

describe('resolveDockMode', () => {
  it.each(['always', 'auto', 'off'] as const)('接受契约取值 %s', value => {
    expect(resolveDockMode(value)).toEqual({ mode: value, invalid: false })
  })

  it('未提供、null 或空字符串按默认 auto 处理且不算非法', () => {
    expect(resolveDockMode(undefined)).toEqual({ mode: 'auto', invalid: false })
    expect(resolveDockMode(null)).toEqual({ mode: 'auto', invalid: false })
    expect(resolveDockMode('')).toEqual({ mode: 'auto', invalid: false })
  })

  it('无法识别的取值按 auto 处理并标记非法', () => {
    expect(resolveDockMode('sometimes')).toEqual({ mode: 'auto', invalid: true })
    expect(resolveDockMode(1)).toEqual({ mode: 'auto', invalid: true })
    expect(resolveDockMode({ dock: 'auto' })).toEqual({ mode: 'auto', invalid: true })
  })
})

describe('isWorkbenchUsed', () => {
  it('有固定整理目标即已使用', () => {
    expect(used({ targetFile: 'C:/w/纪要.md' })).toBe(true)
  })

  it('有参考材料即已使用', () => {
    expect(used({ materials: [MATERIAL] })).toBe(true)
  })

  it('已打开会议即已使用', () => {
    expect(used({ meeting: MEETING })).toBe(true)
  })

  it('目标、材料、会议全为空时未使用', () => {
    expect(used()).toBe(false)
  })
})

describe('DockVisibility', () => {
  it('auto 下未使用不显示，出现痕迹后才显示', () => {
    const visibility = new DockVisibility()
    expect(visibility.visible('auto', 's1', false)).toBe(false)
    expect(visibility.visible('auto', 's1', true)).toBe(true)
  })

  it('auto 下显示过就保持，痕迹清空也不收起，直到 release 后重新判定', () => {
    const visibility = new DockVisibility()
    expect(visibility.visible('auto', 's1', true)).toBe(true)
    expect(visibility.visible('auto', 's1', false)).toBe(true)
    visibility.release('s1')
    expect(visibility.visible('auto', 's1', false)).toBe(false)
  })

  it('auto 下会话之间互不影响', () => {
    const visibility = new DockVisibility()
    expect(visibility.visible('auto', 's1', true)).toBe(true)
    expect(visibility.visible('auto', 's2', false)).toBe(false)
  })

  it('always 一律显示，off 一律不显示', () => {
    const visibility = new DockVisibility()
    expect(visibility.visible('always', 's1', false)).toBe(true)
    expect(visibility.visible('off', 's1', true)).toBe(false)
    visibility.release('s1')
    expect(visibility.visible('always', 's1', false)).toBe(true)
    expect(visibility.visible('off', 's1', false)).toBe(false)
  })
})
