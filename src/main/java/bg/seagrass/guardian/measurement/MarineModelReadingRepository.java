package bg.seagrass.guardian.measurement;

import org.springframework.data.jpa.repository.JpaRepository;
import java.time.Instant;
import java.util.List;

public interface MarineModelReadingRepository extends JpaRepository<MarineModelReading, Long> {
    boolean existsByAreaAndValidAt(String area, Instant validAt);
    List<MarineModelReading> findTop500ByAreaOrderByValidAtDesc(String area);
}
