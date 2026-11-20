package bg.seagrass.guardian.field;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;

/** A field check the team plans for a meadow, added by a person or proposed by the AI ecologist and confirmed. */
@Entity
public class FieldTask {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private int siteId;
    @NotBlank @Size(max = 120) private String siteName;
    @NotBlank @Size(max = 300) private String title;
    @Size(max = 20) private String priority;
    @Size(max = 600) private String reason;
    @Size(max = 20) private String origin;
    private boolean done;
    private LocalDateTime createdAt = LocalDateTime.now().withNano(0);

    public Long getId() { return id; }
    public int getSiteId() { return siteId; }
    public void setSiteId(int v) { siteId = v; }
    public String getSiteName() { return siteName; }
    public void setSiteName(String v) { siteName = v; }
    public String getTitle() { return title; }
    public void setTitle(String v) { title = v; }
    public String getPriority() { return priority; }
    public void setPriority(String v) { priority = v; }
    public String getReason() { return reason; }
    public void setReason(String v) { reason = v; }
    public String getOrigin() { return origin; }
    public void setOrigin(String v) { origin = v; }
    public boolean isDone() { return done; }
    public void setDone(boolean v) { done = v; }
    public LocalDateTime getCreatedAt() { return createdAt; }
}
