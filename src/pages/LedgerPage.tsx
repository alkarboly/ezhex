import { useQuery } from '@tanstack/react-query'
import { getAgentLedger } from '../services/ledger'
import type { LedgerEntry } from '../types/agents'

export function LedgerPage() {
  const ledger = useQuery({ queryKey: ['agent-ledger'], queryFn: getAgentLedger, refetchInterval: 8_000 })
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-8">
        <header>
          <h1 className="text-xl font-semibold">Ledger</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Demo simulated ledger for orchestrator and specialist agents. Credits, debits, payouts, and tips are shown
            per user account.
          </p>
        </header>
        {ledger.isLoading && <p className="text-sm text-muted-foreground">Loading ledger…</p>}
        {ledger.error && <p className="text-sm text-destructive">{ledger.error.message}</p>}
        {ledger.data && (
          <>
            <section className="grid gap-2 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground sm:grid-cols-4">
              <Stat label="Seeded credits" cents={ledger.data.seeded_credit_usd_cents} />
              <Stat label="Balance" cents={ledger.data.balance_usd_cents} />
              <Stat label="Spent" cents={ledger.data.total_spent_usd_cents} />
              <Stat label="Agent tips" cents={ledger.data.total_tips_usd_cents} />
            </section>
            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-white/[0.06] px-4 py-2 text-xs text-muted-foreground">
                {ledger.data.entries.length} entries
              </div>
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-[#0a1017] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Agent</th>
                      <th className="px-3 py-2 font-medium">Counterparty</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.entries.length === 0 && (
                      <tr>
                        <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
                          No ledger entries yet. Run a workflow to see agent debits and tips.
                        </td>
                      </tr>
                    )}
                    {ledger.data.entries.map((entry) => (
                      <EntryRow key={entry.id} entry={entry} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, cents }: { label: string; cents: number }) {
  return (
    <p>
      {label}
      <br />
      <span className="font-mono text-sm text-foreground">{formatCents(cents)}</span>
    </p>
  )
}

function EntryRow({ entry }: { entry: LedgerEntry }) {
  return (
    <tr className="border-t border-white/[0.05]">
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{entry.at.replace('T', ' ').slice(0, 19)}</td>
      <td className="px-3 py-2">{entry.type}</td>
      <td className="px-3 py-2">{entry.agent}</td>
      <td className="px-3 py-2">{entry.counterparty}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatCents(entry.usd_cents)}</td>
      <td className="px-3 py-2 text-muted-foreground">{entry.message}</td>
    </tr>
  )
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
