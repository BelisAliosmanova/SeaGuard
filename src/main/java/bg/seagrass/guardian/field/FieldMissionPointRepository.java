package bg.seagrass.guardian.field;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;

interface FieldMissionPointRepository extends JpaRepository<FieldMissionPoint, Long> {
    List<FieldMissionPoint> findBySiteIdOrderByNumber(int siteId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from FieldMissionPoint p where p.siteId = :siteId and p.number = :number")
    Optional<FieldMissionPoint> lockPoint(@Param("siteId") int siteId, @Param("number") int number);
}
