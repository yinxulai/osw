import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabases, initDatabases } from './index'
import { createWorkflow, getLatestWorkflow, getWorkflow, getWorkflowByVersion, listWorkflows, updateWorkflow } from './workflow-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await closeDatabases()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-workflow-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('workflow store', () => {
  it('creates versioned workflow records and resolves the latest record by type', async () => {
    await initDatabases(createTemporaryDirectory())

    const first = await createWorkflow({
      type: 'router',
      version: 1,
      name: 'Router v1',
      description: '第一版',
      definition: { nodes: [] },
    })
    const second = await createWorkflow({
      type: 'router',
      version: 2,
      name: 'Router v2',
      description: '',
      definition: { nodes: [{ id: 'input' }] },
    })

    expect(await getWorkflow(first.id)).toMatchObject({ id: first.id, type: 'router', version: 1, name: 'Router v1', description: '第一版', definition: { nodes: [] } })
    expect(await getWorkflow(second.id)).toMatchObject({ id: second.id, type: 'router', version: 2, name: 'Router v2', description: '', definition: { nodes: [{ id: 'input' }] } })
    expect(await getWorkflowByVersion('router', 1)).toMatchObject({ id: first.id, version: 1 })
    expect(await getLatestWorkflow('router')).toMatchObject({ id: second.id, version: 2 })
    expect(await listWorkflows('router')).toHaveLength(2)
  })

  it('assigns an increasing version number on its own and exposes the record id as the identity', async () => {
    await initDatabases(createTemporaryDirectory())

    const first = await createWorkflow({ type: 'router', name: 'A', description: '', definition: { nodes: [] } })
    const second = await createWorkflow({ type: 'router', name: 'B', description: '', definition: { nodes: [] } })

    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    expect(first.id).not.toBe(second.id)
    expect(await getWorkflowByVersion('router', 2)).toMatchObject({ id: second.id })
  })

  it('updates workflow metadata without changing the version identity', async () => {
    await initDatabases(createTemporaryDirectory())

    const workflow = await createWorkflow({
      type: 'router',
      version: 1,
      name: 'Router draft',
      description: '草稿',
      definition: { nodes: [] },
    })

    const updated = await updateWorkflow(workflow.id, {
      name: 'Router published',
      description: '已发布',
      definition: { nodes: [{ id: 'input' }, { id: 'output' }] },
    })

    expect(updated).toMatchObject({ id: workflow.id, type: 'router', version: 1, name: 'Router published', description: '已发布', definition: { nodes: [{ id: 'input' }, { id: 'output' }] } })
    expect(await getWorkflow(workflow.id)).toMatchObject({ name: 'Router published', description: '已发布' })
  })
})
