package bg.seagrass.guardian.field;

import jakarta.persistence.*;
import java.time.LocalDate;

@Entity
class FieldMissionReview {
    enum Verdict { CONFIRMED, NOT_VISIBLE, UNCLEAR }

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "point_id", nullable = false)
    FieldMissionPoint point;
    @Column(nullable = false)
    LocalDate capturedOn;
    double depthM;
    @Enumerated(EnumType.STRING)
    @Column(length = 20, nullable = false)
    Verdict verdict;
    @Column(length = 600, nullable = false)
    String notes;
    @Column(length = 600)
    String aiObservation;
    Double seconds;
    @Lob
    @Column(nullable = false)
    byte[] jpeg;

    protected FieldMissionReview() {}

    FieldMissionReview(FieldMissionPoint point, LocalDate capturedOn, double depthM, Verdict verdict, String notes,
                       String aiObservation, Double seconds, byte[] jpeg) {
        this.point = point;
        this.capturedOn = capturedOn;
        this.depthM = depthM;
        this.verdict = verdict;
        this.notes = notes;
        this.aiObservation = aiObservation;
        this.seconds = seconds;
        this.jpeg = jpeg;
    }
}
