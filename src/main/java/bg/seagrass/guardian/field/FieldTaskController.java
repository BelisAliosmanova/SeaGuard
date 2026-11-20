package bg.seagrass.guardian.field;

import bg.seagrass.guardian.ecologist.EcologistEngine;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Set;

@RestController
@RequestMapping("/api/tasks")
public class FieldTaskController {
    private static final Set<String> PRIORITIES = Set.of("Спешно", "Висок", "Среден", "Рутинно");
    private final FieldTaskRepository repository;
    private final EcologistEngine engine;

    public FieldTaskController(FieldTaskRepository repository, EcologistEngine engine) {
        this.repository = repository;
        this.engine = engine;
    }

    @GetMapping
    public List<FieldTask> list(@RequestParam(required = false) Integer siteId) {
        return siteId == null ? repository.findAllByOrderByDoneAscCreatedAtDesc()
            : repository.findBySiteIdOrderByDoneAscCreatedAtDesc(siteId);
    }

    public record NewTask(int siteId, String title, String priority, String reason, String origin) {}

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public FieldTask create(@RequestBody NewTask body) {
        var site = engine.site(body.siteId()).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Участъкът не е намерен."));
        if (body.title() == null || body.title().isBlank() || body.title().length() > 300) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Задачата трябва да има заглавие до 300 знака.");
        }
        FieldTask task = new FieldTask();
        task.setSiteId(site.id());
        task.setSiteName(site.name());
        task.setTitle(body.title().trim());
        task.setPriority(body.priority() != null && PRIORITIES.contains(body.priority()) ? body.priority() : "Среден");
        task.setReason(body.reason() == null ? null : body.reason().substring(0, Math.min(600, body.reason().length())));
        task.setOrigin("ai".equals(body.origin()) ? "ai" : "user");
        return repository.save(task);
    }

    public record Patch(Boolean done) {}

    @PatchMapping("/{id}")
    public FieldTask update(@PathVariable long id, @RequestBody Patch patch) {
        FieldTask task = repository.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (patch.done() != null) task.setDone(patch.done());
        return repository.save(task);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id) { repository.deleteById(id); }
}
