package bg.seagrass.guardian.measurement;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Controller
public class DashboardController {
    private final MeasurementRepository repository;
    public DashboardController(MeasurementRepository repository) { this.repository = repository; }

    @GetMapping("/lab")
    public String lab() { return "lab"; }

    @GetMapping("/dashboard")
    public String dashboard(Model model) {
        var all = repository.findAllByOrderByObservedAtDesc();
        model.addAttribute("count", all.size());
        model.addAttribute("demoCount", all.stream().filter(Measurement::isDemo).count());
        model.addAttribute("realCount", all.stream().filter(m -> !m.isDemo()).count());
        model.addAttribute("places", all.stream().map(Measurement::getLocationName).distinct().count());
        return "dashboard";
    }

    @GetMapping("/api/measurements") @ResponseBody
    public List<Map<String,Object>> data(@RequestParam(defaultValue="all") String kind) {
        return repository.findAllByOrderByObservedAtDesc().stream()
          .filter(m -> kind.equals("all") || (kind.equals("demo") == m.isDemo()))
          .map(m -> {
              Map<String,Object> r = new LinkedHashMap<>();
              r.put("id", m.getId()); r.put("place",m.getLocationName());
              r.put("date",m.getObservedAt().toString());
              r.put("temperature",m.getTemperatureC()); r.put("turbidity",m.getTurbidityNtu());
              r.put("salinity",m.getSalinityPsu()); r.put("latitude",m.getLatitude());
              r.put("longitude",m.getLongitude()); r.put("demo",m.isDemo());
              r.put("source",m.getSource()); return r;
          }).toList();
    }

    // Descriptive, transparent screening, not a validated ecological diagnosis.
    @GetMapping("/api/insights") @ResponseBody
    public List<Map<String,Object>> insights(@RequestParam(defaultValue="all") String kind) {
        var grouped = repository.findAllByOrderByObservedAtDesc().stream()
            .filter(m -> kind.equals("all") || (kind.equals("demo") == m.isDemo()))
            .collect(Collectors.groupingBy(m -> m.getLocationName() + "|" + m.isDemo()));
        List<Map<String,Object>> out = new ArrayList<>();
        for (var group : grouped.values()) {
            group.sort(Comparator.comparing(Measurement::getObservedAt).reversed());
            if (group.size() < 4) continue;
            Measurement latest = group.get(0);
            List<Measurement> history = group.subList(1, Math.min(7,group.size()));
            check(out,latest,history,"temperature","Температура", "°C", Measurement::getTemperatureC);
            check(out,latest,history,"turbidity","Мътност", "NTU", Measurement::getTurbidityNtu);
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
        alert.put("demo",latest.isDemo()); alert.put("samples",values.size());
        alert.put("explanation","Отклонение над 20% спрямо средната стойност на предходните " + values.size() + " записа на същото място. Това е демонстрационен статистически критерий, не доказателство за екологичен риск.");
        out.add(alert);
    }

    @PostMapping("/demo/load")
    public String seed(RedirectAttributes redirect) {
        if (repository.findAll().stream().anyMatch(Measurement::isDemo)) {
            redirect.addFlashAttribute("notice","Демонстрационните записи вече са заредени.");
            return "redirect:/dashboard";
        }
        String[] places = {"Созополски залив", "Бургаски залив", "Крайбрежие Варна"};
        double[] lat = {42.415,42.485,43.203};
        double[] lon = {27.695,27.485,27.950};
        for (int j=0;j<places.length;j++) for (int i=0;i<12;i++) {
            Measurement m = new Measurement();
            m.setLocationName(places[j]);
            m.setObservedAt(LocalDateTime.now().minusDays((11-i)*3L).withHour(12).withMinute(0).withSecond(0).withNano(0));
            m.setTemperatureC(Math.round((17.5+j*0.9+Math.sin(i*0.5)*1.3+(j==0&&i==11?5.2:0))*10.0)/10.0);
            m.setTurbidityNtu(Math.round((3.2+j+Math.cos(i*0.8)*0.7+(j==0&&i==11?4.5:0))*10.0)/10.0);
            m.setSalinityPsu(Math.round((17.1+j*0.2+Math.sin(i*0.3)*0.3)*10.0)/10.0);
            m.setLatitude(lat[j]); m.setLongitude(lon[j]);
            m.setSource("SYNTHETIC DEMO — генерирани примерни данни");
            m.setNotes("Измислена стойност само за демонстрация. НЕ е реално измерване.");
            m.setDemo(true); repository.save(m);
        }
        redirect.addFlashAttribute("notice","Заредени са 36 СИНТЕТИЧНИ записа за демонстрация — не са реални измервания.");
        return "redirect:/dashboard";
    }

    @PostMapping("/demo/clear")
    public String clear(RedirectAttributes redirect) {
        repository.deleteAll(repository.findAll().stream().filter(Measurement::isDemo).toList());
        redirect.addFlashAttribute("notice","Демонстрационните записи са изтрити. Реалните записи са запазени.");
        return "redirect:/dashboard";
    }

    @GetMapping(value="/measurements/export",produces="text/csv")
    public ResponseEntity<byte[]> export(@RequestParam(defaultValue="all") String kind) {
        StringBuilder csv = new StringBuilder("id,place,observed_at,temperature_c,turbidity_ntu,salinity_psu,latitude,longitude,source,is_synthetic_demo\n");
        for (var m : repository.findAllByOrderByObservedAtDesc()) {
            if (!kind.equals("all") && (kind.equals("demo") != m.isDemo())) continue;
            Object[] fields = {m.getId(),m.getLocationName(),m.getObservedAt(),m.getTemperatureC(),m.getTurbidityNtu(),m.getSalinityPsu(),m.getLatitude(),m.getLongitude(),m.getSource(),m.isDemo()};
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
