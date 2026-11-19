# SeaGuard — H2 demo quick start

Open this folder as a Maven project in IntelliJ IDEA (Java 21), and run `SeaGuardApplication`.
From a terminal with Java 21 and Maven, run `mvn spring-boot:run`.

The default Spring profile is `h2`: no MySQL server is needed. On every clean start,
36 explicitly SYNTHETIC DEMO measurements are automatically saved in the in-memory H2 database.

- Seagrass map and investigation: http://localhost:8080/seagrass
- Dashboard: http://localhost:8080/dashboard
- Measurements JSON: http://localhost:8080/api/measurements
- Only synthetic: http://localhost:8080/api/measurements?kind=demo
- H2 Console: http://localhost:8080/h2-console
- JDBC URL: jdbc:h2:mem:seaguard (user: sa, blank password)

The demo readings are NOT actual field measurements. A simulated anomaly is present in the latest Sozopol sample.

To use MySQL instead, explicitly start with `--spring.profiles.active=mysql` and configure credentials.
To switch back to H2 - `--spring.profiles.active=h2`
If IntelliJ has an existing Active profiles or Program arguments setting for `mysql`, remove it.

## Hackathon demo

Open **Морски атлас**, select **Равда, юг 1** or another archival site, and click **Разследвай**. The report combines historical evidence, monthly satellite context, and manually entered measurements within 2 km of the center of the polygon's bounding box. H2's seeded synthetic records are excluded. Assessing current seagrass health requires fresh field evidence.

The 35 archived polygons are bundled locally as a format conversion from the original WGS 84 Shapefile. Geometry and source attributes are preserved. The map uses Leaflet and OpenStreetMap over the internet, and the site picker and report can run without them.

Map data by Berov, Vasilev, Hiebaum, Biserkov, Deyanova, Klayn, Dimov, Vrabcheva, and Karamfilov (2022), published via [SEANOE](https://doi.org/10.17882/79590) under [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). See the [data paper](https://doi.org/10.3897/BDJ.10.e78942) for survey methods. The survey period in the paper is 2010–2020. Each site displays the satellite image date from the file.

### Satellite data

The bundled snapshot from the [Copernicus Marine coastal ocean-color product](https://doi.org/10.48670/moi-00087) covers May–October 2026. For each site and month, it takes the nearest valid 100 m cell within 750 m of the center of the polygon's bounds. The app shows monthly mean surface turbidity (FNU), chlorophyll-a (mg/m³), the cell distance, and the number of daily observations contributing to each mean. A different pixel can be selected each month. The archived source, dataset version, pixel coordinates, and retrieval date are in `copernicus-coast.json`.

To refresh the snapshot, install `numpy` and `numcodecs` in a Python virtual environment, then run `python scripts/refresh_copernicus.py` and restart the application. The script uses the public Copernicus STAC catalog and Zarr assets.

### Local image and video analysis

With a recent [llama.cpp](https://github.com/ggml-org/llama.cpp) installed, run `sh scripts/serve_local_ai.sh` in a separate terminal. The first launch downloads the approximately 1.5 GB Qwen3-VL weights. When the model is listening on port 18121, click **Пробвай с кадър от Равда**, or choose a JPG, PNG, WebP, MP4, or WebM file up to 100 MB. A video is sampled at up to three positions in the browser. Only those JPEG frames are sent to the local Spring app and inference process, and no uploads are saved.

The model screens for visible vegetation forms, bottom type, and visibility. Its output is an aid for field review. The demonstration image is an archival view near Ravda, with no verified link to a specific polygon. Photo from Berov, Klayn, Deyanova and Karamfilov (2022), [figure 4](https://doi.org/10.3897/BDJ.10.e78942.figure4), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), resized and recompressed. Inter is bundled under the SIL Open Font License.
