import { readDataMode } from '../lib/server-env'
import { listAgentLedger } from './agent-marketplace'
import { resolveUser } from './auth'

const MOCK_OWNER = 'mock-guest'

export async function getLedger(
  cookies: Record<string, string>,
): Promise<import('../types/agents').AgentLedgerResponse | { error: string; status: number }> {
  if (readDataMode().resolved === 'mock') {
    return listAgentLedger(MOCK_OWNER)
  }
  const session = await resolveUser(cookies)
  if (!session.user) return { error: 'Sign in to view your ledger.', status: 401 }
  return listAgentLedger(session.user.id)
}
