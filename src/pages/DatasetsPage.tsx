import { useDataSource } from '../hooks/useDataSource'
import { formatCount } from '../lib/format'
import { H3_RESOLUTION } from '../lib/limits'
import { DATASET_IDS, DATASET_META, FIELD_CATALOG } from '../types/datasets'

export function DatasetsPage() {
  const source = useDataSource()

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
        <header>
          <h1 className="text-xl font-semibold">Datasets</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Filters and columns follow Overture source fields. The Austin mock only fills values this catalog lists.
          </p>
        </header>
        <section className="rounded-lg border border-border bg-card p-4">
          {source.isLoading && <p className="text-sm text-muted-foreground">Loading source description…</p>}
          {source.error && <p className="text-sm text-destructive">{source.error.message}</p>}
          {source.data && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">{source.data.label}</p>
              <p className="text-muted-foreground">{source.data.note}</p>
              <p className="font-mono text-xs text-muted-foreground">
                Resolution {source.data.resolution || H3_RESOLUTION}
                {source.data.cells != null ? ` · ${formatCount(source.data.cells)} H3 cells` : ''}
                {source.data.coverage
                  ? ` · ${source.data.coverage.west}, ${source.data.coverage.south} to ${source.data.coverage.east}, ${source.data.coverage.north}`
                  : ''}
              </p>
              <ul className="grid gap-2 sm:grid-cols-3">
                {DATASET_IDS.map((dataset) => (
                  <li key={dataset} className="rounded-md border border-border px-3 py-2">
                    <span className="block text-xs text-muted-foreground">{DATASET_META[dataset].title}</span>
                    <span className="font-mono text-sm">
                      {source.data?.counts[dataset] == null ? '—' : formatCount(source.data.counts[dataset])}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        {DATASET_IDS.map((dataset) => (
          <section key={dataset}>
            <h2 className="text-base font-semibold">{DATASET_META[dataset].title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{DATASET_META[dataset].blurb}</p>
            <div className="mt-3 overflow-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-card">
                  <tr>
                    <th className="px-3 py-2 font-medium">Query field</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Operators</th>
                  </tr>
                </thead>
                <tbody>
                  {FIELD_CATALOG[dataset].map((field) => (
                    <tr key={field.field} className="border-t border-border">
                      <td className="px-3 py-2 font-mono">{field.field}</td>
                      <td className="px-3 py-2 text-muted-foreground">{field.source}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">
                        {field.operators.length === 0 ? 'display only' : field.operators.join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
