package bg.seagrass.guardian.measurement;

import jakarta.validation.Valid;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

@Controller
public class MeasurementController {
    private final MeasurementRepository repository;
    private final bg.seagrass.guardian.ecologist.EcologistEngine engine;

    public MeasurementController(MeasurementRepository repository, bg.seagrass.guardian.ecologist.EcologistEngine engine) {
        this.repository = repository;
        this.engine = engine;
    }

    @GetMapping("/")
    public String landing() { return "redirect:/ecologist"; }

    /** The old overview page is folded into the dashboard. */
    @GetMapping("/overview")
    public String overview() { return "redirect:/dashboard"; }

    /** Clients must never set the id (that would overwrite a record) or flag their data as synthetic. */
    @InitBinder("measurement")
    void restrictFields(WebDataBinder binder) { binder.setDisallowedFields("id", "demo"); }

    @GetMapping("/measurements")
    public String measurements(Model model) {
        model.addAttribute("measurements", repository.findAllByOrderByObservedAtDesc());
        return "measurements";
    }

    @GetMapping("/measurements/new")
    public String newMeasurement(@RequestParam(required = false) Integer site, Model model) {
        Measurement draft = new Measurement();
        if (site != null) engine.site(site).ifPresent(s -> {
            draft.setLocationName(s.name());
            draft.setLatitude(Math.round(s.latitude() * 1e5) / 1e5);
            draft.setLongitude(Math.round(s.longitude() * 1e5) / 1e5);
        });
        draft.setObservedAt(java.time.LocalDateTime.now().withSecond(0).withNano(0));
        model.addAttribute("measurement", draft);
        return "measurement-form";
    }

    @PostMapping("/measurements")
    public String save(@Valid @ModelAttribute("measurement") Measurement measurement,
                       BindingResult errors, RedirectAttributes redirectAttributes) {
        if (errors.hasErrors()) return "measurement-form";
        measurement.setDemo(false);
        repository.save(measurement);
        redirectAttributes.addFlashAttribute("success", "Измерването е записано успешно.");
        return "redirect:/measurements";
    }
}
