# SeaGuard — quick start

Open this folder as a Maven project in IntelliJ IDEA (Java 21), and run `SeaGuardApplication`.
From a terminal with Java 21 and Maven, run `mvn spring-boot:run`.

The default Spring profile is `h2`: no MySQL server is needed. The in-memory database starts empty
and stores the team’s field measurements and tasks for the current session.

- **Преглед** at http://localhost:8080/dashboard shows coastal risk, monthly water conditions, and today's offshore marine models. The root route opens this page.
- **Участък** at http://localhost:8080/ecologist opens the AI ecologist. Add `?site=16` to open **Равда, юг 1** directly.
- **Теренна работа** at http://localhost:8080/field groups field tasks and lists measurements with search and CSV export.
- **Ново измерване** at http://localhost:8080/measurements/new opens the field measurement form.
- Measurements JSON: http://localhost:8080/api/measurements
- H2 Console: http://localhost:8080/h2-console
- JDBC URL: jdbc:h2:mem:seaguard (user: sa, blank password)


To use MySQL instead, explicitly start with `--spring.profiles.active=mysql` and configure credentials.
To switch back to H2 - `--spring.profiles.active=h2`
If IntelliJ has an existing Active profiles or Program arguments setting for `mysql`, remove it.

## Meadow maps

**Преглед** shows the whole coast. **Участък** shows the selected meadow's polygon and combines archive evidence, monthly satellite data, and field measurements within 2 km of the center of the polygon's bounding box. Assessing current seagrass health requires fresh field evidence.

The 35 archived polygons are bundled locally as a format conversion from the original WGS 84 Shapefile. Geometry and source attributes are preserved. Leaflet offers satellite imagery from Esri and street tiles from OpenStreetMap. Map imagery requires an internet connection.

Map data by Berov, Vasilev, Hiebaum, Biserkov, Deyanova, Klayn, Dimov, Vrabcheva, and Karamfilov (2022), published via [SEANOE](https://doi.org/10.17882/79590) under [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). The [data paper](https://doi.org/10.3897/BDJ.10.e78942) describes the 2010–2020 survey and its methods.

### Satellite data

The bundled snapshot from the [Copernicus Marine coastal ocean-color product](https://doi.org/10.48670/moi-00087) covers May–October 2026. For each site and month, it takes the nearest valid 100 m cell within 750 m of the center of the polygon's bounds. The overview heatmap shows monthly surface turbidity (FNU), chlorophyll-a (mg/m³), and estimated light at the meadow’s depth limit (5 m where the archive has no depth). The ecologist includes the cell distance and contributing observations in its evidence. A different pixel can be selected each month. The archived source, dataset version, pixel coordinates, and retrieval date are in `copernicus-coast.json`.

To refresh the snapshot, install `numpy` and `numcodecs` in a Python virtual environment, then run `python scripts/refresh_copernicus.py` and restart the application. The script uses the public Copernicus STAC catalog and Zarr assets.

### Local image and video analysis

With a recent [llama.cpp](https://github.com/ggml-org/llama.cpp) installed, run `sh scripts/serve_local_ai.sh` in a separate terminal. The first launch downloads the approximately 1.5 GB Qwen3-VL weights. When the model is listening on port 18121, open **Участък**, choose a meadow, and upload a JPG, PNG, WebP, MP4, or WebM file up to 100 MB. A video is sampled at up to three positions in the browser. Only those JPEG frames are sent to the local Spring app and inference process, and no uploads are saved.

The model screens for visible vegetation forms, bottom type, and visibility. Its output is an aid for field review. Inter is bundled under the SIL Open Font License.

## AI еколог (`/ecologist`)

For each of the 35 archive sites, the ecologist joins the SEANOE outline, Copernicus 100 m turbidity and chlorophyll-a, Open-Meteo sea temperature for the last 92 days (one request for all sites, cached for an hour), distance to the nearest harbour, and field measurements within 2 km. It returns a risk score, a confidence level, the probable causes, an ordered action plan, data gaps and evidence. The screening thresholds are in `EcologistKnowledge.java`, each with its literature source, so a marine biologist can tune them.

- Without a key, a rules engine writes the report and the answers, with no network needed.
- With `GEMINI_API_KEY` set (free key from https://aistudio.google.com/apikey), Gemini (`gemini-3.5-flash` with `gemini-3.5-flash-lite` as fallback, configurable with `seaguard.ai.gemini-model`) writes the report and answers.
- With `ANTHROPIC_API_KEY` set in the environment, Claude (`claude-opus-5-5`, configurable with `seaguard.ai.model`) writes the report and answers free questions. It works only from the computed assessment and does not invent measurements.

API endpoints include `GET /api/ecologist/water`, `GET /api/ecologist/sites`, `GET /api/ecologist/assessment/{id}`, `POST /api/ecologist/report/{id}`, `POST /api/ecologist/ask`.
