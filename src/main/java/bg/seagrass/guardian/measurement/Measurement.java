package bg.seagrass.guardian.measurement;

import jakarta.persistence.*;
import jakarta.validation.constraints.*;
import java.time.LocalDateTime;

@Entity
public class Measurement {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank @Size(max = 120)
    private String locationName;

    @NotNull @PastOrPresent
    private LocalDateTime observedAt;

    @NotNull @DecimalMin("-2.0") @DecimalMax("45.0")
    private Double temperatureC;

    @DecimalMin("0.0")
    private Double turbidityNtu;

    @DecimalMin("0.0") @DecimalMax("50.0")
    private Double salinityPsu;

    @NotBlank @Size(max = 200)
    private String source;

    @Size(max = 500)
    private String notes;

    // True only for deliberately generated example data.
    private boolean demo;
    @DecimalMin("-90.0") @DecimalMax("90.0")
    private Double latitude;
    @DecimalMin("-180.0") @DecimalMax("180.0")
    private Double longitude;

    public boolean isDemo() { return demo; }
    public void setDemo(boolean demo) { this.demo = demo; }
    public Double getLatitude() { return latitude; }
    public void setLatitude(Double latitude) { this.latitude = latitude; }
    public Double getLongitude() { return longitude; }
    public void setLongitude(Double longitude) { this.longitude = longitude; }
    public Long getId() { return id; }
    public String getLocationName() { return locationName; }
    public void setLocationName(String value) { locationName = value; }
    public LocalDateTime getObservedAt() { return observedAt; }
    public void setObservedAt(LocalDateTime value) { observedAt = value; }
    public Double getTemperatureC() { return temperatureC; }
    public void setTemperatureC(Double value) { temperatureC = value; }
    public Double getTurbidityNtu() { return turbidityNtu; }
    public void setTurbidityNtu(Double value) { turbidityNtu = value; }
    public Double getSalinityPsu() { return salinityPsu; }
    public void setSalinityPsu(Double value) { salinityPsu = value; }
    public String getSource() { return source; }
    public void setSource(String value) { source = value; }
    public String getNotes() { return notes; }
    public void setNotes(String value) { notes = value; }
}
