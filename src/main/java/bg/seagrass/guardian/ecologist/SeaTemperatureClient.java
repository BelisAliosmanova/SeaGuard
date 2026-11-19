package bg.seagrass.guardian.ecologist;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.*;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Sea-surface temperature for every archive site from Open-Meteo Marine (model data), in two parts:
 * the last 92 days, so the summer peak is included, and the same calendar window in earlier years as a baseline,
 * so the engine can tell how much warmer than usual the sea has been (a +2 °C anomaly is a marine heatwave signal).
 * Cached for an hour; failures keep the last good data and never invent values.
 */
@Component
class SeaTemperatureClient {
    record HeatStats(double maxC, double meanC, int hoursAbove25, int hoursAbove28, String peakTime,
                     String from, String to, double gridLatitude, double gridLongitude,
                     Double recent30C, Double baseline30C, Double anomaly30C, int longestWarmStreakDays,
                     Double peakAnomalyC, List<Integer> baselineYears) {}

    /** Open-Meteo Marine history starts in 2023; use every complete earlier year up to three. */
    private static final int FIRST_YEAR = 2023;
    private static final double HEATWAVE_DELTA = 2.0;
    private static final Duration TTL = Duration.ofHours(1);
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ObjectMapper mapper;
    private volatile Map<Integer, HeatStats> cache = Map.of();
    private volatile Instant fetchedAt = Instant.EPOCH;

    SeaTemperatureClient(ObjectMapper mapper) { this.mapper = mapper; }

    synchronized Map<Integer, HeatStats> forSites(List<Ecology.Site> sites) {
        if (!cache.isEmpty() && Instant.now().isBefore(fetchedAt.plus(TTL))) return cache;
        try {
            String coords = coordinates(sites);
            JsonNode recent = fetch(coords + "&past_days=92&forecast_days=1");
            if (recent == null || !recent.isArray() || recent.size() != sites.size()) return cache;

            LocalDate today = LocalDate.now(ZoneOffset.UTC);
            LocalDate start = today.minusDays(92);
            List<Integer> years = new ArrayList<>();
            List<JsonNode> past = new ArrayList<>();
            for (int y = today.getYear() - 3; y <= today.getYear() - 1; y++) {
                if (y < FIRST_YEAR) continue;
                int shift = today.getYear() - y;
                JsonNode node = fetch(coords + "&start_date=" + start.minusYears(shift) + "&end_date=" + today.minusYears(shift));
                if (node != null && node.isArray() && node.size() == sites.size()) { years.add(y); past.add(node); }
            }

            Map<Integer, HeatStats> result = new HashMap<>();
            Instant now = Instant.now();
            for (int i = 0; i < sites.size(); i++) {
                List<JsonNode> baseline = new ArrayList<>();
                for (JsonNode p : past) baseline.add(p.get(i));
                HeatStats stats = stats(recent.get(i), baseline, years, now);
                if (stats != null) result.put(sites.get(i).id(), stats);
            }
            cache = Map.copyOf(result);
            fetchedAt = now;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            // Network or parse failure: keep the last good data; the engine marks heat as unknown otherwise.
        }
        return cache;
    }

    private static String coordinates(List<Ecology.Site> sites) {
        String lats = sites.stream().map(s -> String.format(Locale.ROOT, "%.4f", s.latitude())).collect(Collectors.joining(","));
        String lons = sites.stream().map(s -> String.format(Locale.ROOT, "%.4f", s.longitude())).collect(Collectors.joining(","));
        return "latitude=" + lats + "&longitude=" + lons;
    }

    private JsonNode fetch(String query) throws Exception {
        String url = "https://marine-api.open-meteo.com/v1/marine?" + query
            + "&hourly=sea_surface_temperature&timezone=GMT&cell_selection=sea";
        HttpResponse<String> response = http.send(HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(25)).GET().build(), HttpResponse.BodyHandlers.ofString());
        return response.statusCode() == 200 ? mapper.readTree(response.body()) : null;
    }

    /** Daily mean temperature keyed by month-day, past hours only. */
    private static SortedMap<String, Double> dailyMeans(JsonNode location, Instant now, boolean keyByMonthDay) {
        JsonNode times = location.path("hourly").path("time");
        JsonNode values = location.path("hourly").path("sea_surface_temperature");
        Map<String, double[]> acc = new TreeMap<>();
        for (int i = 0; i < times.size() && i < values.size(); i++) {
            String time = times.get(i).asText();
            if (LocalDateTime.parse(time).toInstant(ZoneOffset.UTC).isAfter(now)) continue;
            JsonNode v = values.get(i);
            if (!v.isNumber()) continue;
            String key = keyByMonthDay ? time.substring(5, 10) : time.substring(0, 10);
            double[] a = acc.computeIfAbsent(key, k -> new double[2]);
            a[0] += v.asDouble(); a[1]++;
        }
        SortedMap<String, Double> out = new TreeMap<>();
        acc.forEach((k, a) -> out.put(k, a[0] / a[1]));
        return out;
    }

    private static HeatStats stats(JsonNode location, List<JsonNode> baseline, List<Integer> years, Instant now) {
        JsonNode times = location.path("hourly").path("time");
        JsonNode values = location.path("hourly").path("sea_surface_temperature");
        double max = Double.NEGATIVE_INFINITY, sum = 0;
        int count = 0, above25 = 0, above28 = 0;
        String peak = null, first = null, last = null;
        for (int i = 0; i < times.size() && i < values.size(); i++) {
            String time = times.get(i).asText();
            if (LocalDateTime.parse(time).toInstant(ZoneOffset.UTC).isAfter(now)) continue;
            JsonNode v = values.get(i);
            if (!v.isNumber()) continue;
            double t = v.asDouble();
            if (first == null) first = time;
            last = time;
            sum += t; count++;
            if (t > max) { max = t; peak = time; }
            if (t > EcologistKnowledge.HEAT_MODERATE) above25++;
            if (t > EcologistKnowledge.HEAT_HIGH) above28++;
        }
        if (count == 0) return null;

        // Baseline: average of earlier years for each calendar day.
        Map<String, double[]> norm = new HashMap<>();
        for (JsonNode b : baseline) {
            dailyMeans(b, now, true).forEach((md, t) -> {
                double[] a = norm.computeIfAbsent(md, k -> new double[2]);
                a[0] += t; a[1]++;
            });
        }
        SortedMap<String, Double> recentDays = dailyMeans(location, now, false);
        List<String> days = new ArrayList<>(recentDays.keySet());
        Double recent30 = null, base30 = null, anomaly30 = null, peakAnomaly = null;
        int streak = 0, longest = 0;
        if (!norm.isEmpty()) {
            double rs = 0, bs = 0; int n = 0;
            for (int i = 0; i < days.size(); i++) {
                String day = days.get(i);
                double[] b = norm.get(day.substring(5));
                if (b == null) { streak = 0; continue; }
                double delta = recentDays.get(day) - b[0] / b[1];
                peakAnomaly = peakAnomaly == null ? delta : Math.max(peakAnomaly, delta);
                streak = delta >= HEATWAVE_DELTA ? streak + 1 : 0;
                longest = Math.max(longest, streak);
                if (i >= days.size() - 30) { rs += recentDays.get(day); bs += b[0] / b[1]; n++; }
            }
            if (n > 0) { recent30 = rs / n; base30 = bs / n; anomaly30 = recent30 - base30; }
        }
        return new HeatStats(max, sum / count, above25, above28, peak, first, last,
            location.path("latitude").asDouble(), location.path("longitude").asDouble(),
            recent30, base30, anomaly30, longest, peakAnomaly, List.copyOf(years));
    }
}
