package bg.seagrass.guardian.measurement;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Live numerical marine model data. Not in-situ seagrass observations. */
@Controller
public class MarineLiveController {
    private record Station(String label, double latitude, double longitude) {}
    private static final Map<String, Station> STATIONS = Map.of(
        "sozopol", new Station("Созопол — открито море", 42.40, 27.80),
        "varna", new Station("Варна — открито море", 43.20, 28.10),
        "burgas", new Station("Бургас — открито море", 42.48, 27.65)
    );
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ObjectMapper mapper;
    public MarineLiveController(ObjectMapper mapper) { this.mapper = mapper; }

    @GetMapping("/api/marine-live")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> data(@RequestParam(defaultValue = "sozopol") String area) {
        Station station = STATIONS.get(area);
        if (station == null) return ResponseEntity.badRequest().body(Map.of("error", "Непознат район."));
        String url = "https://marine-api.open-meteo.com/v1/marine?latitude=" + station.latitude()
            + "&longitude=" + station.longitude()
            + "&hourly=sea_surface_temperature,wave_height,ocean_current_velocity"
            + "&past_days=7&forecast_days=2&timezone=GMT&cell_selection=sea";
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(12)).header("Accept", "application/json").GET().build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) return unavailable("Външният източник върна HTTP " + response.statusCode());
            JsonNode root = mapper.readTree(response.body());
            if (root.path("error").asBoolean(false)) return unavailable("Източникът не предостави данни за този район.");
            JsonNode hourly = root.path("hourly");
            JsonNode times = hourly.path("time");
            if (!times.isArray() || times.isEmpty()) return unavailable("Няма наличен времеви ред.");
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("area", area);
            out.put("label", station.label());
            out.put("requestedLatitude", station.latitude());
            out.put("requestedLongitude", station.longitude());
            out.put("gridLatitude", numberOrNull(root.path("latitude")));
            out.put("gridLongitude", numberOrNull(root.path("longitude")));
            out.put("timezone", root.path("timezone").asText("GMT"));
            out.put("source", "Open-Meteo Marine API (числени океанографски модели)");
            out.put("sourceUrl", "https://open-meteo.com/en/docs/marine-weather-api");
            out.put("kind", "MODEL_FORECAST_AND_RECENT_MODEL_DATA");
            out.put("warning", "Това са моделни оценки/прогнози, НЕ измервания от сензор и НЕ пряко наблюдение на морски треви. Крайбрежната точност е ограничена.");
            out.put("retrievedAt", java.time.Instant.now().toString());
            out.put("units", Map.of("temperature", "°C", "wave", "m", "current", "km/h"));
            List<Map<String, Object>> series = new java.util.ArrayList<>();
            for (int i = 0; i < times.size(); i++) {
                Map<String, Object> point = new LinkedHashMap<>();
                point.put("time", times.get(i).asText());
                point.put("temperature", at(hourly.path("sea_surface_temperature"), i));
                point.put("wave", at(hourly.path("wave_height"), i));
                point.put("current", at(hourly.path("ocean_current_velocity"), i));
                series.add(point);
            }
            out.put("series", series);
            return ResponseEntity.ok().header("Cache-Control", "no-store").body(out);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return unavailable("Заявката беше прекъсната.");
        } catch (Exception e) {
            return unavailable("Няма връзка с външния източник или данните са невалидни. Опитайте по-късно.");
        }
    }

    private static Double at(JsonNode array, int index) {
        return array.isArray() && index < array.size() ? numberOrNull(array.get(index)) : null;
    }
    private static Double numberOrNull(JsonNode value) {
        return value != null && value.isNumber() && Double.isFinite(value.asDouble()) ? value.asDouble() : null;
    }
    private static ResponseEntity<Map<String, Object>> unavailable(String reason) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
            .header("Cache-Control", "no-store")
            .body(Map.of("error", reason, "source", "Open-Meteo Marine API", "fallback", "Няма синтетични заместители."));
    }
}
