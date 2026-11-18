package bg.seagrass.guardian.measurement;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

@Service
public class MarineArchiveService {
    private final MarineModelReadingRepository repository;
    private final MarineLiveController live;
    @Value("${seaguard.marine.sync.enabled:false}") private boolean enabled;
    public MarineArchiveService(MarineModelReadingRepository repository, MarineLiveController live) {
        this.repository = repository; this.live = live;
    }
    @Scheduled(initialDelay = 15000, fixedDelayString = "${seaguard.marine.sync.delay-ms:10800000}")
    public void scheduledSync() {
        if (!enabled) return;
        for (String area : List.of("sozopol", "varna", "burgas")) {
            try { syncArea(area); } catch (Exception ex) {
                System.err.println("Marine sync failed for " + area + ": " + ex.getMessage());
            }
        }
    }
    @Transactional
    public int syncArea(String area) {
        if (!List.of("sozopol", "varna", "burgas").contains(area)) throw new IllegalArgumentException("Unknown area");
        var response = live.data(area);
        if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null)
            throw new IllegalStateException("External marine source unavailable");
        Map<String,Object> body = response.getBody();
        Object series = body.get("series");
        if (!(series instanceof List<?> rows)) throw new IllegalStateException("No marine time series");
        Instant now = Instant.now();
        Double gridLat = num(body.get("gridLatitude"));
        Double gridLon = num(body.get("gridLongitude"));
        int inserted = 0;
        for (Object item : rows) {
            if (!(item instanceof Map<?,?> row)) continue;
            Object time = row.get("time");
            if (!(time instanceof String timeText)) continue;
            Instant validAt;
            try { validAt = LocalDateTime.parse(timeText).toInstant(ZoneOffset.UTC); }
            catch (Exception ex) { continue; }
            // Only past or present model values are archived. Forecasts remain on the live page.
            if (validAt.isAfter(now) || repository.existsByAreaAndValidAt(area, validAt)) continue;
            Double temperature = num(row.get("temperature")), wave = num(row.get("wave")), current = num(row.get("current"));
            if (temperature == null && wave == null && current == null) continue;
            repository.save(new MarineModelReading(area, validAt, now, temperature, wave, current, gridLat, gridLon));
            inserted++;
        }
        return inserted;
    }
    private static Double num(Object value) {
        return value instanceof Number n && Double.isFinite(n.doubleValue()) ? n.doubleValue() : null;
    }
    public List<MarineModelReading> history(String area) {
        if (!List.of("sozopol", "varna", "burgas").contains(area)) throw new IllegalArgumentException("Unknown area");
        return repository.findTop500ByAreaOrderByValidAtDesc(area);
    }
}
