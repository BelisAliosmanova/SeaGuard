package bg.seagrass.guardian.ecologist;

import bg.seagrass.guardian.ecologist.Ecology.*;
import bg.seagrass.guardian.measurement.Measurement;
import bg.seagrass.guardian.measurement.MeasurementRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.*;

import static bg.seagrass.guardian.ecologist.EcologistKnowledge.*;

/**
 * Deterministic ecological screening. Joins the SEANOE meadow archive, Copernicus 100 m ocean colour,
 * Open-Meteo sea temperature, harbour proximity and field measurements into one evidence-backed assessment.
 * The LLM layer only explains this result; it never computes risk on its own.
 */
@Service
public class EcologistEngine {
    private static final double FIELD_RADIUS_KM = 2.0;
    private static final Locale BG = Locale.forLanguageTag("bg");

    private final List<Site> sites;
    private final Map<Integer, List<JsonNode>> satellite = new HashMap<>();
    private final String satelliteDataset;
    private final String satelliteRetrieved;
    private final SeaTemperatureClient temperatures;
    private final MeasurementRepository measurements;

    public EcologistEngine(ObjectMapper mapper, SeaTemperatureClient temperatures, MeasurementRepository measurements,
                           @Value("classpath:static/data/zostera-bulgaria.geojson") Resource archive,
                           @Value("classpath:static/data/copernicus-coast.json") Resource coast) throws IOException {
        this.temperatures = temperatures;
        this.measurements = measurements;
        try (InputStream a = archive.getInputStream(); InputStream c = coast.getInputStream()) {
            List<Site> loaded = new ArrayList<>();
            for (JsonNode feature : mapper.readTree(a).path("features")) loaded.add(toSite(feature));
            this.sites = List.copyOf(loaded);
            JsonNode snapshot = mapper.readTree(c);
            this.satelliteDataset = snapshot.path("dataset").asText();
            this.satelliteRetrieved = snapshot.path("retrievedOn").asText();
            snapshot.path("sites").fields().forEachRemaining(e -> {
                List<JsonNode> rows = new ArrayList<>();
                e.getValue().forEach(rows::add);
                rows.sort(Comparator.comparing(r -> r.path("month").asText())); // oldest first
                satellite.put(Integer.parseInt(e.getKey()), rows);
            });
        }
    }

    public List<Site> sites() { return sites; }

    public Optional<Site> site(int id) { return sites.stream().filter(s -> s.id() == id).findFirst(); }

    public List<SiteRisk> ranking() {
        var heat = temperatures.forSites(sites);
        var field = realMeasurements();
        return sites.stream().map(s -> {
            Assessment a = assess(s, heat.get(s.id()), field);
            String top = a.indicators().stream()
                .filter(i -> i.level() == Level.HIGH || i.level() == Level.MODERATE)
                .max(Comparator.comparing(Indicator::level)).map(Indicator::label).orElse("—");
            return new SiteRisk(s.id(), s.name(), s.latitude(), s.longitude(), a.status(), a.statusKey(),
                a.riskScore(), top, s.areaHa(),
                a.causes().isEmpty() ? null : a.causes().get(0).title(),
                a.actions().isEmpty() ? null : a.actions().get(0).title());
        }).sorted(Comparator.comparingInt(SiteRisk::riskScore).reversed()).toList();
    }

    public Optional<Assessment> assess(int siteId) {
        return site(siteId).map(s -> assess(s, temperatures.forSites(sites).get(s.id()), realMeasurements()));
    }

    // ------------------------------------------------------------------ core

