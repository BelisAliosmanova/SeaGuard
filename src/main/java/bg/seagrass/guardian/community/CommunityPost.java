package bg.seagrass.guardian.community;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "community_posts", indexes = @Index(name = "community_post_sequence", columnList = "topic_id,id"))
public class CommunityPost {
    public enum Metric {
        TURBIDITY("Мътност", "FNU"), CHLOROPHYLL("Хлорофил-а", "мг/м³");

        final String label;
        final String unit;
        Metric(String label, String unit) {
            this.label = label;
            this.unit = unit;
        }
    }

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "topic_id", nullable = false)
    CommunityTopic topic;
    @Column(nullable = false, length = 45)
    String author;
    @Column(nullable = false, length = 1600)
    String message;
    @Column(nullable = false)
    Instant createdAt = Instant.now();
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    Metric metric;
    @Column(length = 7)
    String metricMonth;
    Double metricValue;
    boolean hasPhoto;
    @Lob
    byte[] jpeg;

    protected CommunityPost() {}

    CommunityPost(CommunityTopic topic, String author, String message, Metric metric, String metricMonth,
                  Double metricValue, byte[] jpeg) {
        this.topic = topic;
        this.author = author;
        this.message = message;
        this.metric = metric;
        this.metricMonth = metricMonth;
        this.metricValue = metricValue;
        this.hasPhoto = jpeg != null;
        this.jpeg = jpeg;
    }
}
