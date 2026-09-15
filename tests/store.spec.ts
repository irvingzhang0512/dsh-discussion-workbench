import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchStore } from '../src/host/store.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dwb-'))
  const changes: string[] = []
  const store = new WorkbenchStore({ cwd: () => root, onChange: id => changes.push(id) })
  return { root, store, changes, cleanup: () => rm(root, { recursive: true, force: true }) }
}

describe('WorkbenchStore', () => {
  it('按会话保存目标、文件材料和粘贴材料并可分段读取', async () => {
    const env = await fixture()
    try {
      await writeFile(join(env.root, 'target.md'), '# 目标\n', 'utf8')
      await writeFile(join(env.root, 'notes.txt'), '0123456789', 'utf8')
      const state = await env.store.update('session-a', {
        scene: 'project', targetFile: 'target.md', addPath: 'notes.txt',
        paste: { label: '初步纪要', content: '决定：周五上线' },
      })
      expect(state.scene).toBe('project')
      expect(state.materials).toHaveLength(2)
      const first = await env.store.readMaterial('session-a', state.materials[0]!.id, 0, 4)
      expect(first.content).toBe('0123')
      expect(first.truncated).toBe(true)
      const second = await env.store.readMaterial('session-a', state.materials[1]!.id, 0, 100)
      expect(second.content).toContain('周五上线')
      expect(await readFile(join(env.root, '.dsh-workbench', 'sessions', (await filenames(env.root))[0]!), 'utf8')).toContain('target.md')
    } finally { await env.cleanup() }
  })

  it('刷新恢复上下文并把未完成任务标记为中断', async () => {
    const env = await fixture()
    try {
      await writeFile(join(env.root, 'target.md'), '# 目标\n', 'utf8')
      await env.store.update('session-a', { targetFile: 'target.md' })
      await env.store.mutateRuntime('session-a', state => { state.task = { phase: 'saving', label: '正在保存', startedAt: 1 } }, true)
      const restored = await new WorkbenchStore({ cwd: () => env.root, onChange: () => {} }).get('session-a')
      expect(restored.targetFile).toBe(join(env.root, 'target.md'))
      expect(restored.task.phase).toBe('interrupted')
    } finally { await env.cleanup() }
  })

  it('隔离会话并拒绝工作区外路径', async () => {
    const env = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'dwb-outside-'))
    try {
      await writeFile(join(env.root, 'a.md'), '# A\n', 'utf8')
      await writeFile(join(outside, 'outside.txt'), 'secret', 'utf8')
      await env.store.update('a', { targetFile: 'a.md' })
      expect((await env.store.get('a')).targetBinding).toBe('bound')
      expect((await env.store.get('b')).targetFile).toBeNull()
      await expect(env.store.update('a', { addPath: join(outside, 'outside.txt') })).rejects.toThrow('超出会话工作区')
      expect((await env.store.get('a')).materials).toEqual([])
      expect((await env.store.get('a')).targetFile).toBe(join(env.root, 'a.md'))
    } finally { await env.cleanup(); await rm(outside, { recursive: true, force: true }) }
  })

  it('持久化失败时不发布或保留半完成的上下文', async () => {
    const env = await fixture()
    try {
      await writeFile(join(env.root, 'a.md'), '# A\n', 'utf8')
      await env.store.update('a', { targetFile: 'a.md' })
      const beforeChanges = env.changes.length
      vi.spyOn(env.store, 'persist').mockRejectedValueOnce(new Error('disk full'))
      await expect(env.store.update('a', { scene: 'project' })).rejects.toThrow('disk full')
      expect((await env.store.get('a')).scene).toBe('meeting')
      expect(env.changes).toHaveLength(beforeChanges)
      vi.spyOn(env.store, 'persist').mockRejectedValueOnce(new Error('disk full'))
      await expect(env.store.mutateRuntime('a', state => { state.targetBinding = 'error' }, true)).rejects.toThrow('disk full')
      expect((await env.store.get('a')).targetBinding).toBe('bound')
    } finally { await env.cleanup() }
  })
})

async function filenames(root: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  return readdir(join(root, '.dsh-workbench', 'sessions'))
}
