package bg.seagrass.guardian.measurement;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

@RestController
public class MarineHistoryController {
    private final MarineArchiveService service;
    public MarineHistoryController(MarineArchiveService service) { this.service = service; }
    @GetMapping("/api/marine-history")
    public ResponseEntity<?> history(@RequestParam(defaultValue="sozopol") String area) {
        try { return ResponseEntity.ok(Map.of("area",area,"kind","RECENT_MODEL_DATA","records",service.history(area))); }
        catch (IllegalArgumentException e) { return ResponseEntity.badRequest().body(Map.of("error",e.getMessage())); }
    }
}
