import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { eventBus } from '@/lib/event-bus'
import { queryPendingAssignments } from './adapter'
import type { FrameworkAdapter, AgentRegistration, HeartbeatPayload, TaskReport, Assignment } from './adapter'

/**
 * NemoClaw adapter — extends the OpenClaw adapter with sandbox lifecycle,
 * NIM inference health, blueprint execution, and network policy awareness.
 */

export interface SandboxStatus {
  name: string
  state: 'running' | 'stopped' | 'error' | 'provisioning'
  uptime?: string
  inferenceProvider?: string
  inferenceModel?: string
  inferenceEndpoint?: string
  policies?: string[]
}

export interface NimHealth {
  running: boolean
  healthy: boolean
  model?: string
  endpoint?: string
  latencyMs?: number
}

function readSandboxRegistry(): SandboxStatus[] {
  try {
    const registryPath = join(homedir(), '.nemoclaw', 'sandboxes.json')
    const raw = readFileSync(registryPath, 'utf-8')
    const registry = JSON.parse(raw) as Record<string, Record<string, unknown>>
    return Object.entries(registry).map(([name, info]) => ({
      name,
      state: (info.state as SandboxStatus['state']) ?? 'stopped',
      uptime: info.uptime as string | undefined,
      inferenceProvider: info.inferenceProvider as string | undefined,
      inferenceModel: info.inferenceModel as string | undefined,
      inferenceEndpoint: info.inferenceEndpoint as string | undefined,
      policies: info.policies as string[] | undefined,
    }))
  } catch {
    return []
  }
}

function queryNimHealth(sandboxName: string): NimHealth {
  try {
    const output = execFileSync('nemoclaw', [sandboxName, 'status', '--json'], {
      timeout: 10_000,
      encoding: 'utf-8',
    }).trim()
    const parsed = JSON.parse(output) as Record<string, unknown>
    return {
      running: parsed.nimRunning === true,
      healthy: parsed.nimHealthy === true,
      model: parsed.model as string | undefined,
      endpoint: parsed.endpoint as string | undefined,
    }
  } catch {
    return { running: false, healthy: false }
  }
}

export class NemoClawAdapter implements FrameworkAdapter {
  readonly framework = 'nemoclaw'

  async register(agent: AgentRegistration): Promise<void> {
    const sandboxes = readSandboxRegistry()

    eventBus.broadcast('agent.created', {
      id: agent.agentId,
      name: agent.name,
      framework: this.framework,
      status: 'online',
      sandboxes: sandboxes.map(s => s.name),
      ...agent.metadata,
    })
  }

  async heartbeat(payload: HeartbeatPayload): Promise<void> {
    const sandboxes = readSandboxRegistry()
    const nimHealths: Record<string, NimHealth> = {}

    for (const sandbox of sandboxes) {
      if (sandbox.state === 'running') {
        nimHealths[sandbox.name] = queryNimHealth(sandbox.name)
      }
    }

    eventBus.broadcast('agent.status_changed', {
      id: payload.agentId,
      status: payload.status,
      framework: this.framework,
      metrics: {
        ...payload.metrics,
        sandboxes: sandboxes.map(s => ({
          name: s.name,
          state: s.state,
          uptime: s.uptime,
          inferenceProvider: s.inferenceProvider,
          inferenceModel: s.inferenceModel,
          policies: s.policies,
          nim: nimHealths[s.name] ?? null,
        })),
      },
    })
  }

  async reportTask(report: TaskReport): Promise<void> {
    eventBus.broadcast('task.updated', {
      id: report.taskId,
      agentId: report.agentId,
      progress: report.progress,
      status: report.status,
      output: report.output,
      framework: this.framework,
    })
  }

  async getAssignments(agentId: string): Promise<Assignment[]> {
    return queryPendingAssignments(agentId)
  }

  async disconnect(agentId: string): Promise<void> {
    eventBus.broadcast('agent.status_changed', {
      id: agentId,
      status: 'offline',
      framework: this.framework,
    })
  }
}
