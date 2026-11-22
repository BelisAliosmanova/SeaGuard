package bg.seagrass.guardian.ecologist;

import bg.seagrass.guardian.ecologist.Ecology.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

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
    public String page() {
        return "ecologist";
    }

    @GetMapping("/seagrass")
    public String atlasRedirect(@RequestParam(required = false) String site, RedirectAttributes redirect) {
        if (site != null) redirect.addAttribute("site", site);
        return "redirect:/ecologist";
    }

    @GetMapping("/api/ecologist/locations") @ResponseBody
    public List<SiteLocation> locations() {
        return engine.sites().stream().map(site -> new SiteLocation(site.id(), site.name())).toList();
    }

    record SiteLocation(int id, String name) {}

    @GetMapping("/api/ecologist/water") @ResponseBody
    public Water water() {
        return engine.water();
    }

    /** Every archive site ranked by screened risk. */
    @GetMapping("/api/ecologist/sites") @ResponseBody
    public Map<String, Object> sites() {
        return Map.of("sites", engine.ranking());
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
        String question = q.question().trim();
        List<Map<String, String>> history = q.history() == null ? List.of() : q.history();
        if (!EcologistScope.allows(question, history)) {
            engine.site(q.siteId()).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Участъкът не е намерен."));
            return EcologistScope.redirect();
        }
        return ai.ask(find(q.siteId()), question, history, engine.ranking());
    }

    private Assessment find(int id) {
        return engine.assess(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Участъкът не е намерен."));
    }
}
