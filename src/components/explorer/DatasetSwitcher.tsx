import { Building, Mailbox, MapPin } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '../../lib/utils'
import { useExplorer } from '../../store/explorer-store'
import { DATASET_IDS, DATASET_META, type DatasetId } from '../../types/datasets'

export const DATASET_ICONS: Record<DatasetId, ComponentType<{ className?: string }>> = {
  buildings: Building,
  addresses: Mailbox,
  places: MapPin,
}

/** In compact mode only the active dataset shows its label, so the pill fits a phone top bar. */
export function DatasetSwitcher({ compact = false }: { compact?: boolean }) {
  const dataset = useExplorer((state) => state.dataset)
  const setDataset = useExplorer((state) => state.setDataset)
  return (
    <div role="radiogroup" aria-label="Dataset" className="glass flex items-center gap-0.5 rounded-full p-1">
      {DATASET_IDS.map((id) => {
        const Icon = DATASET_ICONS[id]
        const active = id === dataset
        const showLabel = !compact || active
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={DATASET_META[id].title}
            data-testid={`dataset-${id}`}
            onClick={() => setDataset(id)}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-full text-[13px] font-medium transition-all duration-200',
              showLabel ? 'px-3.5' : 'w-9 justify-center',
              active
                ? 'bg-primary text-primary-foreground shadow-[0_0_22px_-4px_rgba(61,222,192,0.7)]'
                : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {showLabel && <span>{DATASET_META[id].title}</span>}
          </button>
        )
      })}
    </div>
  )
}
