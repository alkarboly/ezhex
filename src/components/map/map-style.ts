import type { StyleSpecification } from 'maplibre-gl'

export const STREETS_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'

export const SATELLITE_ATTRIBUTION =
  'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'

export function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Satellite',
    sources: {
      imagery: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: SATELLITE_ATTRIBUTION,
      },
    },
    layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
  }
}

export function styleForBasemap(basemap: 'streets' | 'satellite'): string | StyleSpecification {
  return basemap === 'satellite' ? satelliteStyle() : STREETS_STYLE_URL
}
