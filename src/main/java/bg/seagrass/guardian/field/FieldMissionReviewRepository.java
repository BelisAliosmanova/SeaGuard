package bg.seagrass.guardian.field;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

interface FieldMissionReviewRepository extends JpaRepository<FieldMissionReview, Long> {
    Optional<FieldMissionReview> findFirstByPointIdOrderByIdDesc(long pointId);
    Optional<FieldMissionReview> findByIdAndPointSiteIdAndPointNumber(long id, int siteId, int number);
}
