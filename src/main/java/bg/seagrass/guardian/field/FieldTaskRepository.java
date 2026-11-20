package bg.seagrass.guardian.field;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface FieldTaskRepository extends JpaRepository<FieldTask, Long> {
    List<FieldTask> findAllByOrderByDoneAscCreatedAtDesc();
    List<FieldTask> findBySiteIdOrderByDoneAscCreatedAtDesc(int siteId);
}