    private Assessment assess(Site site, SeaTemperatureClient.HeatStats heat, List<Measurement> field) {
        List<Indicator> indicators = new ArrayList<>();
        List<String> gaps = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>();
        List<JsonNode> sat = satellite.getOrDefault(site.id(), List.of());
        double depth = site.depthLimitM() != null ? site.depthLimitM() : 5.0;
        if (site.depthLimitM() == null) gaps.add("Архивът няма дълбочинна граница; светлината е оценена за 5 m.");

        evidence.add(new Evidence("SEANOE · архив на морските треви",
            "Картиран %s (%s), площ %s ха, граница %s m%s".formatted(site.mappedOn(), site.method(),
                fmt(site.areaHa(), 1), fmt(site.depthLimitM(), 0), site.groundTruthed() ? ", с водолазна проверка" : ""),
            site.mappedOn(), "https://doi.org/10.17882/79590"));

        // 1. Light at the depth limit, from growing-season turbidity.
        Level light = Level.UNKNOWN, eutro = Level.UNKNOWN, trend = Level.UNKNOWN;
        Double seasonTur = mean(sat, "turbidity"), seasonChl = mean(sat, "chlorophyll");
        Double lightFrac = seasonTur == null ? null : lightAtDepth(seasonTur, depth);
        if (lightFrac != null) {
            light = lightFrac >= LIGHT_OK ? Level.LOW : lightFrac >= LIGHT_CRITICAL ? Level.MODERATE : Level.HIGH;
            indicators.add(new Indicator("light", "Светлина до дъното", light,
                "≈%s %% от повърхностната на %s m".formatted(fmt(lightFrac * 100, 0), fmt(depth, 0)),
                "≥20 % достатъчно · <11 % критично за Zostera",
                "Средна мътност %s FNU за %s–%s дава затихване Kd≈%s m⁻¹. При под 11 %% светлина долната граница на ливадата обикновено се оттегля."
                    .formatted(fmt(seasonTur, 1), monthName(sat.get(0)), monthName(sat.get(sat.size() - 1)),
                        fmt(attenuation(seasonTur), 2)).replace("%%", "%"),
                "Copernicus Marine 100 m · изчислена оценка"));
        } else gaps.add("Няма сателитни данни за мътност в радиус 750 m.");

        if (seasonChl != null) {
            eutro = seasonChl >= CHL_HIGH ? Level.HIGH : seasonChl >= CHL_MODERATE ? Level.MODERATE : Level.LOW;
            indicators.add(new Indicator("eutrophication", "Еутрофикация", eutro,
                "%s mg/m³ хлорофил-а".formatted(fmt(seasonChl, 1)), "<3 ниско · 3–6 умерено · >6 високо",
                "Хлорофил-а е заместител на фитопланктона. Високите стойности означават излишък на хранителни вещества и допълнителна сянка над тревата.",
                "Copernicus Marine 100 m · средна за сезона"));
        }

        // 2. Turbidity trend across the satellite window.
        if (sat.size() >= 4) {
            double early = avg(sat.subList(0, 2), "turbidity"), late = avg(sat.subList(sat.size() - 2, sat.size()), "turbidity");
            double change = (late - early) / Math.max(early, 0.1);
            trend = change > 2 * TREND_WORSENING ? Level.HIGH : change > TREND_WORSENING ? Level.MODERATE : Level.LOW;
            indicators.add(new Indicator("trend", "Тенденция на мътността", trend,
                "%s%s %%".formatted(change >= 0 ? "+" : "", fmt(change * 100, 0)),
                ">+30 % влошаване",
                "Сравнява %s–%s с %s–%s. В рамките на един сезон част от промяната е сезонна (бури, речен отток)."
                    .formatted(monthName(sat.get(0)), monthName(sat.get(1)), monthName(sat.get(sat.size() - 2)), monthName(sat.get(sat.size() - 1))),
                "Copernicus Marine 100 m"));
        }
        if (!sat.isEmpty()) {
            JsonNode last = sat.get(sat.size() - 1);
            int obs = sat.stream().mapToInt(r -> r.path("turbidityCount").asInt()).sum();
            evidence.add(new Evidence("Copernicus Marine · OCEANCOLOUR_BLK_BGC_HR_L4",
                "%d месеца, %d дневни наблюдения, пиксел на %d m от центъра".formatted(sat.size(), obs, last.path("distanceM").asInt()),
                "%s – %s".formatted(sat.get(0).path("month").asText(), last.path("month").asText()),
                "https://doi.org/10.48670/moi-00087"));
        }

        // 3. Heat stress from the last 92 days of modelled sea-surface temperature.
        Level heatLevel = Level.UNKNOWN;
        if (heat != null) {
            heatLevel = heat.hoursAbove28() >= 24 ? Level.HIGH
                : heat.hoursAbove25() >= HEAT_SUSTAINED_HOURS ? Level.MODERATE : Level.LOW;
            indicators.add(new Indicator("heat", "Топлинен стрес", heatLevel,
                "макс. %s °C · %d ч над 25 °C".formatted(fmt(heat.maxC(), 1), heat.hoursAbove25()),
                ">72 ч над 25 °C умерено · >24 ч над 28 °C високо",
                "Пикът е на %s. Zostera marina намалява растежа над ~25 °C; продължително над 28 °C води до смъртност. Повърхностната температура надценява тази на дъното в плитки, но не и в смесени води."
                    .formatted(dateText(heat.peakTime())),
                "Open-Meteo Marine · моделни данни"));
            evidence.add(new Evidence("Open-Meteo Marine · температура на повърхността",
                "Часови моделни стойности, клетка %s, %s".formatted(fmt(heat.gridLatitude(), 3), fmt(heat.gridLongitude(), 3)),
                "%s – %s".formatted(heat.from().substring(0, 10), heat.to().substring(0, 10)),
                "https://open-meteo.com/en/docs/marine-weather-api"));
        } else gaps.add("Температурата на морето не е налична в момента (няма връзка с Open-Meteo).");

        // 3b. Temperature anomaly: how much warmer than the same weeks in earlier years. +2 °C sustained = heatwave.
        Level anomalyLevel = Level.UNKNOWN;
        if (heat != null && heat.anomaly30C() != null) {
            double an = heat.anomaly30C();
            int streak = heat.longestWarmStreakDays();
            anomalyLevel = streak >= 5 || an >= 2 ? Level.HIGH : streak >= 2 || an >= 1 ? Level.MODERATE : Level.LOW;
            String years = heat.baselineYears().isEmpty() ? "" : heat.baselineYears().get(0) + "–" + heat.baselineYears().get(heat.baselineYears().size() - 1);
            indicators.add(new Indicator("anomaly", "Температурна аномалия", anomalyLevel,
                "%s%s °C спрямо нормата · %d дни ≥ +2 °C".formatted(an >= 0 ? "+" : "", fmt(an, 1), streak),
                "+2 °C за 5+ поредни дни = морска гореща вълна",
                ("Последните 30 дни средно %s °C при обичайни %s °C за същите седмици през %s. Най-дългата поредица от дни с поне +2 °C над нормата е %d дни"
                    + (heat.peakAnomalyC() != null ? ", а най-голямото дневно отклонение е %s%s °C. " : ". ")
                    + "Внезапното затопляне с 2 °C стресира тревата дори под 25 °C, защото тя не успява да се адаптира.")
                    .formatted(fmt(heat.recent30C(), 1), fmt(heat.baseline30C(), 1), years, streak,
                        heat.peakAnomalyC() != null && heat.peakAnomalyC() >= 0 ? "+" : "", fmt(heat.peakAnomalyC(), 1)),
                "Open-Meteo Marine · сравнение с " + years));
            if (heat.baselineYears().size() < 5) {
                gaps.add("Нормата за температурата е от " + heat.baselineYears().size()
                    + " години (" + years + "); за климатична норма са нужни 30 години (сателитен архив Copernicus от 1982 г.).");
            }
        }

        // 4. Mechanical pressure proxy: distance to the nearest harbour or marina.
        var harbour = HARBOURS.stream().min(Comparator.comparingDouble(h -> km(site.latitude(), site.longitude(), h.latitude(), h.longitude()))).orElseThrow();
        double harbourKm = km(site.latitude(), site.longitude(), harbour.latitude(), harbour.longitude());
        Level mechanical = harbourKm < HARBOUR_NEAR_KM ? Level.MODERATE : Level.LOW;
        indicators.add(new Indicator("mechanical", "Механичен натиск", mechanical,
            "%s km до %s".formatted(fmt(harbourKm, 1), harbour.name()), "<1,5 km повишен натиск",
            "Индикатор по близост, не наблюдение. Котви, витла и драгиране увреждат ризомите. Нужен е оглед на дъното за следи.",
            "Близост до пристанище/марина"));
        gaps.add("Няма преки наблюдения за котвене, тралене или драгиране; механичният натиск е оценен по близост.");

        // 5. Field measurements within 2 km.
        Level fieldLevel = Level.UNKNOWN;
        List<Measurement> near = field.stream()
            .filter(m -> km(site.latitude(), site.longitude(), m.getLatitude(), m.getLongitude()) <= FIELD_RADIUS_KM)
            .sorted(Comparator.comparing(Measurement::getObservedAt).reversed()).toList();
        if (!near.isEmpty()) {
            Measurement latest = near.get(0);
            fieldLevel = Level.LOW;
            String note = "Последно: %s °C".formatted(fmt(latest.getTemperatureC(), 1));
            if (latest.getTurbidityNtu() != null) note += ", %s NTU".formatted(fmt(latest.getTurbidityNtu(), 1));
            if (latest.getTemperatureC() != null && latest.getTemperatureC() > HEAT_MODERATE) fieldLevel = Level.MODERATE;
            indicators.add(new Indicator("field", "Теренни измервания", fieldLevel,
                "%d записа в радиус 2 km".formatted(near.size()), "Температура >25 °C или скок в мътността",
                note + " (" + latest.getObservedAt().toLocalDate() + ", източник: " + latest.getSource() + ").",
                "Ръчно въведени, непроверени"));
            evidence.add(new Evidence("Теренни измервания в SeaGuard", near.size() + " записа в радиус 2 km",
                latest.getObservedAt().toLocalDate().toString(), "/measurements"));
        } else gaps.add("Няма теренни измервания в радиус 2 km (сонда, Secchi диск, PAR сензор).");

        int ageYears = archiveAge(site.mappedOn());
        if (ageYears >= 6) gaps.add("Границите на ливадата са картирани преди %d години; текущото покритие не е потвърдено.".formatted(ageYears));
        gaps.add("Няма скорошно подводно видео (ROV/AUV) за оценка на покритието и плътността.");

        // ---------------------------------------------------------- scoring
        Map<String, Integer> weights = Map.of("light", 3, "eutrophication", 2, "heat", 2, "anomaly", 2, "trend", 1, "mechanical", 1, "field", 2);
        int sum = 0, max = 0;
        for (Indicator i : indicators) {
            if (i.level() == Level.UNKNOWN) continue;
            int w = weights.getOrDefault(i.key(), 1);
            sum += w * i.level().ordinal();
            max += w * 2;
        }
        int score = max == 0 ? 0 : Math.round(100f * sum / max);
        String statusKey = score >= 55 ? "high" : score >= 30 ? "elevated" : score >= 12 ? "watch" : "low";
        String status = switch (statusKey) {
            case "high" -> "Висок риск";
            case "elevated" -> "Повишен риск";
            case "watch" -> "Под наблюдение";
            default -> "Ниски рискови сигнали";
        };

        int confidence = 35;
        if (sat.size() >= 4) confidence += 15;
        if (heat != null) confidence += 10;
        if (!near.isEmpty()) confidence += 20;
        if (site.groundTruthed()) confidence += 5;
        if (ageYears >= 8) confidence -= 10;
        confidence = Math.max(15, Math.min(90, confidence));

        List<Cause> causes = causes(light, eutro, heatLevel, anomalyLevel, trend, mechanical, lightFrac, seasonChl, heat, harbour.name(), harbourKm);
        List<Action> actions = actions(site, light, eutro, max(heatLevel, anomalyLevel), trend, mechanical, near.isEmpty(), ageYears);

        List<MonthPoint> series = sat.stream().map(r -> {
            Double tur = num(r, "turbidity");
            return new MonthPoint(r.path("month").asText(), tur, num(r, "chlorophyll"),
                tur == null ? null : round(lightAtDepth(tur, depth) * 100, 1));
        }).toList();

        Optics optics = new Optics(depth, site.depthLimitM() == null,
            seasonTur == null ? null : round(attenuation(seasonTur), 3),
            lightFrac == null ? null : round(lightFrac * 100, 1), seasonTur == null ? null : round(seasonTur, 2));
        List<Freshness> freshness = new ArrayList<>();
        freshness.add(new Freshness("archive", "Граници на ливадата", "Карта от водолази и сателит (SEANOE)",
            site.mappedOn(), ageYears <= 0 ? "тази година" : ageYears == 1 ? "преди 1 година" : "преди " + ageYears + " години",
            ageYears >= 3 ? "old" : "recent"));
        if (!sat.isEmpty()) {
            String lastMonth = sat.get(sat.size() - 1).path("month").asText();
            int months = monthsSince(lastMonth);
            freshness.add(new Freshness("satellite", "Мътност и хлорофил", "Сателит Copernicus, средно за месец",
                lastMonth, months <= 0 ? "този месец" : months == 1 ? "миналия месец" : "преди " + months + " месеца",
                months <= 2 ? "recent" : "old"));
        } else freshness.add(new Freshness("satellite", "Мътност и хлорофил", "Сателит Copernicus", null, "няма данни", "missing"));
        freshness.add(heat != null
            ? new Freshness("temperature", "Температура на морето", "Open-Meteo, моделни данни, обновяват се всеки час",
                heat.to().substring(0, 10), "днес", "live")
            : new Freshness("temperature", "Температура на морето", "Open-Meteo", null, "няма връзка", "missing"));
        if (!near.isEmpty()) {
            var when = near.get(0).getObservedAt().toLocalDate();
            long days = java.time.temporal.ChronoUnit.DAYS.between(when, java.time.LocalDate.now());
            freshness.add(new Freshness("field", "Теренни измервания", near.size() + " записа до 2 km", when.toString(),
                days == 0 ? "днес" : "преди " + days + " дни", days <= 45 ? "recent" : "old"));
        } else freshness.add(new Freshness("field", "Теренни измервания", "Сонда, термометър, Secchi диск", null, "няма", "missing"));
        freshness.add(new Freshness("video", "Подводно видео", "ROV/AUV или водолаз", null, "няма", "missing"));

        return new Assessment(site, status, statusKey, score, confidence, headline(indicators), optics, freshness, indicators, causes,
            actions, gaps, evidence, series, Instant.now().toString());
    }

