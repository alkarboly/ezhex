/** Pull a geocodable place name out of an agent prompt. */

const DISTANCE_UNIT = String.raw`(?:km|kilomet(?:er|re)s?|mi|miles?|m|met(?:er|re)s?)`
const CAP_PLACE_RE = new RegExp(
  String.raw`(?:^|[^A-Za-z])(?:[Nn]ear|[Aa]round|[Ii]n|[Aa]t|[Bb]y|[Aa]long|[Oo]n|[Aa]cross|[Oo]ver|[Cc]overing|[Oo]f|[Ww]ithin\s+[\d.]+\s*${DISTANCE_UNIT}\s+of)\s+((?:the\s+)?[A-Z0-9][\w'’.&-]*(?:,?\s+(?:[A-Z0-9][\w'’.&-]*|of|de|del|la|le|the|and|on|at|&))*)`,
)
const LOWER_PLACE_RE = new RegExp(
  String.raw`\b(?:near|around|in|at|by|along|over|covering|within\s+[\d.]+\s*${DISTANCE_UNIT}\s+of)\s+(?!(?:my|the selected|this|these|that|those|view|here|there|the map|the view|the last|the past|last|past|each|every|them|it|a|an)\b)((?:the\s+)?[a-z0-9][a-z0-9'’.&-]*(?:\s+[a-z0-9][a-z0-9'’.&-]*){0,6}?)(?=\s+(?:with|and|that|for|using|plus|then|add|adding|score|scoring|classify|rate|rank|flag|over|during|from|within|having|where|which|who|keep|only|but|including)\b|\s*[,.;!?]|\s*$)`,
)
const CITY_STATE_RE =
  /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*),\s*([A-Z]{2}|[A-Z][a-z]{3,})\b/
