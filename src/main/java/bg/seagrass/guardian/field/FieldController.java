package bg.seagrass.guardian.field;

import bg.seagrass.guardian.measurement.MeasurementRepository;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class FieldController {
    private final MeasurementRepository measurements;

    public FieldController(MeasurementRepository measurements) {
        this.measurements = measurements;
    }

    @GetMapping("/field")
    public String field(Model model) {
        model.addAttribute("measurements", measurements.findByDemoFalseOrderByObservedAtDesc());
        return "field";
    }
}
