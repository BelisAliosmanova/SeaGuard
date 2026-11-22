package bg.seagrass.guardian.community;

import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.Instant;
import java.util.Optional;

interface CommunityPostRepository extends JpaRepository<CommunityPost, Long> {
    interface Preview {
        long getId();
        String getAuthor();
        String getMessage();
        Instant getCreatedAt();
        CommunityPost.Metric getMetric();
        String getMetricMonth();
        Double getMetricValue();
        boolean getHasPhoto();
    }

    Slice<Preview> findByTopicIdAndIdLessThanOrderByIdDesc(long topicId, long before, Pageable page);
    Optional<Preview> findFirstByTopicIdOrderByIdAsc(long topicId);
    long countByTopicIdAndHasPhotoTrue(long topicId);

    @Query("select p.jpeg from CommunityPost p where p.topic.id = :topicId and p.id = :id")
    Optional<byte[]> findPhoto(@Param("topicId") long topicId, @Param("id") long id);
}