    private static Level max(Level a, Level b) {
        if (a == Level.UNKNOWN) return b;
        if (b == Level.UNKNOWN) return a;
        return a.ordinal() >= b.ordinal() ? a : b;
    }

    private static List<Cause> causes(Level light, Level eutro, Level heat, Level anomaly, Level trend, Level mechanical,
                                      Double lightFrac, Double chl, SeaTemperatureClient.HeatStats h,
                                      String harbour, double harbourKm) {
        List<Cause> list = new ArrayList<>();
        if (light != Level.UNKNOWN) {
            int c = pick(light, 15, 55, 80) + (trend == Level.MODERATE || trend == Level.HIGH ? 10 : 0);
            list.add(new Cause("light", "Недостиг на светлина от мътна вода", Math.min(c, 92),
                "Оценени ≈%s %% светлина на дълбочинната граница; източници: ресуспензия при вълнение, речен отток, драгиране."
                    .formatted(fmt(lightFrac * 100, 0)).replace("%%", "%")));
        }
        if (eutro != Level.UNKNOWN) {
            int c = pick(eutro, 10, 45, 70) + (eutro != Level.LOW && light != Level.LOW ? 10 : 0);
            list.add(new Cause("eutrophication", "Еутрофикация (хранителни вещества)", Math.min(c, 90),
                "Хлорофил-а %s mg/m³ показва богата на хранителни вещества вода; фитопланктонът и епифитите засенчват листата."
                    .formatted(fmt(chl, 1))));
        }
        if (heat != Level.UNKNOWN && h != null) {
            list.add(new Cause("heat", "Летен топлинен стрес", pick(heat, 8, 50, 75),
                "%d часа над 25 °C за последните 92 дни, максимум %s °C.".formatted(h.hoursAbove25(), fmt(h.maxC(), 1))));
        }
        if (anomaly != Level.UNKNOWN && h != null && h.anomaly30C() != null) {
            list.add(new Cause("anomaly", "Морска гореща вълна (по-топло от обичайното)", pick(anomaly, 6, 50, 78),
                "Водата е с %s%s °C над нормата за сезона; %d поредни дни с поне +2 °C."
                    .formatted(h.anomaly30C() >= 0 ? "+" : "", fmt(h.anomaly30C(), 1), h.longestWarmStreakDays())));
        }
        list.add(new Cause("mechanical", "Механично увреждане (котви, тралене)", pick(mechanical, 12, 35, 35),
            "Хипотеза по близост: %s km до %s. Без оглед на дъното не може да се потвърди.".formatted(fmt(harbourKm, 1), harbour)));
        list.sort(Comparator.comparingInt(Cause::confidence).reversed());
        return list;
    }

