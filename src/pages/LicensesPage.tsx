import { Link } from 'react-router-dom'
import { SATELLITE_ATTRIBUTION } from '../components/map/map-style'
import { DATA_ATTRIBUTION_TEXT } from '../lib/licenses'

export function LicensesPage() {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
        <header>
          <h1 className="text-xl font-semibold">Licenses</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            WorldPulse displays and stores public map data. This page is the attribution and license notice for that
            data.
          </p>
        </header>

        <section className="rounded-lg border border-border bg-card p-4 text-sm leading-6">
          <h2 className="text-base font-semibold">Map credit</h2>
          <p className="mt-2 text-muted-foreground">{DATA_ATTRIBUTION_TEXT}</p>
          <p className="mt-2 text-muted-foreground">
            The same line appears on the explorer map. Streets tiles come from OpenFreeMap. Satellite tiles come from
            Esri. Feature rows come from the public Overture Maps release.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 text-sm leading-6">
          <h2 className="text-base font-semibold">Overture Maps</h2>
          <p className="mt-2 text-muted-foreground">
            Places, buildings, and addresses are downloaded from the public Overture Maps release and stored by hex in
            Supabase. Citation: Overture Maps Foundation,{' '}
            <a className="text-primary underline-offset-2 hover:underline" href="https://overturemaps.org">
              overturemaps.org
            </a>
            . Per-theme terms:{' '}
            <a
              className="text-primary underline-offset-2 hover:underline"
              href="https://docs.overturemaps.org/attribution/"
            >
              Overture attribution
            </a>
            .
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>
              <span className="text-foreground">Places</span> — CDLA Permissive 2.0, except Foursquare rows (Apache
              2.0). No OpenStreetMap share-alike on this theme.
            </li>
            <li>
              <span className="text-foreground">Buildings</span> — Open Database License (ODbL). Includes OpenStreetMap,
              Microsoft building footprints, and other sources. Published building extracts stay under ODbL.
            </li>
            <li>
              <span className="text-foreground">Addresses</span> — mixed open licenses. US coverage, including Texas,
              comes from the National Address Database. NAD is a US government work and is not for use as a mailing
              list. See the{' '}
              <a
                className="text-primary underline-offset-2 hover:underline"
                href="https://www.transportation.gov/mission/open/gis/national-address-database/national-address-database-nad-disclaimer"
              >
                NAD disclaimer
              </a>
              .
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 text-sm leading-6">
          <h2 className="text-base font-semibold">Foursquare places</h2>
          <p className="mt-2 text-muted-foreground">
            Copyright 2024 Foursquare Labs, Inc. All rights reserved. Licensed under{' '}
            <a
              className="text-primary underline-offset-2 hover:underline"
              href="https://www.apache.org/licenses/LICENSE-2.0"
            >
              Apache License 2.0
            </a>
            . Overture transformed those rows to its schema. A copy of Apache 2.0 is linked here with this dataset.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 text-sm leading-6">
          <h2 className="text-base font-semibold">OpenStreetMap and OpenFreeMap</h2>
          <p className="mt-2 text-muted-foreground">
            Street tiles and Overture buildings that derive from OpenStreetMap are available under the{' '}
            <a
              className="text-primary underline-offset-2 hover:underline"
              href="https://www.openstreetmap.org/copyright"
            >
              Open Database License
            </a>
            . © OpenStreetMap contributors. OpenFreeMap / OpenMapTiles render those tiles.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 text-sm leading-6">
          <h2 className="text-base font-semibold">Esri imagery</h2>
          <p className="mt-2 text-muted-foreground">{SATELLITE_ATTRIBUTION}.</p>
          <p className="mt-2 text-muted-foreground">
            The satellite basemap uses Esri World Imagery. Those tiles are not an open database. A public production
            deployment should use an ArcGIS Location Platform key rather than the unauthenticated demo endpoint.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 text-sm leading-6">
          <h2 className="text-base font-semibold">Community Data License Agreement — Permissive 2.0</h2>
          <p className="mt-2 text-muted-foreground">
            CDLA Permissive 2.0 covers most Overture places rows. The full text is required when those rows are shared.
          </p>
          <pre className="mt-3 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-muted-foreground">
            {CDLA_PERMISSIVE_2}
          </pre>
        </section>

        <p className="text-sm text-muted-foreground">
          H3 cell shapes are computed with h3-js. They are not licensed map data.{' '}
          <Link to="/datasets" className="text-primary underline-offset-2 hover:underline">
            Datasets
          </Link>{' '}
          lists stored Overture snapshots.
        </p>
      </div>
    </div>
  )
}

const CDLA_PERMISSIVE_2 = `Community Data License Agreement – Permissive, Version 2.0

1. Provision of the Data
1.1. A Data Recipient may use, modify, and share the Data made available by Data Provider(s) under this agreement if that Data Recipient follows the terms of this agreement.
1.2. This agreement does not impose any restriction on a Data Recipient's use, modification, or sharing of any portions of the Data that are in the public domain or that may be used, modified, or shared under any other legal exception or limitation.

2. Conditions for Sharing Data
2.1. A Data Recipient may share Data, with or without modifications, so long as the Data Recipient makes available the text of this agreement with the shared Data.

3. No Restrictions on Results
3.1. This agreement does not impose any restriction or obligations with respect to the use, modification, or sharing of Results.

4. No Warranty; Limitation of Liability
THE DATA IS PROVIDED ON AN "AS IS" BASIS, WITHOUT REPRESENTATIONS, WARRANTIES OR CONDITIONS OF ANY KIND. NO DATA PROVIDER SHALL HAVE ANY LIABILITY FOR ANY DAMAGES ARISING IN ANY WAY OUT OF THE DATA OR RESULTS.

5. Definitions
"Data" means the material received by a Data Recipient under this agreement.
"Results" means any outcome obtained by computational analysis of Data, including for example machine learning models and models' output.

Full text: https://cdla.dev/permissive-2.0/`
