import { ArrowDown, ArrowUp, Building, Check, Copy, Mailbox, Store } from 'lucide-react'
import { useState, type ComponentType, type ReactNode } from 'react'
import { useCompiledQuery } from '../../hooks/useCompiledQuery'
import { PAGE_SIZES } from '../../lib/limits'
import { summarizeQuery } from '../../lib/query-builder'
import { cn } from '../../lib/utils'
import { useExplorer, type ExampleId } from '../../store/explorer-store'
import { BUILDING_SUBTYPES, FIELD_CATALOG, type DatasetId } from '../../types/datasets'
import { BASIC_CATEGORIES, PRIMARY_CATEGORIES } from '../../types/place-presets'
import { Input, nativeSelectClass } from '../ui/input'

const EXAMPLES: { id: ExampleId; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'places-food', label: 'Restaurants and cafes', icon: Store },
  { id: 'buildings-tall', label: 'Buildings ≥ 10 m', icon: Building },
  { id: 'addresses-postcode', label: 'Postal code 78701', icon: Mailbox },
]

export function QueryForm() {
  const dataset = useExplorer((state) => state.dataset)
  const applyExample = useExplorer((state) => state.applyExample)
  const compiled = useCompiledQuery()
  const [copied, setCopied] = useState(false)
  const specJson = JSON.stringify(compiled.spec, null, 2)

  return (
    <div className="flex flex-col gap-5">
      <Section title="Examples">
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example.id}
              type="button"
              data-testid={`example-${example.id}`}
              onClick={() => applyExample(example.id)}
              className={cn(
                'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                example.id.startsWith(dataset)
                  ? 'border-primary/35 bg-primary/10 text-foreground hover:bg-primary/15'
                  : 'border-white/[0.08] text-muted-foreground hover:border-white/20 hover:text-foreground',
              )}
            >
              <example.icon className="size-3.5" />
              {example.label}
            </button>
          ))}
        </div>
      </Section>

      {dataset === 'places' && <PlacesFields />}
      {dataset === 'buildings' && <BuildingsFields />}
      {dataset === 'addresses' && <AddressesFields />}

      <SortAndLimit dataset={dataset} />

      {compiled.errors.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {compiled.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-primary uppercase">Query</p>
        <p className="mt-1.5 text-[13px] leading-5 text-foreground/90">{summarizeQuery(compiled.spec)}</p>
      </div>

      <details className="group rounded-xl border border-white/[0.06]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          Query JSON
          <span className="font-mono text-[10px] group-open:hidden">{compiled.spec.filters.length} filters</span>
        </summary>
        <div className="border-t border-white/[0.06] p-3">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 text-xs font-medium hover:bg-white/[0.04]"
            onClick={() => {
              void navigator.clipboard.writeText(specJson).then(
                () => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1500)
                },
                () => setCopied(false),
              )
            }}
          >
            {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy JSON'}
          </button>
          <pre className="mt-2 max-h-56 overflow-auto font-mono text-[10px] leading-4 text-muted-foreground">{specJson}</pre>
        </div>
      </details>
    </div>
  )
}

