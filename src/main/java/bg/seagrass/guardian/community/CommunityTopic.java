package bg.seagrass.guardian.community;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "community_topics", indexes = @Index(name = "community_topic_activity", columnList = "updated_at,id"))
class CommunityTopic {
    enum Category {
        GENERAL("Общ чат"), SEAGRASS("Морски треви"), WATER("Качество на водата"),
        OBSERVATIONS("Подводни наблюдения");

        final String label;
        Category(String label) { this.label = label; }
    }

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id;
    @Column(nullable = false, length = 120)
    String title;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    Category category;
    Integer siteId;
    boolean investigation;
    @Column(nullable = false, name = "updated_at")
    Instant updatedAt;
    int replies;
    Long taskId;

    protected CommunityTopic() {}

    CommunityTopic(String title, Category category, Integer siteId, boolean investigation) {
        this.title = title;
        this.category = category;
        this.siteId = siteId;
        this.investigation = investigation;
        this.updatedAt = Instant.now();
    }

    void addReply() {
        replies++;
        updatedAt = Instant.now();
    }
}
