import { Link } from 'react-router-dom'
import { useDataSource } from '../hooks/useDataSource'
import { formatCount } from '../lib/format'
import { H3_RESOLUTION } from '../lib/limits'
import { DATASET_IDS, DATASET_META, FIELD_CATALOG } from '../types/datasets'

export function DatasetsPage() {
  const source = useDataSource()
  const counts = source.data?.counts
  const total =
    counts && counts.places != null && counts.buildings != null && counts.addresses != null
      ? counts.places + counts.buildings + counts.addresses
      : null

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
        <header>
          <h1 className="text-xl font-semibold">Datasets</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Process a hex to load places, buildings, and addresses from the public Overture release. All three themes
            are stored together, with geometry, Overture sources, and computed building or address links. Inspect shows
            those fields plus snapshot and attribution. It does not ask you to pick a theme. Each processed release is
            kept as a snapshot so later queries can pin a historical cut.{' '}
            <Link to="/licenses" className="text-primary underline-offset-2 hover:underline">
              Licenses
            </Link>
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
                {total != null ? ` · ${formatCount(total)} features` : ''}
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
        {source.data?.snapshots && source.data.snapshots.length > 0 && (
          <section>
            <h2 className="text-base font-semibold">Release snapshots</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Process writes one metadata row per Overture release. Query with release_version to read that cut.
              Omitted queries use the newest stored release in each hex.
            </p>
            <div className="mt-3 overflow-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-card">
                  <tr>
                    <th className="px-3 py-2 font-medium">Release</th>
                    <th className="px-3 py-2 font-medium">Hexes</th>
                    <th className="px-3 py-2 font-medium">Places</th>
                    <th className="px-3 py-2 font-medium">Buildings</th>
                    <th className="px-3 py-2 font-medium">Addresses</th>
                    <th className="px-3 py-2 font-medium">Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {source.data.snapshots.map((snapshot) => (
                    <tr key={snapshot.release_version} className="border-t border-border">
                      <td className="px-3 py-2 font-mono">
                        {snapshot.release_version}
                        {snapshot.current ? (
                          <span className="ml-2 text-[10px] tracking-wide text-primary uppercase">Current</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-mono">{formatCount(snapshot.hex_count)}</td>
                      <td className="px-3 py-2 font-mono">{formatCount(snapshot.place_count)}</td>
                      <td className="px-3 py-2 font-mono">{formatCount(snapshot.building_count)}</td>
                      <td className="px-3 py-2 font-mono">{formatCount(snapshot.address_count)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {snapshot.source_datasets.length > 0 ? snapshot.source_datasets.join(', ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
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
