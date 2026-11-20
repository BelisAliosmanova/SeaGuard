package bg.seagrass.guardian.field;

import bg.seagrass.guardian.ecologist.EcologistEngine;
import bg.seagrass.guardian.ecologist.Ecology.Site;
import bg.seagrass.guardian.measurement.JpegFrame;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@RestController
@RequestMapping("/api/ecologist/field-missions/{siteId}")
public class FieldMissionController {
    private static final String WRITE_HEADER = "X-SeaGuard-Mission=1";
    private static final List<String> LABELS = List.of("Край на ливадата", "Навътре в ливадата");
    private static final List<String> INSTRUCTIONS = List.of(
        "Заснеми дъното при ръба на архивния контур. Виждат ли се тесни листовидни растителни форми?",
        "Заснеми дъното навътре в контура. Виждат ли се тесни листовидни растителни форми?");

    private final EcologistEngine engine;
    private final FieldMissionPlanner planner;
    private final FieldMissionPointRepository points;
    private final FieldMissionReviewRepository reviews;
    private final FieldTaskRepository tasks;

    public FieldMissionController(EcologistEngine engine, FieldMissionPlanner planner, FieldMissionPointRepository points,
                                  FieldMissionReviewRepository reviews, FieldTaskRepository tasks) {
        this.engine = engine;
        this.planner = planner;
        this.points = points;
        this.reviews = reviews;
        this.tasks = tasks;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<PointView> mission(@PathVariable int siteId) {
        requireSite(siteId);
        return points.findBySiteIdOrderByNumber(siteId).stream().map(this::view).toList();
    }

    @PostMapping(headers = WRITE_HEADER)
    @Transactional
    public List<PointView> plan(@PathVariable int siteId) {
        var site = requireSite(siteId);
        var existing = points.findBySiteIdOrderByNumber(siteId);
        if (!existing.isEmpty()) return existing.stream().map(this::view).toList();

        var coordinates = planner.locations(siteId);
        var planned = new ArrayList<FieldMissionPoint>();
        for (int i = 0; i < coordinates.size(); i++) {
            var point = coordinates.get(i);
            var task = new FieldTask();
            task.setSiteId(siteId);
            task.setSiteName(site.name());
            task.setTitle("Точка " + (i + 1) + " · " + LABELS.get(i));
            task.setPriority("Рутинно");
            task.setReason(INSTRUCTIONS.get(i));
            task.setOrigin("user");
            planned.add(new FieldMissionPoint(siteId, i + 1, point.latitude(), point.longitude(),
                LABELS.get(i), INSTRUCTIONS.get(i), tasks.save(task).getId()));
        }
        return points.saveAllAndFlush(planned).stream().map(this::view).toList();
    }

    @PostMapping(value = "/points/{number}/reviews", headers = WRITE_HEADER,
        consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional
    public PointView review(@PathVariable int siteId, @PathVariable int number,
                            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate capturedOn,
                            @RequestParam double depthM, @RequestParam FieldMissionReview.Verdict verdict,
                            @RequestParam(defaultValue = "") String notes,
                            @RequestParam(required = false) String aiObservation,
                            @RequestParam(required = false) Double seconds,
                            @RequestParam(required = false) Long previousReviewId,
                            @RequestParam MultipartFile frame) {
        requireSite(siteId);
        if (capturedOn.isAfter(LocalDate.now()) || !Double.isFinite(depthM) || depthM < 0
            || (seconds != null && (!Double.isFinite(seconds) || seconds < 0))
            || notes.length() > 600 || (aiObservation != null && aiObservation.length() > 600)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Провери датата, дълбочината и дължината на бележките.");
        }
        byte[] jpeg = JpegFrame.read(frame);
        var point = points.lockPoint(siteId, number).orElseThrow(() -> notFound("Точката не е планирана."));
        var latest = reviews.findFirstByPointIdOrderByIdDesc(point.id).orElse(null);
        if (latest == null ? previousReviewId != null
                : !Objects.equals(latest.id, previousReviewId) || latest.verdict != FieldMissionReview.Verdict.UNCLEAR) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Проверката за тази точка вече е обновена.");
        }
        var saved = reviews.saveAndFlush(new FieldMissionReview(point, capturedOn, depthM, verdict, notes.strip(),
            aiObservation == null || aiObservation.isBlank() ? null : aiObservation.strip(), seconds, jpeg));
        tasks.findById(point.taskId).ifPresent(task -> task.setDone(verdict != FieldMissionReview.Verdict.UNCLEAR));
        return view(point, saved);
    }

    @GetMapping("/points/{number}/reviews/{reviewId}/frame")
    @Transactional(readOnly = true)
    public ResponseEntity<byte[]> frame(@PathVariable int siteId, @PathVariable int number,
                                        @PathVariable long reviewId) {
        requireSite(siteId);
        var review = reviews.findByIdAndPointSiteIdAndPointNumber(reviewId, siteId, number)
            .orElseThrow(() -> notFound("Кадърът не е намерен."));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .contentType(MediaType.IMAGE_JPEG).body(review.jpeg);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, String>> missionError(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("message", error.getReason()));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Map<String, String>> concurrentPlan() {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(Map.of("message", "Мисията беше обновена. Зареди я отново."));
    }

    private Site requireSite(int siteId) {
        return engine.site(siteId).orElseThrow(() -> notFound("Участъкът не е намерен."));
    }

    private static ResponseStatusException notFound(String message) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
    }

    private PointView view(FieldMissionPoint point) {
        return view(point, reviews.findFirstByPointIdOrderByIdDesc(point.id).orElse(null));
    }

    private static PointView view(FieldMissionPoint point, FieldMissionReview review) {
        var evidence = review == null ? null : new ReviewView(review.id, review.capturedOn, review.depthM,
            review.verdict.name(), review.notes, review.aiObservation, review.seconds);
        return new PointView(point.number, point.latitude, point.longitude, point.label, point.instruction, evidence);
    }

    record PointView(int number, double latitude, double longitude, String label, String instruction, ReviewView review) {}
    record ReviewView(long id, LocalDate capturedOn, double depthM, String verdict, String notes,
                      String aiObservation, Double seconds) {}
}
