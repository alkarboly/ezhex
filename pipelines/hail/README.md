# Hail MESH extract

NOAA MRMS `MESH_Max_1440min` (24h max estimated hail size, mm). Public S3, anonymous.

`s3://noaa-mrms-pds/CONUS/MESH_Max_1440min_00.50/YYYYMMDD/MRMS_MESH_Max_1440min_00.50_YYYYMMDD-HHMMSS.grib2.gz`

Use only the `120000` (12Z) file per day. Never sum overlapping files. Data from 2020-11-01. Lon is 0-360; convert to -180..180.

```bash
aws s3 ls s3://noaa-mrms-pds/CONUS/MESH_Max_1440min_00.50/ --no-sign-request
python pipelines/hail/extract_mesh.py --job job.json --out out.json
```

The Node workflow runner writes a temp job JSON (hex bboxes + days), runs this script, keeps only `h3` / `day` / `mesh_mm_max`, and deletes the GRIB. Full grids are not stored in Supabase.

Install dependencies before running locally or on Render:

```bash
pip install -r pipelines/hail/requirements.txt
```

`POST /api/enrichments/hail` and a workflow `hail_history` step both run this script. They do not substitute synthetic MESH when the install is missing.
