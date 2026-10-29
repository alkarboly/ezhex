import { ArrowUp, ClipboardPaste, Cloud, Hexagon, MapPin, Paperclip, PenLine, Shapes, Square, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { closedRing } from '../../lib/enrichments'
import { extractHexCells } from '../../lib/hex-ids'
import { parsePolygonText } from '../../lib/polygon-input'
import { cn } from '../../lib/utils'
import { useAgent } from '../../store/agent-store'
import { useExplorer } from '../../store/explorer-store'
import type { GeofencePolygon } from '../../types/enrichments'
import { attachAgentPolygon, runAgent, stopAgent } from './agent-runner'

const PLACEHOLDERS = [
  'Help me search for commercial properties in the Westgate neighborhood in Austin TX…',
  'Help me find coffee shops along South Lamar…',
  'Help me find commercial properties along I-35 between Austin and Buda, Texas…',
]

export function AgentComposer({ busy, mobile }: { busy: boolean; mobile: boolean }) {
  const [text, setText] = useState('')
  const [menu, setMenu] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [attachError, setAttachError] = useState<string | null>(null)
  const [placeholder, setPlaceholder] = useState(0)
  const weather = useAgent((state) => state.weather)
  const setWeather = useAgent((state) => state.setWeather)
  const attachment = useAgent((state) => state.attachment)
  const drawing = useAgent((state) => state.drawing)
  const selectedCount = useExplorer((state) => state.selectedCells.length)
  const listedCount = extractHexCells(text).length
  const hexHint =
    listedCount > 0
      ? `Using ${listedCount} hex${listedCount === 1 ? '' : 'es'} from this message`
      : selectedCount > 0
        ? `Using ${selectedCount} selected hex${selectedCount === 1 ? '' : 'es'}`
        : null
  const { session } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const signInNeeded = Boolean(session.data?.configured && !session.data.user)

  useEffect(() => {
    if (!mobile) areaRef.current?.focus()
  }, [mobile])

  useEffect(() => {
    if (text) return
    const timer = window.setInterval(() => setPlaceholder((index) => (index + 1) % PLACEHOLDERS.length), 3800)
    return () => window.clearInterval(timer)
  }, [text])

  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.min(area.scrollHeight, 132)}px`
  }, [text])

  const send = () => {
    const value = text.trim()
    if (!value || busy) return
    setText('')
    void runAgent(value)
  }

  const attachPolygon = (polygon: GeofencePolygon, label: string) => {
    attachAgentPolygon(polygon, label)
    setAttachError(null)
    setPasting(false)
    setPasteText('')
    setMenu(false)
  }

  const parseAndAttach = (raw: string, label: string) => {
    const polygon = parsePolygonText(raw)
    if (!polygon) {
      setAttachError('Use a GeoJSON Polygon, Feature, FeatureCollection, WKT POLYGON, or a list of [lng, lat] points.')
      return
    }
    attachPolygon(polygon, label)
  }

  const onFile = async (file: File) => {
    try {
      parseAndAttach(await file.text(), file.name)
    } catch {
      setAttachError('Could not read that file.')
    }
  }

  const startDrawing = () => {
    setMenu(false)
    setAttachError(null)
    useExplorer.getState().setDrawMode('geofence')
    useAgent.getState().setDrawing(true)
    if (mobile) useAgent.getState().setOpen(false)
  }

  const removeAttachment = () => {
    useAgent.getState().setAttachment(null)
    if (!busy) useExplorer.getState().removeDraftEnrichment('geofence')
  }

  return (
    <div className="relative border-t border-white/[0.06] bg-black/25 px-3 pt-2.5 pb-3">
      {signInNeeded && (
        <p className="mb-2 rounded-xl border border-select/30 bg-select/[0.07] px-2.5 py-1.5 text-[10.5px] text-select">
          Sign in so the agent can save workflows and run private enrichments.{' '}
          <Link to="/settings" className="font-medium underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      )}
      {drawing && <DrawBar onDone={(polygon) => attachPolygon(polygon, 'Drawn polygon')} />}
      {pasting && (
        <div className="wp-rise mb-2 grid gap-1.5 rounded-xl border border-white/[0.08] bg-black/30 p-2">
          <textarea
            value={pasteText}
            autoFocus
            onChange={(event) => setPasteText(event.target.value)}
            placeholder='{"type":"Polygon","coordinates":[[[-97.75,30.27],[-97.72,30.27],[-97.72,30.24],[-97.75,30.27]]]} or POLYGON((…))'
            className="min-h-16 resize-none rounded-lg border border-white/[0.08] bg-black/40 px-2 py-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary/40"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setPasting(false)}
              className="h-7 rounded-full px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => parseAndAttach(pasteText, 'Pasted polygon')}
              className="h-7 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground"
            >
              Attach
            </button>
          </div>
        </div>
      )}
      {attachError && <p className="mb-1.5 text-[10.5px] text-destructive">{attachError}</p>}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {attachment ? (
          <span className="wp-rise inline-flex h-6 items-center gap-1 rounded-full border border-primary/35 bg-primary/10 pr-1 pl-2 text-[10.5px] text-primary">
            <Shapes className="size-3" />
            <span className="max-w-[9rem] truncate">{attachment.label}</span>
            <span className="text-primary/70">· {attachment.vertices} pts</span>
            <button
              type="button"
              aria-label="Remove polygon"
              onClick={removeAttachment}
              className="grid size-4 place-items-center rounded-full hover:bg-primary/20"
            >
              <X className="size-2.5" />
            </button>
          </span>
        ) : (
          <span
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10.5px]',
              hexHint
                ? 'border-primary/35 bg-primary/10 text-primary'
                : 'border-white/[0.08] bg-white/[0.03] text-muted-foreground',
            )}
          >
            {hexHint ? <Hexagon className="size-3" /> : <MapPin className="size-3" />}
            {hexHint ?? 'Map center or a named place'}
          </span>
        )}
        <button
          type="button"
          aria-pressed={weather}
          onClick={() => setWeather(!weather)}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10.5px] transition-colors',
            weather
              ? 'border-select/45 bg-select/15 text-select shadow-[0_0_14px_-4px_rgba(244,194,91,0.7)]'
              : 'border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground',
          )}
        >
          <Cloud className="size-3" />
          Weather {weather ? '· hail' : ''}
        </button>
      </div>
      <div className="flex items-end gap-1.5 rounded-2xl border border-white/[0.09] bg-black/35 p-1.5 transition-colors focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_rgba(61,222,192,0.08)]">
        <div className="relative">
          <button
            type="button"
            aria-label="Attach a region"
            aria-expanded={menu}
            onClick={() => setMenu((value) => !value)}
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <Paperclip className="size-4" />
          </button>
          {menu && (
            <div className="glass wp-rise absolute bottom-10 left-0 z-10 grid w-52 gap-0.5 rounded-xl p-1">
              <MenuItem icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                Upload polygon file
              </MenuItem>
              <MenuItem
                icon={<ClipboardPaste className="size-3.5" />}
                onClick={() => {
                  setMenu(false)
                  setPasting(true)
                }}
              >
                Paste GeoJSON or WKT
              </MenuItem>
              <MenuItem icon={<PenLine className="size-3.5" />} onClick={startDrawing}>
                Draw on the map
              </MenuItem>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".geojson,.json,.txt,.wkt,application/geo+json,application/json,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onFile(file)
              event.currentTarget.value = ''
              setMenu(false)
            }}
          />
        </div>
        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
          placeholder={PLACEHOLDERS[placeholder]}
          aria-label="Tell the agent what to build"
          className="min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-[12.5px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/60"
        />
        {busy ? (
          <button
            type="button"
            aria-label="Stop the agent"
            onClick={stopAgent}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.1] text-foreground transition-colors hover:bg-destructive/25 hover:text-destructive"
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={!text.trim()}
            onClick={send}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_0_18px_-4px_rgba(61,222,192,0.9)] transition-all hover:scale-105 disabled:scale-100 disabled:bg-white/[0.08] disabled:text-muted-foreground disabled:shadow-none"
          >
            <ArrowUp className="size-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
      <p className="mt-1.5 px-1 text-[9.5px] text-muted-foreground/70">
        Enter to send · paste H3 ids or use the map selection · Ctrl K toggles the agent
      </p>
    </div>
  )
}

function MenuItem({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11.5px] text-foreground/90 hover:bg-white/[0.06]"
    >
      <span className="text-primary">{icon}</span>
      {children}
    </button>
  )
}

/** Finish or cancel a polygon drawn on the map with the geofence draw mode. */
export function DrawBar({ onDone, floating = false }: { onDone: (polygon: GeofencePolygon) => void; floating?: boolean }) {
  const vertices = useExplorer((state) => state.geofenceDraft)
  const [error, setError] = useState<string | null>(null)
  const finish = () => {
    const ring = closedRing(vertices)
    if (!ring) {
      setError('Click at least three points on the map.')
      return
    }
    useExplorer.getState().clearGeofenceDraft()
    useAgent.getState().setDrawing(false)
    onDone({ type: 'Polygon', coordinates: [ring] })
  }
  const cancel = () => {
    useExplorer.getState().clearGeofenceDraft()
    useAgent.getState().setDrawing(false)
  }
  return (
    <div
      className={cn(
        'wp-rise flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/[0.08] px-2.5 py-1.5',
        floating ? 'glass pointer-events-auto' : 'mb-2',
      )}
    >
      <span className="min-w-0 text-[10.5px] text-primary">
        {error ?? `Click the map to outline the area · ${vertices.length} points`}
      </span>
      <span className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={() => useExplorer.getState().undoGeofenceVertex()}
          className="h-6 rounded-full px-2 text-[10.5px] text-muted-foreground hover:text-foreground"
        >
          Undo
        </button>
        <button type="button" onClick={cancel} className="h-6 rounded-full px-2 text-[10.5px] text-muted-foreground hover:text-foreground">
          Cancel
        </button>
        <button type="button" onClick={finish} className="h-6 rounded-full bg-primary px-2.5 text-[10.5px] font-medium text-primary-foreground">
          Use area
        </button>
      </span>
    </div>
  )
}
