/** Pull a geocodable place name out of an agent prompt. */

const DISTANCE_UNIT = String.raw`(?:km|kilomet(?:er|re)s?|mi|miles?|m|met(?:er|re)s?)`
const CAP_PLACE_RE = new RegExp(
  String.raw`(?:^|[^A-Za-z])(?:[Nn]ear|[Aa]round|[Ii]n|[Aa]t|[Bb]y|[Aa]long|[Oo]n|[Aa]cross|[Oo]ver|[Cc]overing|[Oo]f|[Ww]ithin\s+[\d.]+\s*${DISTANCE_UNIT}\s+of)\s+((?:the\s+)?[A-Z0-9][\w'’.&-]*(?:,?\s+(?:[A-Z0-9][\w'’.&-]*|of|de|del|la|le|the|and|on|at|&))*)`,
)
const LOWER_PLACE_RE = new RegExp(
  String.raw`\b(?:near|around|in|at|by|along|over|covering|within\s+[\d.]+\s*${DISTANCE_UNIT}\s+of)\s+(?!(?:my|the selected|this|these|that|those|view|here|there|the map|the view|the last|the past|last|past|each|every|them|it|a|an)\b)((?:the\s+)?[a-z0-9][a-z0-9'’.&-]*(?:\s+[a-z0-9][a-z0-9'’.&-]*){0,6}?)(?=\s+(?:with|and|that|for|using|plus|then|add|adding|score|scoring|classify|rate|rank|flag|over|during|from|within|having|where|which|who|keep|only|but|including)\b|\s*[,.;!?]|\s*$)`,
)
const STATE_TOKEN = String.raw`(?:TX|CA|FL|NY|Texas|California|Florida|New York)`
const CITY_STATE_RE = new RegExp(
  String.raw`\b([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+)*),?\s+(${STATE_TOKEN})\b`,
  'i',
)
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
  'help',
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
  'help',
  'me',
  'for',
  'along',
  'down',
  'properties',
  'property',
  'commercial',
  'please',
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
  { match: /\bsouth\s+lamar\b/i, place: 'South Lamar Boulevard, Austin, TX' },
  { match: /\bnorth\s+lamar\b/i, place: 'North Lamar Boulevard, Austin, TX' },
  { match: /\b(?:mopac|mo-?pac|loop\s*1)\b/i, place: 'Mopac Expressway, Austin, TX' },
  { match: /\b(?:i-?35|ih-?35|interstate\s*35)\b/i, place: 'Interstate 35, Austin, TX' },
  { match: /\b(?:(?:state\s+)?(?:highway|hwy)\s*71|ben\s+white)\b/i, place: 'Ben White Boulevard, Austin, TX' },
  { match: /\b(?:us-?290|highway\s*290|hwy\s*290)\b/i, place: 'US 290, Austin, TX' },
  { match: /\bloop\s*360\b/i, place: 'Loop 360, Austin, TX' },
  { match: /\b(?:ut campus|university of texas(?: at austin)?)\b/i, place: 'University of Texas at Austin' },
]

/** Highway queries for a corridor, without pinning the road to one city. */
const KNOWN_ROADS: readonly { match: RegExp; road: string }[] = [
  { match: /\bsouth\s+lamar\b/i, road: 'South Lamar Boulevard' },
  { match: /\bnorth\s+lamar\b/i, road: 'North Lamar Boulevard' },
  { match: /\b(?:mopac|mo-?pac|loop\s*1)\b/i, road: 'Mopac Expressway' },
  { match: /\b(?:i-?35|ih-?35|interstate\s*35)\b/i, road: 'Interstate 35' },
  { match: /\b(?:(?:state\s+)?(?:highway|hwy)\s*71|ben\s+white)\b/i, road: 'Ben White Boulevard' },
  { match: /\b(?:us-?290|highway\s*290|hwy\s*290)\b/i, road: 'US 290' },
  { match: /\bloop\s*360\b/i, road: 'Loop 360' },
]

export type PlaceSpan = {
  road: string | null
  from: string
  to: string
  label: string
}

const KNOWN_CITIES: readonly { match: RegExp; name: string; lat: number; lng: number }[] = [
  { match: /\baustin\b/i, name: 'Austin, TX', lat: 30.2672, lng: -97.7431 },
  { match: /\bdallas\b/i, name: 'Dallas, TX', lat: 32.7767, lng: -96.797 },
  { match: /\bhouston\b/i, name: 'Houston, TX', lat: 29.7604, lng: -95.3698 },
  { match: /\bbuda\b/i, name: 'Buda, TX', lat: 30.0852, lng: -97.8403 },
]

export function lookupKnownCity(text: string): { name: string; lat: number; lng: number } | null {
  let best: (typeof KNOWN_CITIES)[number] | null = null
  let bestAt = Number.POSITIVE_INFINITY
  for (const city of KNOWN_CITIES) {
    const hit = text.match(city.match)
    if (!hit || hit.index == null || hit.index >= bestAt) continue
    best = city
    bestAt = hit.index
  }
  return best ? { name: best.name, lat: best.lat, lng: best.lng } : null
}

export function namesSelection(text: string): boolean {
  return /\b(?:selected|selection|my hexes|these hexes|chosen hexes|my cells|picked hexes|these cells|this hex|this cell)\b/i.test(
    text,
  )
}

