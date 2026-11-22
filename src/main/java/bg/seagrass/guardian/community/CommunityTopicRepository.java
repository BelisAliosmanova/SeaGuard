package bg.seagrass.guardian.community;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.Optional;

interface CommunityTopicRepository extends JpaRepository<CommunityTopic, Long> {
    @Query("""
        select t from CommunityTopic t
        where (:category is null or t.category = :category)
            and (:siteId is null or t.siteId = :siteId)
        order by t.updatedAt desc, t.id desc
        """)
    Slice<CommunityTopic> search(@Param("category") CommunityTopic.Category category,
                                 @Param("siteId") Integer siteId, Pageable page);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from CommunityTopic t where t.id = :id")
    Optional<CommunityTopic> forUpdate(@Param("id") long id);
}