    private static List<Action> actions(Site site, Level light, Level eutro, Level heat, Level trend, Level mechanical,
                                        boolean noField, int ageYears) {
        List<Action> list = new ArrayList<>();
        if (noField || ageYears >= 6) {
            list.add(new Action("Георефериран ROV/AUV трансект по дълбочинната граница",
                light == Level.HIGH || eutro == Level.HIGH ? "Спешно" : "Висок",
                "Архивната карта е от " + site.mappedOn() + ". Само подводни кадри показват дали ливадата е там и какво е покритието.",
                "Покритие (%) и долна граница (m) по едни и същи GPS точки; повтор след 12 месеца."));
        }
        if (light == Level.HIGH || light == Level.MODERATE) {
            list.add(new Action("Измери светлината на дъното (PAR логер или Secchi диск)", light == Level.HIGH ? "Спешно" : "Висок",
                "Сателитната оценка показва гранична светлина. Измерването отделя мътността от другите причини.",
                "% повърхностна светлина на дълбочинната граница; цел ≥20 %."));
            list.add(new Action("Открий източника на мътност", "Висок",
                "Речен отток, драгиране, строителство или ресуспензия при бури изискват различни мерки.",
                "Мътност преди/след източника; карта на шлейфа от Copernicus 100 m."));
        }
        if (eutro == Level.HIGH || eutro == Level.MODERATE) {
            list.add(new Action("Провери за източници на хранителни вещества", eutro == Level.HIGH ? "Висок" : "Среден",
                "Повишеният хлорофил-а сочи излишък на азот и фосфор (пречиствателни станции, реки, земеделски отток).",
                "Нитрати и фосфати в 3 точки; тенденция на хлорофил-а през следващия сезон."));
        }
        if (heat == Level.HIGH || heat == Level.MODERATE) {
            list.add(new Action("Температурен логер на дъното за лятото", heat == Level.HIGH ? "Висок" : "Среден",
                "Има летен топлинен стрес или затопляне над нормата. Повърхностната температура е моделна; логер на дълбочина показва истинския стрес.",
                "Часове над 25 °C и 28 °C на дъното от юни до септември."));
        }
        if (mechanical == Level.MODERATE) {
            list.add(new Action("Оглед за следи от котви и предложение за зона без котвене", "Среден",
                "Участъкът е близо до пристанище. Еко-швартовките намаляват увреждането на ризомите.",
                "Брой следи/белези на 100 m трансект; след мярката — повторен оглед."));
        }
        boolean favourable = light == Level.LOW && eutro != Level.HIGH && heat != Level.HIGH;
        if (favourable) {
            list.add(new Action("Кандидат за защита или пилотно възстановяване", "Рутинно",
                "Водните условия изглеждат подходящи. Възстановяване само след потвърждение от морски биолог и изяснена причина за загуба.",
                "Оцеляване на засадените издънки след 6 и 12 месеца."));
        }
        return list;
    }

