package bg.seagrass.guardian.measurement;

import jakarta.persistence.*;
import java.time.Instant;

/** Archived ocean model output, NOT in-situ observations or seagrass health data. */
@Entity
@Table(name = "marine_model_readings", uniqueConstraints = @UniqueConstraint(
    name = "uk_marine_area_time", columnNames = {"area", "valid_at"}))
public class MarineModelReading {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false, length = 24) private String area;
    @Column(name = "valid_at", nullable = false) private Instant validAt;
    @Column(nullable = false) private Instant retrievedAt;
    private Double seaSurfaceTemperatureC;
    private Double waveHeightM;
    private Double currentVelocityKmh;
    private Double gridLatitude;
    private Double gridLongitude;
    @Column(nullable = false, length = 120) private String source = "Open-Meteo Marine API";
    @Column(nullable = false, length = 32) private String dataType = "RECENT_MODEL_DATA";
    protected MarineModelReading() {}
    public MarineModelReading(String area, Instant validAt, Instant retrievedAt, Double temperature, Double wave, Double current, Double lat, Double lon) {
        this.area = area; this.validAt = validAt; this.retrievedAt = retrievedAt;
        this.seaSurfaceTemperatureC = temperature; this.waveHeightM = wave; this.currentVelocityKmh = current;
        this.gridLatitude = lat; this.gridLongitude = lon;
    }
    public Long getId() { return id; }
    public String getArea() { return area; }
    public Instant getValidAt() { return validAt; }
    public Instant getRetrievedAt() { return retrievedAt; }
    public Double getSeaSurfaceTemperatureC() { return seaSurfaceTemperatureC; }
    public Double getWaveHeightM() { return waveHeightM; }
    public Double getCurrentVelocityKmh() { return currentVelocityKmh; }
    public Double getGridLatitude() { return gridLatitude; }
    public Double getGridLongitude() { return gridLongitude; }
    public String getSource() { return source; }
    public String getDataType() { return dataType; }
}
