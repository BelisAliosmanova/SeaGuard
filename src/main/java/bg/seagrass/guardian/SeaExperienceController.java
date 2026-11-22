package bg.seagrass.guardian;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
class SeaExperienceController {
    @GetMapping({"/simulation", "/simulation.html"})
    String simulation() {
        return "simulation";
    }

    @GetMapping({"/under-the-waves", "/sea-games.html"})
    String game() {
        return "sea-games";
    }
}
