import argparse
import json
from dataclasses import dataclass
from typing import Dict, List, Optional

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

HARD_MAX_HEXES = 20
HARD_MAX_BBOX_AREA_KM2 = 220.0
HARD_MAX_ROWS_PER_DATASET = 1_000_000
HARD_MAX_TOTAL_ROWS = 2_000_000
DATASETS = {"places", "addresses", "buildings"}


@dataclass
class Plan:
    release_version: str
    run_id: str
    h3_cells: List[str]
    datasets: List[str]
    bbox: Dict[str, float]
    max_rows_by_dataset: Dict[str, int]
    max_total_rows: int
    input_prefix: str
    output_prefix: str
    metrics_prefix: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run segmented workflow ingestion for selected H3 cells."
    )
    parser.add_argument("--plan", required=True, help="Path to the ingestion plan JSON.")
    parser.add_argument(
        "--input-prefix",
        help="Override plan input_prefix. Expects release and dataset folders under this path.",
    )
    parser.add_argument(
        "--output-prefix",
        help="Override plan output_prefix. Dataset outputs are written under runs/<run_id>/.",
    )
    parser.add_argument(
        "--metrics-prefix",
        help="Override plan metrics_prefix. Hex metrics are written under runs/<run_id>/hex_metrics.",
    )
    parser.add_argument("--app-name", default="readyhex-workflow-ingest")
    return parser.parse_args()


def load_plan(path: str) -> Plan:
    with open(path, "r", encoding="utf-8") as handle:
        raw = json.load(handle)

    required = [
        "release_version",
        "run_id",
        "h3_cells",
        "datasets",
        "bbox",
        "max_rows_by_dataset",
        "max_total_rows",
        "input_prefix",
        "output_prefix",
        "metrics_prefix",
    ]
    for key in required:
        if key not in raw:
            raise ValueError(f"plan is missing key: {key}")

    h3_cells = list(dict.fromkeys(raw["h3_cells"]))
    if not h3_cells:
        raise ValueError("plan has no h3_cells")
    if len(h3_cells) > HARD_MAX_HEXES:
        raise ValueError(f"plan exceeds hard cell cap ({HARD_MAX_HEXES})")

    datasets = list(dict.fromkeys(raw["datasets"]))
    if not datasets:
        raise ValueError("plan has no datasets")
    if not set(datasets).issubset(DATASETS):
        raise ValueError(f"plan datasets must be in {sorted(DATASETS)}")

    bbox = raw["bbox"]
    if not isinstance(bbox, dict):
        raise ValueError("bbox must be an object")
    area_km2 = float(bbox.get("area_km2", 0))
    if area_km2 <= 0 or area_km2 > HARD_MAX_BBOX_AREA_KM2:
        raise ValueError(f"bbox area must be >0 and <= {HARD_MAX_BBOX_AREA_KM2} km2")

    max_rows_by_dataset = {
        dataset: min(int(raw["max_rows_by_dataset"][dataset]), HARD_MAX_ROWS_PER_DATASET)
        for dataset in datasets
    }
    max_total_rows = min(int(raw["max_total_rows"]), HARD_MAX_TOTAL_ROWS)
    if max_total_rows <= 0:
        raise ValueError("max_total_rows must be positive")

    return Plan(
        release_version=str(raw["release_version"]),
        run_id=str(raw["run_id"]),
        h3_cells=h3_cells,
        datasets=datasets,
        bbox=bbox,
        max_rows_by_dataset=max_rows_by_dataset,
        max_total_rows=max_total_rows,
        input_prefix=clean_prefix(str(raw["input_prefix"])),
        output_prefix=clean_prefix(str(raw["output_prefix"])),
        metrics_prefix=clean_prefix(str(raw["metrics_prefix"])),
    )


def clean_prefix(value: str) -> str:
    return value.rstrip("/")


