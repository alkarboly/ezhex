import { EyeOff, Hexagon, Layers, LayoutGrid, LocateFixed, Map as MapIcon, Minus, Plus, Satellite } from 'lucide-react'
import type { ButtonHTMLAttributes, ComponentType, Ref, RefObject } from 'react'
import { cn } from '../../lib/utils'
import { useExplorer, type BasemapId, type HexMode } from '../../store/explorer-store'
import type { H3MapHandle } from '../map/H3Map'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

type Icon = ComponentType<{ className?: string }>

const BASEMAPS: { id: BasemapId; label: string; icon: Icon; preview: string }[] = [
  {
    id: 'streets',
    label: 'Streets',
    icon: MapIcon,
    preview:
      'linear-gradient(115deg, transparent 46%, rgb(90 110 130 / 0.55) 47%, transparent 49%), linear-gradient(20deg, transparent 60%, rgb(90 110 130 / 0.4) 61%, transparent 62.5%), linear-gradient(160deg, #0c141c, #18232e)',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    icon: Satellite,
    preview:
      'radial-gradient(circle at 28% 35%, rgb(96 110 70 / 0.9), transparent 45%), radial-gradient(circle at 72% 70%, rgb(120 104 80 / 0.85), transparent 42%), linear-gradient(140deg, #2b3527, #3d3a2c)',
  },
]

const HEX_MODES: { id: HexMode; label: string; hint: string; touchHint: string; icon: Icon }[] = [
  {
    id: 'lens',
    label: 'Lens',
    hint: 'Cells light up around the cursor',
    touchHint: 'Cells light up around the map center',
    icon: Hexagon,
  },
  { id: 'grid', label: 'Grid', hint: 'Color every cell in view', touchHint: 'Color every cell in view', icon: LayoutGrid },
  { id: 'off', label: 'Hidden', hint: 'Hide the H3 layer', touchHint: 'Hide the H3 layer', icon: EyeOff },
]

export function LayersPanel({ touch }: { touch: boolean }) {
  const basemap = useExplorer((state) => state.basemap)
  const setBasemap = useExplorer((state) => state.setBasemap)
  const hexMode = useExplorer((state) => state.hexMode)
  const setHexMode = useExplorer((state) => state.setHexMode)
  return (
    <div className="w-64">
      <p className="px-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Basemap</p>
      <div role="radiogroup" aria-label="Basemap" className="mt-2 grid grid-cols-2 gap-2">
        {BASEMAPS.map((option) => {
          const active = basemap === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.label}
              onClick={() => setBasemap(option.id)}
              className={cn(
                'overflow-hidden rounded-xl border text-left transition-colors',
                active ? 'border-primary/70 ring-1 ring-primary/40' : 'border-white/[0.08] hover:border-white/20',
              )}
            >
              <span className="block h-14" style={{ background: option.preview }} />
              <span
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <option.icon className="size-3.5" />
                {option.label}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-4 px-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">H3 cells</p>
      <div role="radiogroup" aria-label="H3 cells" className="mt-1.5 flex flex-col gap-0.5">
        {HEX_MODES.map((option) => {
          const active = hexMode === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.label}
              onClick={() => setHexMode(option.id)}
              className={cn(
                'flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                active ? 'bg-primary/10' : 'hover:bg-white/[0.04]',
              )}
            >
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-lg border',
                  active ? 'border-primary/50 bg-primary/15 text-primary' : 'border-white/[0.08] text-muted-foreground',
                )}
              >
                <option.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className={cn('block text-sm font-medium', active && 'text-primary')}>{option.label}</span>
                <span className="block text-xs text-muted-foreground">{touch ? option.touchHint : option.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function MapControls({ mapRef, touch }: { mapRef: RefObject<H3MapHandle | null>; touch: boolean }) {
  return (
    <div className="glass flex flex-col overflow-hidden rounded-xl">
      <ControlButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
        <Plus />
      </ControlButton>
      <ControlButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
        <Minus />
      </ControlButton>
      <ControlButton label="Back to Austin" onClick={() => mapRef.current?.resetView()}>
        <LocateFixed />
      </ControlButton>
      <span className="mx-2 h-px bg-white/[0.08]" />
      <LayersButton touch={touch} side="left" align="start" />
    </div>
  )
}

export function LayersButton({
  touch,
  side,
  align,
  className,
}: {
  touch: boolean
  side: 'left' | 'bottom'
  align: 'start' | 'end'
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Map layers"
          data-testid="layers-button"
          className={cn(
            'grid size-10 place-items-center text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground data-[state=open]:text-primary [&_svg]:size-[18px]',
            className,
          )}
        >
          <Layers />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align}>
        <LayersPanel touch={touch} />
      </PopoverContent>
    </Popover>
  )
}

function ControlButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; ref?: Ref<HTMLButtonElement> }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'grid size-10 place-items-center text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground [&_svg]:size-[18px]',
            className,
          )}
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )
}
