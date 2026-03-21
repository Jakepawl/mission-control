import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface SandboxInfo {
  name: string
  state: string
  uptime?: string
  inferenceProvider?: string
  inferenceModel?: string
  inferenceEndpoint?: string
  policies?: string[]
  nim?: {
    running: boolean
    healthy: boolean
    model?: string
    endpoint?: string
  }
}

function readRegistry(): Record<string, Record<string, unknown>> {
  const stateDir = process.env.NEMOCLAW_STATE_DIR || join(homedir(), '.nemoclaw')
  const registryPath = join(stateDir, 'sandboxes.json')
  try {
    return JSON.parse(readFileSync(registryPath, 'utf-8'))
  } catch {
    return {}
  }
}

function readPluginState(): Record<string, unknown> {
  const stateDir = process.env.NEMOCLAW_STATE_DIR || join(homedir(), '.nemoclaw')
  const statePath = join(stateDir, 'state', 'nemoclaw.json')
  try {
    return JSON.parse(readFileSync(statePath, 'utf-8'))
  } catch {
    return {}
  }
}

function getNimStatus(sandboxName: string): SandboxInfo['nim'] {
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

/**
 * GET /api/nemoclaw/sandboxes — List all NemoClaw sandboxes with status.
 *
 * Query params:
 *   ?nim=true — include NIM health probe (slower, one exec per running sandbox)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const includeNim = request.nextUrl.searchParams.get('nim') === 'true'

  try {
    const registry = readRegistry()
    const pluginState = readPluginState()

    const sandboxes: SandboxInfo[] = Object.entries(registry).map(([name, info]) => {
      const sandbox: SandboxInfo = {
        name,
        state: (info.state as string) ?? 'unknown',
        uptime: info.uptime as string | undefined,
        inferenceProvider: info.inferenceProvider as string | undefined,
        inferenceModel: info.inferenceModel as string | undefined,
        inferenceEndpoint: info.inferenceEndpoint as string | undefined,
        policies: info.policies as string[] | undefined,
      }

      if (includeNim && sandbox.state === 'running') {
        sandbox.nim = getNimStatus(name)
      }

      return sandbox
    })

    return NextResponse.json({
      sandboxes,
      pluginState,
      count: sandboxes.length,
      running: sandboxes.filter(s => s.state === 'running').length,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/nemoclaw/sandboxes error')
    return NextResponse.json({ error: 'Failed to read NemoClaw state' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