function PlacesFields() {
  const form = useExplorer((state) => state.filtersByDataset.places)
  const patch = useExplorer((state) => state.patchPlaces)
  return (
    <>
      <Field label="Place name" hint="Matches names.primary">
        <Input
          value={form.name}
          data-testid="filter-place-name"
          placeholder="Lantern"
          onChange={(event) => patch({ name: event.target.value })}
        />
      </Field>
      <Field label="Basic category" hint="Sample of Overture basic_category values in this mock.">
        <select
          className={nativeSelectClass}
          data-testid="filter-basic-category"
          value={form.basicCategories[0] ?? ''}
          onChange={(event) => patch({ basicCategories: event.target.value ? [event.target.value] : [] })}
        >
          <option value="">Any</option>
          {BASIC_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Primary category" hint="taxonomy.primary">
        <select
          className={nativeSelectClass}
          value={form.primaryCategory}
          onChange={(event) => patch({ primaryCategory: event.target.value })}
        >
          <option value="">Any</option>
          {PRIMARY_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </Field>
      <Range
        label="Confidence"
        hint="0 to 1. Places with no score fail a numeric comparison."
        inputMode="decimal"
        min={form.confidenceMin}
        max={form.confidenceMax}
        minPlaceholder="0.7"
        maxPlaceholder="1"
        onMin={(confidenceMin) => patch({ confidenceMin })}
        onMax={(confidenceMax) => patch({ confidenceMax })}
      />
    </>
  )
}

function BuildingsFields() {
  const form = useExplorer((state) => state.filtersByDataset.buildings)
  const patch = useExplorer((state) => state.patchBuildings)
  return (
    <>
      <Field label="Building subtype">
        <select
          className={nativeSelectClass}
          data-testid="filter-building-subtype"
          value={form.subtypes[0] ?? ''}
          onChange={(event) => patch({ subtypes: event.target.value ? [event.target.value] : [] })}
        >
          <option value="">Any</option>
          {BUILDING_SUBTYPES.map((subtype) => (
            <option key={subtype} value={subtype}>
              {subtype}
            </option>
          ))}
        </select>
      </Field>
      <Presence label="Subtype value" value={form.hasSubtype} onChange={(hasSubtype) => patch({ hasSubtype })} />
      <Range
        label="Height (m)"
        inputMode="decimal"
        min={form.heightMin}
        max={form.heightMax}
        minPlaceholder="10"
        maxPlaceholder="40"
        minTestId="filter-height-min"
        onMin={(heightMin) => patch({ heightMin })}
        onMax={(heightMax) => patch({ heightMax })}
      />
      <Presence label="Height value" value={form.hasHeight} onChange={(hasHeight) => patch({ hasHeight })} />
      <Range
        label="Floors"
        inputMode="numeric"
        min={form.floorsMin}
        max={form.floorsMax}
        minPlaceholder="2"
        maxPlaceholder="8"
        onMin={(floorsMin) => patch({ floorsMin })}
        onMax={(floorsMax) => patch({ floorsMax })}
      />
    </>
  )
}

function AddressesFields() {
  const form = useExplorer((state) => state.filtersByDataset.addresses)
  const patch = useExplorer((state) => state.patchAddresses)
  return (
    <>
      <Field label="Street">
        <Input value={form.street} placeholder="Congress" onChange={(event) => patch({ street: event.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Locality" hint="address_levels locality">
          <Input value={form.locality} placeholder="Austin" onChange={(event) => patch({ locality: event.target.value })} />
        </Field>
        <Field label="Region" hint="address_levels state">
          <Input value={form.region} placeholder="TX" onChange={(event) => patch({ region: event.target.value })} />
        </Field>
      </div>
      <Field label="Postal code" hint="Exact postcode match">
        <Input
          data-testid="filter-postcode"
          inputMode="numeric"
          value={form.postcode}
          placeholder="78701"
          onChange={(event) => patch({ postcode: event.target.value })}
        />
      </Field>
      <Field label="Address text" hint="Searches number, street, locality, region, and postcode">
        <Input value={form.address} placeholder="6th" onChange={(event) => patch({ address: event.target.value })} />
      </Field>
    </>
  )
}

function SortAndLimit({ dataset }: { dataset: DatasetId }) {
  const sortField = useExplorer((state) => state.sortField)
  const sortDirection = useExplorer((state) => state.sortDirection)
  const setSort = useExplorer((state) => state.setSort)
  const limit = useExplorer((state) => state.limit)
  const setLimit = useExplorer((state) => state.setLimit)
  const fields = FIELD_CATALOG[dataset].filter((field) => field.sortable)
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3">
      <Field label="Sort by">
        <div className="flex gap-1.5">
          <select className={nativeSelectClass} value={sortField} onChange={(event) => setSort(event.target.value)}>
            {fields.map((field) => (
              <option key={field.field} value={field.field}>
                {field.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={sortDirection === 'asc' ? 'Sorted ascending. Switch to descending.' : 'Sorted descending. Switch to ascending.'}
            onClick={() => setSort(sortField)}
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] text-muted-foreground hover:border-white/20 hover:text-foreground"
          >
            {sortDirection === 'asc' ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
          </button>
        </div>
      </Field>
      <Field label="Per page">
        <select
          className={cn(nativeSelectClass, 'w-20')}
          value={limit}
          onChange={(event) => setLimit(Number(event.target.value))}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </Field>
    </div>
  )
}

function Range({
  label,
  hint,
  inputMode,
  min,
  max,
  minPlaceholder,
  maxPlaceholder,
  minTestId,
  onMin,
  onMax,
}: {
  label: string
  hint?: string
  inputMode: 'decimal' | 'numeric'
  min: string
  max: string
  minPlaceholder: string
  maxPlaceholder: string
  minTestId?: string
  onMin: (value: string) => void
  onMax: (value: string) => void
}) {
  return (
    <Section title={label} hint={hint}>
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Minimum ${label}`}
          data-testid={minTestId}
          inputMode={inputMode}
          value={min}
          placeholder={`Min ${minPlaceholder}`}
          onChange={(event) => onMin(event.target.value)}
        />
        <span className="text-muted-foreground">–</span>
        <Input
          aria-label={`Maximum ${label}`}
          inputMode={inputMode}
          value={max}
          placeholder={`Max ${maxPlaceholder}`}
          onChange={(event) => onMax(event.target.value)}
        />
      </div>
    </Section>
  )
}

function Presence({
  label,
  value,
  onChange,
}: {
  label: string
  value: 'any' | 'present' | 'missing'
  onChange: (value: 'any' | 'present' | 'missing') => void
}) {
  const options = [
    { value: 'any', label: 'Any' },
    { value: 'present', label: 'Present' },
    { value: 'missing', label: 'Missing' },
  ] as const
  return (
    <Section title={label}>
      <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-white/[0.08] p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={cn(
              'h-7 flex-1 rounded-md text-xs font-medium transition-colors',
              value === option.value
                ? 'bg-white/[0.09] text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Section>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium text-foreground/90">{title}</h3>
      {children}
      {hint && <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-foreground/90">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11px] leading-4 text-muted-foreground">{hint}</span>}
    </label>
  )
}
