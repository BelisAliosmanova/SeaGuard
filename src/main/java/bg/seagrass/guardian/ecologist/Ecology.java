package bg.seagrass.guardian.ecologist;

import java.util.List;

/** Data shapes returned by the AI ecologist. Every number carries its source so nothing is presented without evidence. */
public final class Ecology {
    private Ecology() {}

    /** low / moderate / high, or unknown when the data needed to judge is missing. */
    public enum Level { LOW, MODERATE, HIGH, UNKNOWN }

    public record Site(int id, String name, String type, double latitude, double longitude,
                       Double areaHa, Double depthLimitM, String mappedOn, String method, boolean groundTruthed,
                       String habitat) {}

    /** One screened threat axis (light, eutrophication, heat, mechanical, field anomaly). */
    public record Indicator(String key, String label, Level level, String value, String threshold,
                            String explanation, String source) {}

    public record Cause(String key, String title, int confidence, String reasoning) {}

    public record Action(String title, String priority, String why, String verify) {}

    public record Evidence(String source, String detail, String date, String link) {}

    public record MonthPoint(String month, Double turbidity, Double chlorophyll, Double lightAtDepth) {}

    /** Water-column optics at the meadow's depth limit, for the depth-profile graphic. */
    public record Optics(double depthM, boolean depthAssumed, Double kd, Double lightPct, Double turbidityFnu) {}

    /**
     * How current one data source is. status: live (today), recent (weeks), old (years), missing (no data).
     */
    public record Freshness(String key, String source, String what, String date, String age, String status) {}

    public record Assessment(Site site, String status, String statusKey, int riskScore, int confidence,
                             String headline, Optics optics, List<Freshness> freshness, List<Indicator> indicators, List<Cause> causes, List<Action> actions,
                             List<String> dataGaps, List<Evidence> evidence, List<MonthPoint> trend,
                             String generatedAt) {}

    /** Compact row for the ranking of all sites. */
    public record SiteRisk(int id, String name, double latitude, double longitude, String status, String statusKey,
                           int riskScore, String topThreat, Double areaHa, String topCause, String firstAction,
                           Double anomaly30C) {}

    public record Water(List<String> months, List<WaterSite> sites) {}

    public record WaterSite(int id, String name, String statusKey, WaterValues values) {}

    public record WaterValues(List<Double> lightAtDepth, List<Double> turbidity, List<Double> chlorophyll) {}

    /** The narrative report. Same shape whether Claude or the rules engine wrote it. */
    public record Report(String mode, String model, String headline, String summary, List<Finding> findings,
                         List<Step> plan, List<String> unknowns, String caveat) {}

    public record Finding(String title, String severity, String explanation) {}

    public record Step(String action, String priority, String rationale, String successMetric) {}

    /** An action the AI suggests and the user confirms with a button. */
    public record AiAction(String type, String label, int siteId, String priority, String reason, String metric) {}

    public record Answer(String mode, String model, String text, List<String> used, List<AiAction> actions) {}
}