    private static String headline(List<Indicator> indicators) {
        List<String> parts = indicators.stream()
            .filter(i -> i.level() == Level.HIGH).map(i -> i.label().toLowerCase(BG)).toList();
        List<String> moderate = indicators.stream()
            .filter(i -> i.level() == Level.MODERATE).map(i -> i.label().toLowerCase(BG)).toList();
        if (!parts.isEmpty()) return "Сериозен сигнал: " + String.join(", ", parts)
            + (moderate.isEmpty() ? "" : "; умерено: " + String.join(", ", moderate));
        if (!moderate.isEmpty()) return "Умерени сигнали: " + String.join(", ", moderate);
        return "Няма силни рискови сигнали в наличните данни";
    }

    // ------------------------------------------------------------------ helpers

    private List<Measurement> realMeasurements() {
        return measurements.findAllByOrderByObservedAtDesc().stream()
            .filter(m -> m.getLatitude() != null && m.getLongitude() != null).toList();
    }

    private static Site toSite(JsonNode feature) {
        JsonNode p = feature.path("properties");
        double minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
        JsonNode g = feature.path("geometry");
        List<JsonNode> polygons = new ArrayList<>();
        if ("Polygon".equals(g.path("type").asText())) polygons.add(g.path("coordinates"));
        else g.path("coordinates").forEach(polygons::add);
        for (JsonNode polygon : polygons) for (JsonNode ring : polygon) for (JsonNode pt : ring) {
            double lon = pt.get(0).asDouble(), lat = pt.get(1).asDouble();
            minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
            minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        }
        return new Site(feature.path("id").asInt(), p.path("NAME").asText(), p.path("type").asText(),
            (minLat + maxLat) / 2, (minLon + maxLon) / 2, numOrNull(p.path("area_ha")), numOrNull(p.path("depthlimit")),
            p.path("Sat_date").asText(), p.path("map_method").asText().replace('_', ' '),
            "yes".equalsIgnoreCase(p.path("groundtrth").asText()), p.path("EUNIS_2019").asText());
    }

