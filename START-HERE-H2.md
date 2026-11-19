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

Open **Морски ливади**, select **Gradina** or another [SEANOE archive site](https://doi.org/10.17882/79590), and click **Направи екологично разследване**. The report lists the historical evidence, looks for manually entered measurements within 2 km of the center of the polygon's bounding box, and suggests a field check. H2's seeded synthetic records are excluded from this search. Entered readings and historical habitat boundaries cannot establish current seagrass health on their own.

The 35 archived polygons are bundled locally as a format conversion from the original WGS 84 Shapefile. Geometry and source attributes are preserved. The map uses Leaflet and OpenStreetMap over the internet, and the site picker and report can run without them.

Map data by Berov, Vasilev, Hiebaum, Biserkov, Deyanova, Klayn, Dimov, Vrabcheva, and Karamfilov (2022), published via [SEANOE](https://doi.org/10.17882/79590) under [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). See the [data paper](https://doi.org/10.3897/BDJ.10.e78942) for survey methods. The survey period in the paper is 2010–2020. Each site displays the satellite image date from the file.

The next integration milestone is to sample the [Copernicus Marine coastal ocean-color product](https://data.marine.copernicus.eu/product/OCEANCOLOUR_BLK_BGC_HR_L4_NRT_009_212/description) near selected polygons, retaining the observation date, resolution, units, and quality flags. Underwater imagery and an AI-assisted report can then use this evidence and field observations.
