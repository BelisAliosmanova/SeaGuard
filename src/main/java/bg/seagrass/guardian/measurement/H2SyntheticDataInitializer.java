package bg.seagrass.guardian.measurement;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/** Loads explicitly synthetic example measurements only when the h2 profile is active. */
@Component
@Profile("h2")
public class H2SyntheticDataInitializer implements ApplicationRunner {
    private final MeasurementRepository repository;

    public H2SyntheticDataInitializer(MeasurementRepository repository) {
        this.repository = repository;
    }

    @Override
    public void run(ApplicationArguments args) {
        // Do not duplicate data if H2 is configured as a persistent database.
        if (repository.findAll().stream().anyMatch(Measurement::isDemo)) {
            return;
        }

        String[] places = {"Созополски залив", "Бургаски залив", "Крайбрежие Варна"};
        double[] latitudes = {42.415, 42.485, 43.203};
        double[] longitudes = {27.695, 27.485, 27.950};
        LocalDateTime base = LocalDateTime.now()
                .withHour(12).withMinute(0).withSecond(0).withNano(0);

        for (int area = 0; area < places.length; area++) {
            for (int i = 0; i < 12; i++) {
                Measurement measurement = new Measurement();
                measurement.setLocationName(places[area]);
                measurement.setObservedAt(base.minusDays((11L - i) * 3));
                measurement.setTemperatureC(round1(17.5 + area * 0.9
                        + Math.sin(i * 0.5) * 1.3 + (area == 0 && i == 11 ? 5.2 : 0)));
                measurement.setTurbidityNtu(round1(3.2 + area
                        + Math.cos(i * 0.8) * 0.7 + (area == 0 && i == 11 ? 4.5 : 0)));
                measurement.setSalinityPsu(round1(17.1 + area * 0.2 + Math.sin(i * 0.3) * 0.3));
                measurement.setLatitude(latitudes[area]);
                measurement.setLongitude(longitudes[area]);
                measurement.setSource("SYNTHETIC DEMO — генерирани примерни данни");
                measurement.setNotes("СИНТЕТИЧНИ данни за демонстрация. НЕ са реални измервания.");
                measurement.setDemo(true);
                repository.save(measurement);
            }
        }
    }

    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }
}
