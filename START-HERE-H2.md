# SeaGuard — H2 demo quick start

Open this folder as a Maven project in IntelliJ IDEA (Java 21), and run `SeaGuardApplication`.

The default Spring profile is `h2`: no MySQL server is needed. On every clean start,
36 explicitly SYNTHETIC DEMO measurements are automatically saved in the in-memory H2 database.

- Dashboard: http://localhost:8080/dashboard
- Measurements JSON: http://localhost:8080/api/measurements
- Only synthetic: http://localhost:8080/api/measurements?kind=demo
- H2 Console: http://localhost:8080/h2-console
- JDBC URL: jdbc:h2:mem:seaguard (user: sa, blank password)

The demo readings are NOT actual field measurements. A simulated anomaly is present in the latest Sozopol sample.

To use MySQL instead, explicitly start with `--spring.profiles.active=mysql` and configure credentials.
To switch back to H2 - `--spring.profiles.active=h2`
If IntelliJ has an existing Active profiles or Program arguments setting for `mysql`, remove it.
