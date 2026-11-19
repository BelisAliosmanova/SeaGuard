"""Refresh the local SeaGuard snapshot from Copernicus Marine's public STAC/Zarr.

Run with Python 3.10+ and numpy, numcodecs installed. No account is needed.
"""

import argparse
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen
from urllib.parse import urljoin

import numpy as np
from numcodecs import get_codec

DATA = Path(__file__).resolve().parents[1] / "src/main/resources/static/data"
PRODUCT = "OCEANCOLOUR_BLK_BGC_HR_L4_NRT_009_212"
STAC = f"https://stac.marine.copernicus.eu/metadata/{PRODUCT}/product.stac.json"
DATASET_TITLE = "Turbidity, suspended matter, chlorophyll, mosaic, monthly"
SOURCE = "https://doi.org/10.48670/moi-00087"
RADIUS_KM = 0.75
VARIABLES = ("TUR", "CHL", "TUR_count", "CHL_count")


def read(url):
    with urlopen(url, timeout=30) as response:
        return response.read()


class Archive:
    def __init__(self, base):
        self.base = base
        self.metadata = json.loads(read(f"{base}/.zmetadata"))["metadata"]

    def array(self, name):
        return self.metadata[f"{name}/.zarray"]

    @lru_cache(maxsize=72)
    def chunk(self, name, *index):
        schema = self.array(name)
        path = ".".join(map(str, index))
        try:
            encoded = read(f"{self.base}/{name}/{path}")
        except HTTPError as error:
            if error.code == 404 and name in VARIABLES:
                return None
            raise
        raw = get_codec(schema["compressor"]).decode(encoded)
        return np.frombuffer(raw, dtype=schema["dtype"]).reshape(schema["chunks"], order=schema["order"])

    def axis(self, name):
        length, = self.array(name)["shape"]
        step, = self.array(name)["chunks"]
        return np.concatenate([self.chunk(name, i) for i in range((length + step - 1) // step)])[:length]

    def grid_value(self, name, time, latitude, longitude):
        time_step, y_step, x_step = self.array(name)["chunks"]
        block = self.chunk(name, time // time_step, latitude // y_step, longitude // x_step)
        if block is None:
            return float("nan")
        return block[time % time_step, latitude % y_step, longitude % x_step].item()


def bounding_center(feature):
    geometry = feature["geometry"]
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    points = np.array([point for polygon in polygons for ring in polygon for point in ring])
    longitude, latitude = (points.min(axis=0) + points.max(axis=0)) / 2
    return latitude, longitude


def neighbors(latitudes, longitudes, center):
    latitude, longitude = center
    phi = np.radians(latitude)
    row = np.flatnonzero(np.abs(latitudes - latitude) <= RADIUS_KM / 110)
    column = np.flatnonzero(np.abs(longitudes - longitude) <= RADIUS_KM / (110 * np.cos(phi)))
    candidates = []
    for y in row:
        for x in column:
            y_diff = np.radians(latitudes[y] - latitude)
            x_diff = np.radians(longitudes[x] - longitude)
            chord = np.sin(y_diff / 2) ** 2 + np.cos(phi) * np.cos(np.radians(latitudes[y])) * np.sin(x_diff / 2) ** 2
            distance = 6371 * 2 * np.arcsin(np.sqrt(chord))
            if distance <= RADIUS_KM:
                candidates.append((distance, int(y), int(x)))
    return sorted(candidates)


def sample(grid, time, period, candidates, latitudes, longitudes):
    for distance, y, x in candidates:
        turbidity, chlorophyll, turbidity_count, chlorophyll_count = (
            grid.grid_value(name, time, y, x) for name in VARIABLES
        )
        if turbidity_count > 0 and chlorophyll_count > 0 and np.isfinite(turbidity) and np.isfinite(chlorophyll):
            return {
                "month": period,
                "latitude": round(float(latitudes[y]), 6),
                "longitude": round(float(longitudes[x]), 6),
                "distanceM": round(distance * 1000),
                "turbidity": turbidity,
                "chlorophyll": chlorophyll,
                "turbidityCount": turbidity_count,
                "chlorophyllCount": chlorophyll_count,
            }
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--months", type=int, default=6, choices=range(1, 13))
    args = parser.parse_args()
    product = json.loads(read(STAC))
    dataset_href = next(link["href"] for link in product["links"] if link.get("title") == DATASET_TITLE)
    dataset = json.loads(read(urljoin(STAC, dataset_href)))
    grid = Archive(dataset["assets"]["timeChunked"]["href"])
    latitudes, longitudes, times = (grid.axis(axis) for axis in ("latitude", "longitude", "time"))
    time_units = grid.metadata["time/.zattrs"]["units"]
    if not time_units.startswith("seconds since "):
        raise ValueError(f"Unsupported time units: {time_units}")
    origin = datetime.fromisoformat(time_units.removeprefix("seconds since ")).replace(tzinfo=timezone.utc)
    ordered = sorted(range(len(times)), key=times.__getitem__, reverse=True)[:args.months]
    periods = [(i, (origin + timedelta(seconds=float(times[i]))).strftime("%Y-%m")) for i in ordered]
    features = json.loads((DATA / "zostera-bulgaria.geojson").read_text())["features"]
    areas = {}
    for feature in features:
        candidates = neighbors(latitudes, longitudes, bounding_center(feature))
        areas[str(feature["id"])] = [
            observation for i, period in periods
            if (observation := sample(grid, i, period, candidates, latitudes, longitudes)) is not None
        ]
    snapshot = {
        "source": SOURCE,
        "dataset": dataset["id"],
        "resolutionM": 100,
        "radiusM": round(RADIUS_KM * 1000),
        "firstMonth": periods[-1][1],
        "lastMonth": periods[0][1],
        "retrievedOn": datetime.now(timezone.utc).date().isoformat(),
        "sites": areas,
    }
    target = DATA / "copernicus-coast.json"
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(snapshot, indent=2, allow_nan=False) + "\n")
    temporary.replace(target)
    print(f"Copernicus {snapshot['firstMonth']} through {snapshot['lastMonth']}: "
          f"{sum(bool(rows) for rows in areas.values())}/{len(areas)} sites have data")


if __name__ == "__main__":
    main()
