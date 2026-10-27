# Spark workflow ingestion

This folder contains the first segmented-ingestion Spark job for workflow runs.

## Input contract

The job expects a JSON plan from `POST /api/workflow-ingestion/plan`. The same plan is stored on jobs created by `POST /api/workflow-ingestion/jobs`. The Node process does not run this script.

Hard caps in both API and Spark job:

- max 20 selected hexes
- max bbox area 220 km2
- max rows per dataset 1,000,000
- max rows total 2,000,000

The Spark job expects a silver layer shaped like:

`<input_prefix>/<release_version>/<dataset>`

Each dataset must include `h3_res8`.

If `lat`/`lng` or `latitude`/`longitude` exist, the job also applies bbox prefiltering before the hex filter.

## Run

```bash
pip install -r pipelines/spark/requirements.txt
python pipelines/spark/workflow_ingest.py --plan /path/to/plan.json
```

Optional overrides:

```bash
python pipelines/spark/workflow_ingest.py \
  --plan /tmp/plan.json \
  --input-prefix s3://worldpulse/overture-silver \
  --output-prefix s3://worldpulse/workflows \
  --metrics-prefix s3://worldpulse/workflow-metrics
```

## Output layout

Dataset rows:

`<output_prefix>/runs/<run_id>/<dataset>/h3_res8=<hex>/...`

Hex metrics:

`<metrics_prefix>/runs/<run_id>/hex_metrics/...`
