package bg.seagrass.guardian.ecologist;

import bg.seagrass.guardian.ecologist.Ecology.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

@Controller
public class EcologistController {
    private final EcologistEngine engine;
    private final EcologistAi ai;

    public EcologistController(EcologistEngine engine, EcologistAi ai) {
        this.engine = engine;
        this.ai = ai;
    }

    @GetMapping("/ecologist")
    public String page(Model model) {
        model.addAttribute("aiEnabled", ai.enabled());
        model.addAttribute("aiModel", ai.model());
        model.addAttribute("aiProvider", ai.provider());
        return "ecologist";
    }

    /** Every archive site ranked by screened risk. */
    @GetMapping("/api/ecologist/sites") @ResponseBody
    public Map<String, Object> sites() {
        return Map.of("aiEnabled", ai.enabled(), "aiProvider", ai.provider(), "sites", engine.ranking());
    }

    @GetMapping("/api/ecologist/assessment/{id}") @ResponseBody
    public Assessment assessment(@PathVariable int id) {
        return find(id);
    }

    @PostMapping("/api/ecologist/report/{id}") @ResponseBody
    public Report report(@PathVariable int id) {
        return ai.report(find(id));
    }

    public record Question(int siteId, String question, List<Map<String, String>> history) {}

    @PostMapping("/api/ecologist/ask") @ResponseBody
    public Answer ask(@RequestBody Question q) {
        if (q.question() == null || q.question().isBlank() || q.question().length() > 1000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Въпросът трябва да е между 1 и 1000 знака.");
        }
        return ai.ask(find(q.siteId()), q.question().trim(), q.history() == null ? List.of() : q.history(), engine.ranking());
    }

    private Assessment find(int id) {
        return engine.assess(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Участъкът не е намерен."));
    }
}
