package bg.seagrass.guardian;

import bg.seagrass.guardian.ecologist.EcologistEngine;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
class HomeController {
    private final EcologistEngine engine;

    HomeController(EcologistEngine engine) {
        this.engine = engine;
    }

    @GetMapping({"/", "/index.html"})
    String home(Model model) {
        model.addAttribute("initialSite", engine.sites().stream().findFirst().orElse(null));
        return "index";
    }
}
