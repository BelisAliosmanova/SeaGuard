package bg.seagrass.guardian.measurement;

import jakarta.persistence.*;
import jakarta.validation.constraints.*;
import org.springframework.format.annotation.DateTimeFormat;
import java.time.LocalDateTime;

@Entity
public class Measurement {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank(message = "Въведи място.") @Size(max = 120, message = "До 120 знака.")
    private String locationName;

    @NotNull(message = "Въведи дата и час.") @PastOrPresent(message = "Датата не може да е в бъдещето.")
    // Matches the HTML datetime-local format both ways.
    @DateTimeFormat(pattern = "yyyy-MM-dd'T'HH:mm")
    private LocalDateTime observedAt;

    @NotNull(message = "Въведи температура.")
    @DecimalMin(value = "-2.0", message = "Минимум −2 °C.") @DecimalMax(value = "45.0", message = "Максимум 45 °C.")
    private Double temperatureC;

    @DecimalMin(value = "0.0", message = "Мътността не може да е отрицателна.")
    private Double turbidityNtu;

    @DecimalMin(value = "0.0", message = "Минимум 0 PSU.") @DecimalMax(value = "50.0", message = "Максимум 50 PSU.")
    private Double salinityPsu;

    @NotBlank(message = "Посочи източник.") @Size(max = 200, message = "До 200 знака.")
    private String source;

    @Size(max = 500, message = "До 500 знака.")
    private String notes;

    // Legacy column kept so existing MySQL tables stay valid; always false.
    private boolean demo;
    @DecimalMin(value = "-90.0", message = "Между −90 и 90.") @DecimalMax(value = "90.0", message = "Между −90 и 90.")
    private Double latitude;
    @DecimalMin(value = "-180.0", message = "Между −180 и 180.") @DecimalMax(value = "180.0", message = "Между −180 и 180.")
    private Double longitude;

    /** A point needs both coordinates; one alone cannot be placed on the map. */
    @AssertTrue(message = "Въведи и ширина, и дължина, или остави и двете празни.")
    public boolean isCoordinatesComplete() { return (latitude == null) == (longitude == null); }

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
