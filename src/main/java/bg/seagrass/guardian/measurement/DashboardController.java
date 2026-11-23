package bg.seagrass.guardian.measurement;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import java.util.stream.Collectors;

import static bg.seagrass.guardian.ecologist.EcologistKnowledge.*;

@Controller
public class DashboardController {
    private final MeasurementRepository repository;
    public DashboardController(MeasurementRepository repository) { this.repository = repository; }

    @GetMapping("/overview")
    public String landing() { return "redirect:/dashboard"; }

    @GetMapping("/dashboard")
    public String dashboard(Model model) {
        model.addAttribute("count", repository.countByDemoFalse());
        model.addAttribute("lightOk", LIGHT_OK * 100);
        model.addAttribute("lightCritical", LIGHT_CRITICAL * 100);
        model.addAttribute("chlorophyllModerate", CHL_MODERATE);
        model.addAttribute("chlorophyllHigh", CHL_HIGH);
        return "dashboard";
    }

    @GetMapping("/api/measurements") @ResponseBody
    public List<Map<String,Object>> data() {
        return repository.findByDemoFalseOrderByObservedAtDesc().stream()
          .map(m -> {
              Map<String,Object> r = new LinkedHashMap<>();
              r.put("id", m.getId()); r.put("place",m.getLocationName());
              r.put("date",m.getObservedAt().toString());
              r.put("temperature",m.getTemperatureC()); r.put("turbidity",m.getTurbidityNtu());
              r.put("salinity",m.getSalinityPsu()); r.put("latitude",m.getLatitude());
              r.put("longitude",m.getLongitude());
              r.put("source",m.getSource()); return r;
          }).toList();
    }

    // Descriptive, transparent screening, not a validated ecological diagnosis.
    @GetMapping("/api/insights") @ResponseBody
    public List<Map<String,Object>> insights() {
        var grouped = repository.findByDemoFalseOrderByObservedAtDesc().stream()
            .collect(Collectors.groupingBy(Measurement::getLocationName));
        List<Map<String,Object>> out = new ArrayList<>();
        for (var group : grouped.values()) {
            group.sort(Comparator.comparing(Measurement::getObservedAt).reversed());
            if (group.size() < 4) continue;
            Measurement latest = group.get(0);
            List<Measurement> history = group.subList(1, Math.min(7,group.size()));
            check(out,latest,history,"temperature","Температура", "°C", Measurement::getTemperatureC);
            check(out,latest,history,"turbidity","Мътност", "NTU", Measurement::getTurbidityNtu);
            check(out,latest,history,"salinity","Соленост", "PSU", Measurement::getSalinityPsu);
        }
        return out;
    }

    private void check(List<Map<String,Object>> out, Measurement latest, List<Measurement> history,
                       String metric, String label, String unit,
                       java.util.function.Function<Measurement,Double> extractor) {
        Double current = extractor.apply(latest);
        var values = history.stream().map(extractor).filter(Objects::nonNull).toList();
        if (current == null || values.size() < 3) return;
        double baseline = values.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double diff = current-baseline;
        // Exploratory relative deviation only; avoid division by near-zero baseline.
        if (Math.abs(baseline) < 0.001 || Math.abs(diff)/Math.abs(baseline) < 0.20) return;
        Map<String,Object> alert = new LinkedHashMap<>();
        alert.put("place",latest.getLocationName()); alert.put("metric",metric);
        alert.put("title",label + (diff>0 ? " се повишава" : " се понижава"));
        alert.put("current",current); alert.put("baseline",Math.round(baseline*100.0)/100.0);
        alert.put("unit",unit); alert.put("date",latest.getObservedAt().toString());
        alert.put("samples",values.size());
        alert.put("explanation","Отклонение над 20% спрямо средната стойност на предходните " + values.size() + " записа на същото място. Статистически критерий, не доказателство за екологичен риск.");
        out.add(alert);
    }

    @GetMapping(value="/measurements/export",produces="text/csv")
    public ResponseEntity<byte[]> export() {
        StringBuilder csv = new StringBuilder("id,place,observed_at,temperature_c,turbidity_ntu,salinity_psu,latitude,longitude,source\n");
        for (var m : repository.findByDemoFalseOrderByObservedAtDesc()) {
            Object[] fields = {m.getId(),m.getLocationName(),m.getObservedAt(),m.getTemperatureC(),m.getTurbidityNtu(),m.getSalinityPsu(),m.getLatitude(),m.getLongitude(),m.getSource()};
            csv.append(Arrays.stream(fields).map(this::csvField).collect(Collectors.joining(","))).append('\n');
        }
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=seagrass-measurements.csv")
            .contentType(new MediaType("text","csv",java.nio.charset.StandardCharsets.UTF_8))
            .body(("\uFEFF"+csv).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    private String csvField(Object o) {
        if(o==null) return "";
        String s=String.valueOf(o);
        // Protect spreadsheet programs against CSV formula injection.
        if (!s.isEmpty() && "=+-@".indexOf(s.charAt(0))>=0) s="'"+s;
        return "\""+s.replace("\"","\"\"")+"\"";
    }
}
