from __future__ import annotations

import argparse
import subprocess
import time
import traceback
from datetime import datetime

from . import config, tasks, recipes
from .sampling import run_sampling


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    run = tasks.get_run(args.run_id)

    for _ in range(100):
        if tasks.get_run(run.id).status == "running":
            break
        time.sleep(0.02)

    process = subprocess.Popen(
        run.command,
        cwd=str(config.DIFFSYNTH_STUDIO_ROOT),
    )
    returncode = process.wait()
    if returncode != 0:
        tasks.update_run(
            run.id,
            status="failed",
            returncode=returncode,
            finished_at=_now(),
        )
        return returncode

    samples = run.config.get("samples") or []
    sample_total = sum(
        1 for sample in samples
        if isinstance(sample, dict) and str(sample.get("prompt") or "").strip()
    )
    recipe = recipes.get_recipe(str(run.config.get("model_type") or ""))
    sampling_available = bool(recipe.sampling.get("pipeline"))
    if not sampling_available:
        sample_total = 0
    if not sample_total:
        tasks.update_run(
            run.id,
            status="finished",
            returncode=0,
            sampling_status="skipped",
            sampling_current=0,
            sampling_total=0,
            sampling_message=(
                "No sampling requests configured."
                if sampling_available
                else "Sampling is not available for this model."
            ),
            finished_at=_now(),
        )
        return 0
    tasks.update_run(
        run.id,
        status="sampling",
        returncode=0,
        sampling_status="queued",
        sampling_current=0,
        sampling_total=sample_total,
    )
    try:
        run_sampling(run.id)
    except Exception as exc:
        print("\n===== Sampling worker error =====", flush=True)
        traceback.print_exc()
        tasks.update_run(
            run.id,
            sampling_status="failed",
            sampling_message=f"Sampling process error: {exc}",
            sampling_finished_at=_now(),
        )
    tasks.update_run(run.id, status="finished", returncode=0, finished_at=_now())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
