package bg.seagrass.guardian.field;

import jakarta.persistence.*;

@Entity
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"site_id", "point_number"}))
class FieldMissionPoint {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id;
    @Column(name = "site_id")
    int siteId;
    @Column(name = "point_number")
    int number;
    double latitude;
    double longitude;
    @Column(length = 100, nullable = false)
    String label;
    @Column(length = 300, nullable = false)
    String instruction;
    @Column(nullable = false)
    long taskId;

    protected FieldMissionPoint() {}

    FieldMissionPoint(int siteId, int number, double latitude, double longitude, String label,
                      String instruction, long taskId) {
        this.siteId = siteId;
        this.number = number;
        this.latitude = latitude;
        this.longitude = longitude;
        this.label = label;
        this.instruction = instruction;
        this.taskId = taskId;
    }
}
