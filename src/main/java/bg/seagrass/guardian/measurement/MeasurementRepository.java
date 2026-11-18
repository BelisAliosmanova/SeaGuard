package bg.seagrass.guardian.measurement;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface MeasurementRepository extends JpaRepository<Measurement, Long> {
    List<Measurement> findAllByOrderByObservedAtDesc();
}