def apply_bbox_filter(frame: DataFrame, bbox: Dict[str, float]) -> DataFrame:
    west = float(bbox["west"])
    south = float(bbox["south"])
    east = float(bbox["east"])
    north = float(bbox["north"])

    columns = set(frame.columns)
    if {"lng", "lat"}.issubset(columns):
        return frame.where(
            (F.col("lng") >= west)
            & (F.col("lng") <= east)
            & (F.col("lat") >= south)
            & (F.col("lat") <= north)
        )
    if {"longitude", "latitude"}.issubset(columns):
        return frame.where(
            (F.col("longitude") >= west)
            & (F.col("longitude") <= east)
            & (F.col("latitude") >= south)
            & (F.col("latitude") <= north)
        )
    return frame


def merge_metrics(base: Optional[DataFrame], dataset_metrics: DataFrame) -> DataFrame:
    if base is None:
        return dataset_metrics
    return base.join(dataset_metrics, "h3_res8", "outer")


def main() -> None:
    args = parse_args()
    plan = load_plan(args.plan)

    input_prefix = clean_prefix(args.input_prefix) if args.input_prefix else plan.input_prefix
    output_prefix = clean_prefix(args.output_prefix) if args.output_prefix else plan.output_prefix
    metrics_prefix = clean_prefix(args.metrics_prefix) if args.metrics_prefix else plan.metrics_prefix

    spark = SparkSession.builder.appName(args.app_name).getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    total_rows = 0
    metrics_frame: Optional[DataFrame] = None
    counts_by_dataset: Dict[str, int] = {}

    for dataset in plan.datasets:
        source_path = f"{input_prefix}/{plan.release_version}/{dataset}"
        target_path = f"{output_prefix}/runs/{plan.run_id}/{dataset}"
        frame = spark.read.parquet(source_path)

        if "h3_res8" not in frame.columns:
            raise RuntimeError(
                f"{dataset} input is missing h3_res8. Build a silver layer with h3_res8 first."
            )

        filtered = apply_bbox_filter(frame, plan.bbox).where(F.col("h3_res8").isin(plan.h3_cells))
        rows = filtered.count()
        counts_by_dataset[dataset] = rows

        dataset_limit = plan.max_rows_by_dataset[dataset]
        if rows > dataset_limit:
            raise RuntimeError(
                f"{dataset} produced {rows} rows, over cap {dataset_limit}. Narrow the hex set."
            )

        total_rows += rows
        if total_rows > plan.max_total_rows:
            raise RuntimeError(
                f"combined rows {total_rows} exceeded total cap {plan.max_total_rows}. Narrow the selection."
            )

        filtered.write.mode("overwrite").partitionBy("h3_res8").parquet(target_path)

        dataset_metrics = filtered.groupBy("h3_res8").agg(
            F.count(F.lit(1)).alias(f"{dataset}_count")
        )
        metrics_frame = merge_metrics(metrics_frame, dataset_metrics)

    base_hexes = spark.createDataFrame([(cell,) for cell in plan.h3_cells], ["h3_res8"])
    if metrics_frame is None:
        metrics_frame = base_hexes
    else:
        metrics_frame = base_hexes.join(metrics_frame, "h3_res8", "left")

    for column in ("places_count", "addresses_count", "buildings_count"):
        if column not in metrics_frame.columns:
            metrics_frame = metrics_frame.withColumn(column, F.lit(0).cast("bigint"))
        else:
            metrics_frame = metrics_frame.withColumn(
                column, F.coalesce(F.col(column), F.lit(0)).cast("bigint")
            )

    metrics_path = f"{metrics_prefix}/runs/{plan.run_id}/hex_metrics"
    metrics_frame.write.mode("overwrite").parquet(metrics_path)

    print(
        json.dumps(
            {
                "run_id": plan.run_id,
                "release_version": plan.release_version,
                "datasets": plan.datasets,
                "rows_by_dataset": counts_by_dataset,
                "rows_total": total_rows,
                "output_prefix": output_prefix,
                "metrics_path": metrics_path,
            }
        )
    )
    spark.stop()


if __name__ == "__main__":
    main()