const DISTRICT_RE =
  /\b((?:downtown|uptown|midtown|east|west|north|south)\s+[A-Za-z][A-Za-z .'-]{1,40}?)(?=\s+(?:with|and|that|for|using|plus|then|add|score|classify|rate|over|during|from|within|having|where|keep|only|but)\b|\s*[,.;!?]|\s*$)/i

const PLACE_DENYLIST = new Set([
  'order',
  'total',
  'general',
  'detail',
  'details',
  'bulk',
  'batches',
  'range',
  'parallel',
  'time',
  'csv',
  'json',
  'sql',
  'ai',
  'noaa',
  'mesh',
  'mrms',
  'overture',
  'geojson',
  'wkt',
  'view',
  'hexes',
  'hex',
  'cells',
  'polygon',
  'map',
  'center',
  'map center',
  'the map',
  'here',
])

const PLACE_STOP = new Set([
  'the',
  'of',
  'at',
  'in',
  'on',
  'and',
  'de',
  'del',
  'la',
  'le',
  'united',
  'states',
  'usa',
  'us',
])

const SENTENCE_STARTERS = new Set([
  'find',
  'show',
  'get',
  'list',
  'query',
  'build',
  'look',
  'search',
  'give',
  'please',
  'can',
  'could',
  'coffee',
  'restaurants',
  'hotels',
  'buildings',
  'places',
  'addresses',
])

/** Words that are the ask, not the place, when pulling a leftover neighborhood name. */
const QUERY_STOP = new Set([
  ...PLACE_DENYLIST,
  ...SENTENCE_STARTERS,
  ...PLACE_STOP,
  'shop',
  'shops',
  'store',
  'stores',
  'restaurant',
  'cafe',
  'cafes',
  'hotel',
  'building',
  'place',
  'address',
  'business',
  'businesses',
  'lead',
  'leads',
  'hail',
  'history',
  'weather',
  'storm',
  'storms',
  'score',
  'scoring',
  'rank',
  'ranking',
  'rate',
  'rating',
  'classify',
  'classification',
  'phone',
  'phones',
  'email',
  'emails',
  'socials',
  'open',
  'only',
  'with',
  'without',
  'from',
  'each',
  'every',
  'near',
  'around',
  'within',
  'inside',
  'outside',
  'using',
  'plus',
  'then',
  'high',
  'low',
  'confidence',
  'data',
  'rows',
  'my',
  'selected',
  'selection',
  'neighborhood',
  'neighbourhood',
  'area',
  'district',
  'numbers',
  'number',
])

/** Short names expanded to a Nominatim-searchable string. */
const KNOWN_AREAS: readonly { match: RegExp; place: string }[] = [
  { match: /\b(?:texas\s+)?(?:state\s+)?capitol\b/i, place: 'Texas State Capitol, Austin, TX' },
  { match: /\bzilker(?:\s+park)?\b/i, place: 'Zilker Park, Austin, TX' },
  { match: /\b(?:south congress|soco)\b/i, place: 'South Congress Avenue, Austin, TX' },
  { match: /\beast austin\b/i, place: 'East Austin, Austin, TX' },
  { match: /\bwest campus\b/i, place: 'West Campus, Austin, TX' },
  { match: /\bthe\s+domain\b/i, place: 'The Domain, Austin, TX' },
  { match: /\b(?:6th|sixth)\s+street\b/i, place: '6th Street, Austin, TX' },
  { match: /\brainey\s+street\b/i, place: 'Rainey Street, Austin, TX' },
  { match: /\bbarton springs\b/i, place: 'Barton Springs, Austin, TX' },
  { match: /\bdowntown austin\b/i, place: 'Downtown Austin, TX' },
  { match: /\bwest\s*gate\b/i, place: 'Westgate, Austin, TX' },
  { match: /\b(?:ut campus|university of texas(?: at austin)?)\b/i, place: 'University of Texas at Austin' },
]

export function namesSelection(text: string): boolean {
  return /\b(?:selected|selection|my hexes|these hexes|chosen hexes|my cells|picked hexes|these cells|this hex|this cell)\b/i.test(
    text,
  )
}

export function extractPlace(text: string): string | null {
  const known = matchKnownArea(text)
  if (known) return known
  const cityState = matchCityState(text)
  if (cityState) return cityState
  const fromCaps = cleanPlace(text.match(CAP_PLACE_RE)?.[1])
  if (fromCaps) return fromCaps
  const fromLower = cleanPlace(text.toLowerCase().match(LOWER_PLACE_RE)?.[1])
  if (fromLower) return fromLower
  const district = cleanPlace(text.match(DISTRICT_RE)?.[1])
  if (district) return district
  const leftover = leftoverPlace(text)
  if (leftover) return leftover
  return cleanPlace(matchProperNouns(text))
}

/** True when the resolved place is actually talked about in the prompt. */
export function placeMentionedInPrompt(place: string, prompt: string): boolean {
  const promptTokens = tokenize(prompt)
  const placeTokens = tokenize(place).filter((token) => !PLACE_STOP.has(token) && token.length >= 3)
  if (placeTokens.length === 0) return false
  return placeTokens.some((token) => promptTokens.includes(token))
}

export function pickBetterPlace(model: string | null | undefined, heuristic: string | null | undefined): string | null {
  const left = cleanPlace(model ?? undefined)
  const right = cleanPlace(heuristic ?? undefined)
  if (left && right) {
    if (left.includes(',') && !right.includes(',')) return left
    if (right.includes(',') && !left.includes(',')) return right
    return left.length >= right.length ? left : right
  }
  return left ?? right
}

function matchKnownArea(text: string): string | null {
  for (const area of KNOWN_AREAS) {
    if (area.match.test(text)) return area.place
  }
  return null
}

function matchCityState(text: string): string | null {
  const match = text.match(CITY_STATE_RE)
  if (!match) return null
  const city = match[1]?.trim()
  const state = match[2]?.trim()
  if (!city || !state || SENTENCE_STARTERS.has(city.toLowerCase())) return null
  return `${city}, ${state}`
}

function leftoverPlace(text: string): string | null {
  const tokens = text.split(/[^A-Za-z0-9'-]+/).filter(Boolean)
  let best: string[] = []
  let run: string[] = []
  for (const token of tokens) {
    if (QUERY_STOP.has(token.toLowerCase()) || token.length < 3) {
      if (run.length > best.length) best = run
      run = []
      continue
    }
    run.push(token)
  }
  if (run.length > best.length) best = run
  if (best.length === 0 || best.length > 4) return null
  return cleanPlace(best.join(' '))
}

function matchProperNouns(text: string): string | undefined {
  const match = text.match(/(?:^|[^A-Za-z])((?:[A-Z][A-Za-z0-9'’.&-]+\s+){1,4}[A-Z][A-Za-z0-9'’.&-]+)/)
  if (!match?.[1]) return undefined
  const words = match[1].trim().split(/\s+/)
  if (SENTENCE_STARTERS.has(words[0]?.toLowerCase() ?? '')) return undefined
  return match[1]
}

function cleanPlace(raw: string | undefined): string | null {
  if (!raw) return null
  const place = raw
    .replace(/^the\s+/i, '')
    .replace(/(?:[,\s]+(?:of|de|del|la|le|the|and|on|at|&))+[,\s]*$/i, '')
    .replace(/[,\s]+$/, '')
    .trim()
  if (place.length < 3) return null
  if (/^\d+(?:\.\d+)?$/.test(place) || /^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(place)) return null
  if (PLACE_DENYLIST.has(place.toLowerCase())) return null
  if (/\b(?:days?|weeks?|months?|years?|hexes?|km|miles?)\b/i.test(place)) return null
  return place
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}
