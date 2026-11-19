package bg.seagrass.guardian.measurement;

import jakarta.validation.Valid;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

@Controller
public class MeasurementController {
    private final MeasurementRepository repository;

    public MeasurementController(MeasurementRepository repository) {
        this.repository = repository;
    }

    @GetMapping("/")
    public String landing() { return "redirect:/seagrass"; }

    @GetMapping("/overview")
    public String home(Model model) {
        model.addAttribute("count", repository.count());
        model.addAttribute("recent", repository.findAllByOrderByObservedAtDesc().stream().limit(5).toList());
        return "index";
    }

    @GetMapping("/measurements")
    public String measurements(Model model) {
        model.addAttribute("measurements", repository.findAllByOrderByObservedAtDesc());
        return "measurements";
    }

    @GetMapping("/measurements/new")
    public String newMeasurement(Model model) {
        model.addAttribute("measurement", new Measurement());
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