    private static int monthsSince(String yearMonth) {
        try {
            var ym = java.time.YearMonth.parse(yearMonth);
            return (int) java.time.temporal.ChronoUnit.MONTHS.between(ym, java.time.YearMonth.now());
        } catch (Exception e) { return 99; }
    }

    private static int archiveAge(String mappedOn) {
        try { return java.time.Year.now().getValue() - Integer.parseInt(mappedOn.substring(0, 4)); }
        catch (Exception e) { return 0; }
    }

    private static Double mean(List<JsonNode> rows, String key) {
        return rows.stream().map(r -> num(r, key)).filter(Objects::nonNull).mapToDouble(Double::doubleValue).average().stream().boxed().findFirst().orElse(null);
    }
    private static double avg(List<JsonNode> rows, String key) { Double m = mean(rows, key); return m == null ? 0 : m; }
    private static Double num(JsonNode n, String key) { return numOrNull(n.path(key)); }
    private static Double numOrNull(JsonNode n) { return n != null && n.isNumber() ? n.asDouble() : null; }
    private static int pick(Level l, int low, int mid, int high) { return l == Level.HIGH ? high : l == Level.MODERATE ? mid : low; }
    private static double round(double v, int digits) { double f = Math.pow(10, digits); return Math.round(v * f) / f; }

    static String fmt(Double v, int digits) {
        if (v == null) return "—";
        return String.format(BG, "%." + digits + "f", v);
    }

    private static final String[] MONTHS = {"яну", "фев", "мар", "апр", "май", "юни", "юли", "авг", "сеп", "окт", "ное", "дек"};
    private static String monthName(JsonNode row) {
        String m = row.path("month").asText();
        try { return MONTHS[Integer.parseInt(m.substring(5, 7)) - 1] + " " + m.substring(0, 4); } catch (Exception e) { return m; }
    }
    private static String dateText(String isoTime) {
        if (isoTime == null) return "—";
        return isoTime.substring(8, 10) + "." + isoTime.substring(5, 7) + "." + isoTime.substring(0, 4);
    }

    static double km(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1), dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 6371 * 2 * Math.asin(Math.sqrt(a));
    }

    String satelliteDataset() { return satelliteDataset; }
    String satelliteRetrieved() { return satelliteRetrieved; }
}