export function namesCorridor(text: string): boolean {
  return extractCorridor(text) != null || extractSpan(text) != null
}

export function extractPlace(text: string): string | null {
  const span = extractSpan(text)
  if (span) return span.label
  const known = matchKnownArea(text)
  if (known) return qualifyKnownPlace(known, text)
  const neighborhood = matchNeighborhoodCity(text)
  if (neighborhood) return neighborhood
  const corridor = extractCorridor(text)
  if (corridor) return corridor
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

export function pickBetterPlace(
  model: string | null | undefined,
  heuristic: string | null | undefined,
  prompt = '',
): string | null {
  const left = cleanPlace(model ?? undefined)
  const right = cleanPlace(heuristic ?? undefined)
  const named = namedCityInText(prompt)
  if (named && left && right) {
    const city = named.split(',')[0]?.trim().toLowerCase() ?? ''
    const leftHas = city.length >= 3 && left.toLowerCase().includes(city)
    const rightHas = city.length >= 3 && right.toLowerCase().includes(city)
    if (leftHas !== rightHas) return leftHas ? left : right
  }
  if (left && right) {
    if (left.includes(',') && !right.includes(',')) return left
    if (right.includes(',') && !left.includes(',')) return right
    return left.length >= right.length ? left : right
  }
  return left ?? right
}

/** City + state named in a prompt or place string, used to leave the map city. */
export function namedCityInText(text: string): string | null {
  const inCity = text.match(
    new RegExp(
      String.raw`\b(?:in|near|around|at)\s+([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){0,3}?),?\s+(${STATE_TOKEN})\b`,
      'i',
    ),
  )
  if (inCity) {
    const city = cleanPlace(inCity[1])
    const state = inCity[2]?.trim()
    if (city && state && !SENTENCE_STARTERS.has(city.toLowerCase())) return `${city}, ${state}`
  }
  const trailing = text.match(
    new RegExp(
      String.raw`,\s*([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){0,2}?),?\s+(${STATE_TOKEN})\s*$`,
      'i',
    ),
  )
  if (trailing) {
    const city = cleanPlace(trailing[1])
    const state = trailing[2]?.trim()
    if (city && state && !SENTENCE_STARTERS.has(city.toLowerCase())) return `${city}, ${state}`
  }
  return matchCityState(text)
}

/** True when the place names a city that is not the current map locality. */
export function namedCityAwayFromMap(place: string, locality: string | null): string | null {
  const named = namedCityInText(place)
  if (!named) return null
  const city = named.split(',')[0]?.trim().toLowerCase() ?? ''
  if (city.length < 3) return null
  if (locality && locality.toLowerCase().includes(city)) return null
  return named
}

/** A road or area between two named places, e.g. I-35 between Austin and Buda. */
export function extractSpan(text: string): PlaceSpan | null {
  if (/\b(?:score|rate|rank|rated|ranked|confidence|priced?)\s+between\b/i.test(text)) return null
  if (/\bbetween\s+\d/i.test(text)) return null
  const between = text.match(
    /\bbetween\s+(.+?)\s+and\s+(.+?)(?=\s+(?:with|that|for|using|plus|then|add|score|classify)|[.;!?]|$)/i,
  )
  const fromTo =
    between ?? text.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:along|on|with|that|for|using)|[.;!?]|$)/i)
  if (!fromTo) return null
  const from = cleanPlace(fromTo[1])
  const to = cleanPlace(fromTo[2])
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return null
  if (/^\d/.test(from) || /^\d/.test(to)) return null
  const road = matchKnownRoad(text)
  return { road, from, to, label: road ? `${road} between ${from} and ${to}` : `between ${from} and ${to}` }
}

function matchKnownRoad(text: string): string | null {
  for (const item of KNOWN_ROADS) {
    if (item.match.test(text)) return item.road
  }
  return null
}

function qualifyKnownPlace(known: string, text: string): string {
  const named = namedCityInText(text)
  if (!named) return known
  const city = named.split(',')[0]?.trim() ?? ''
  if (city.length >= 3 && known.toLowerCase().includes(city.toLowerCase())) return known
  const road = matchKnownRoad(text)
  return `${road ?? known.split(',')[0]?.trim() ?? known}, ${named}`
}

function extractCorridor(text: string): string | null {
  const match = text.match(
    /\b(?:along|down)\s+(?:the\s+)?(?!with\b|side\b|here\b|there\b)(.+?)(?:\s+(?:in|near)\s+(.+?))?(?=\s+(?:with|and|that|for|using|plus)|[,.;!?]|$)/i,
  )
  const road = cleanPlace(match?.[1])
  if (!road) return null
  const city = cleanPlace(match?.[2])
  return city ? `${road}, ${city}` : road
}

function matchNeighborhoodCity(text: string): string | null {
  const match = text.match(
    /\b(?:the\s+)?([A-Za-z][A-Za-z0-9'-]{2,40}(?:\s+[A-Za-z][A-Za-z0-9'-]+){0,3}?)\s+(?:neighborhood|neighbourhood|district)\s+(?:in|of)\s+([A-Za-z][A-Za-z0-9,.' -]{2,40}?)(?=\s+(?:with|and|that|for|using)|[,.;!?]|$)/i,
  )
  if (!match) return null
  const hood = cleanPlace(match[1])
  const city = cleanPlace(match[2])
  if (!hood) return null
  return city ? `${hood}, ${city}` : hood
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
