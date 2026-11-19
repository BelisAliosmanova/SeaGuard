package bg.seagrass.guardian.ecologist;

import bg.seagrass.guardian.ecologist.Ecology.*;
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.errors.AnthropicIoException;
import com.anthropic.errors.AnthropicServiceException;
import com.anthropic.errors.RateLimitException;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StopReason;
import com.fasterxml.jackson.annotation.JsonPropertyDescription;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Claude as the ecologist's voice. It receives the engine's evidence-backed assessment and turns it into a report
 * or an answer; it does not see or invent raw data beyond that. Without ANTHROPIC_API_KEY the rules engine
 * writes the same report shape, so the app works without the network.
 */
@Component
public class EcologistAi {
    /** What Claude must return for a report. Wrapped into {@link Report} with the mode and model. */
    record LlmReport(
        @JsonPropertyDescription("Едно изречение: основният извод за участъка.") String headline,
        @JsonPropertyDescription("3–5 изречения: какво показват данните, кое е най-вероятната причина и колко сме сигурни.") String summary,
        @JsonPropertyDescription("Ключови находки, подредени по важност.") List<LlmFinding> findings,
        @JsonPropertyDescription("План за действие, подреден по приоритет.") List<LlmStep> plan,
        @JsonPropertyDescription("Какво не знаем и кои данни биха променили извода.") List<String> unknowns,
        @JsonPropertyDescription("Едно изречение за ограниченията на оценката.") String caveat) {}
    record LlmFinding(String title,
                      @JsonPropertyDescription("Една от: висока, умерена, ниска, неизвестна") String severity,
                      String explanation) {}
    record LlmStep(String action,
                   @JsonPropertyDescription("Една от: Спешно, Висок, Среден, Рутинно") String priority,
                   String rationale,
                   @JsonPropertyDescription("Измерим показател, по който ще се види ефектът.") String successMetric) {}

    private final ObjectMapper mapper;
    private final String model;
    private final AnthropicClient client;
    private final GeminiClient gemini;
    private final Map<String, Report> reportCache = new ConcurrentHashMap<>();

    public EcologistAi(ObjectMapper mapper, GeminiClient gemini, @Value("${seaguard.ai.model:claude-opus-5-5}") String model) {
        this.mapper = mapper;
        this.model = model;
        this.gemini = gemini;
        boolean hasKey = notBlank(System.getenv("ANTHROPIC_API_KEY")) || notBlank(System.getenv("ANTHROPIC_AUTH_TOKEN"));
        this.client = hasKey ? AnthropicOkHttpClient.fromEnv() : null;
    }

    /** "claude", "gemini" or "rules": Claude wins when both keys are set. */
    public String provider() { return client != null ? "claude" : gemini.enabled() ? "gemini" : "rules"; }
    public boolean enabled() { return !"rules".equals(provider()); }
    public String model() { return client != null ? model : gemini.enabled() ? gemini.model() : null; }

    public Report report(Assessment a) {
        if (!enabled()) return rulesReport(a, null);
        String key = provider() + ":" + a.site().id() + ":" + fingerprint(a);
        Report cached = reportCache.get(key);
        if (cached != null) return cached;
        if (client == null) {
            try {
                String text = gemini.generate(EcologistKnowledge.SYSTEM_PROMPT, List.of(Map.of("role", "user",
                    "text", REPORT_TASK.formatted(json(a)) + "\n\n" + REPORT_SHAPE)), true);
                LlmReport r = mapper.readValue(stripFences(text), LlmReport.class);
                Report report = toReport("gemini", gemini.model(), r);
                reportCache.put(key, report);
                return report;
            } catch (GeminiClient.GeminiException e) {
                return rulesReport(a, e.getMessage() + " Показан е докладът на експертната система.");
            } catch (Exception e) {
                return rulesReport(a, "Gemini върна непълен отговор; показан е докладът на експертната система.");
            }
        }
        try {
            var params = base(4000)
                .addUserMessage(REPORT_TASK.formatted(json(a)))
                .outputConfig(LlmReport.class)
                .build();
            var message = client.messages().create(params);
            if (message.stopReason().filter(StopReason.REFUSAL::equals).isPresent()) {
                return rulesReport(a, "Моделът отказа заявката; показан е докладът на експертната система.");
            }
            LlmReport r = message.content().stream()
                .flatMap(b -> b.text().stream()).map(t -> t.text()).findFirst()
                .orElseThrow(() -> new IllegalStateException("Empty response"));
            Report report = toReport("claude", model, r);
            reportCache.put(key, report);
            return report;
        } catch (RateLimitException e) {
            return rulesReport(a, "AI е натоварен (rate limit); показан е докладът на експертната система.");
        } catch (AnthropicServiceException | AnthropicIoException e) {
            return rulesReport(a, "AI не е достъпен в момента; показан е докладът на експертната система.");
        } catch (RuntimeException e) {
            return rulesReport(a, "AI върна непълен отговор; показан е докладът на експертната система.");
        }
    }

    /** What the model returns for a question: the answer, which indicators it relied on, and suggested actions. */
    record LlmAnswer(
        @JsonPropertyDescription("Отговор на български, до ~150 думи, с числата от оценката. Без markdown.") String answer,
        @JsonPropertyDescription("Ключовете на показателите, на които се опира отговорът (light, eutrophication, heat, anomaly, trend, mechanical, field).") List<String> used,
        @JsonPropertyDescription("0 до 3 предложени действия, които потребителят може да потвърди с бутон.") List<LlmAction> actions) {}
    record LlmAction(
        @JsonPropertyDescription("add_task, open_site, show_map, new_measurement или show_trend") String type,
        @JsonPropertyDescription("Кратък текст на бутона или задачата") String label,
        @JsonPropertyDescription("Номер на участък; за open_site друг участък от списъка") Integer siteId,
        @JsonPropertyDescription("За add_task: Спешно, Висок, Среден или Рутинно") String priority,
        @JsonPropertyDescription("Защо се предлага, едно изречение") String reason,
        @JsonPropertyDescription("За show_trend: lightAtDepth, turbidity или chlorophyll") String metric) {}

    private static final java.util.Set<String> ACTION_TYPES = java.util.Set.of("add_task", "open_site", "show_map", "new_measurement", "show_trend");
    private static final java.util.Set<String> METRICS = java.util.Set.of("lightAtDepth", "turbidity", "chlorophyll");

    private static final String ASK_RULES = """
        Отговори кратко (до ~150 думи), конкретно и с числата от оценката. Без markdown.
        Можеш да предложиш до 3 действия, които потребителят потвърждава с бутон:
        - add_task: задача в плана за терена за ТОЗИ участък (label = конкретната задача, priority, reason);
        - open_site: отвори друг участък от списъка за сравнение (siteId от списъка, label, reason);
        - show_map: покажи участъка на картата;
        - new_measurement: попълни теренно измерване за участъка;
        - show_trend: покажи месечната графика (metric = lightAtDepth, turbidity или chlorophyll).
        Предлагай действие само когато наистина следва от въпроса и данните.""";

    public Answer ask(Assessment a, String question, List<Map<String, String>> history, List<SiteRisk> sites) {
        if (!enabled()) return rulesAnswer(a, question, sites, null);
        String context = "Оценка на участъка, по която отговаряш:\n<assessment>\n" + json(a) + "\n</assessment>\n"
            + "Други участъци (id, име, риск):\n" + sites.stream().map(s -> s.id() + " " + s.name() + " " + s.riskScore())
                .collect(java.util.stream.Collectors.joining("; "));
        List<Map<String, String>> recent = history.stream().skip(Math.max(0, history.size() - 6))
            .filter(t -> t.get("text") != null && ("user".equals(t.get("role")) || "assistant".equals(t.get("role")))).toList();
        if (client == null) {
            List<Map<String, String>> turns = new ArrayList<>();
            turns.add(Map.of("role", "user", "text", context));
            turns.add(Map.of("role", "assistant", "text", "Разполагам с оценката. Какъв е въпросът?"));
            turns.addAll(recent);
            turns.add(Map.of("role", "user", "text", question + "\n\n" + ASK_RULES + """

                Върни САМО JSON: {"answer": "...", "used": ["light"], "actions": [{"type": "add_task", "label": "...", "siteId": 2, "priority": "Висок", "reason": "...", "metric": null}]}"""));
            try {
                LlmAnswer r = mapper.readValue(stripFences(gemini.generate(EcologistKnowledge.SYSTEM_PROMPT, turns, true)), LlmAnswer.class);
                return toAnswer("gemini", gemini.model(), r, a, sites);
            } catch (GeminiClient.GeminiException e) {
                return rulesAnswer(a, question, sites, e.getMessage());
            } catch (Exception e) {
                return rulesAnswer(a, question, sites, "Gemini върна неочакван формат.");
            }
        }
        try {
            var builder = base(3000).addUserMessage(context);
            builder.addAssistantMessage("Разполагам с оценката. Какъв е въпросът?");
            for (var turn : recent) {
                if ("user".equals(turn.get("role"))) builder.addUserMessage(turn.get("text"));
                else builder.addAssistantMessage(turn.get("text"));
            }
            builder.addUserMessage(question + "\n\n" + ASK_RULES);
            var message = client.messages().create(builder.outputConfig(LlmAnswer.class).build());
            if (message.stopReason().filter(StopReason.REFUSAL::equals).isPresent()) return rulesAnswer(a, question, sites, null);
            LlmAnswer r = message.content().stream().flatMap(b -> b.text().stream()).map(t -> t.text()).findFirst()
                .orElseThrow(() -> new IllegalStateException("Empty response"));
            return toAnswer("claude", model, r, a, sites);
        } catch (RuntimeException e) {
            return rulesAnswer(a, question, sites, null);
        }
    }

    /** Keep only well-formed actions that point at real sites, so the UI never shows a broken button. */
    private static Answer toAnswer(String mode, String model, LlmAnswer r, Assessment a, List<SiteRisk> sites) {
        var known = a.indicators().stream().map(Indicator::key).collect(java.util.stream.Collectors.toSet());
        var ids = sites.stream().map(SiteRisk::id).collect(java.util.stream.Collectors.toSet());
        List<String> used = r.used() == null ? List.of() : r.used().stream().filter(known::contains).distinct().toList();
        List<AiAction> actions = new ArrayList<>();
        for (LlmAction x : r.actions() == null ? List.<LlmAction>of() : r.actions()) {
            if (x == null || x.type() == null || !ACTION_TYPES.contains(x.type()) || x.label() == null || x.label().isBlank()) continue;
            int siteId = "open_site".equals(x.type()) ? (x.siteId() == null ? -1 : x.siteId()) : a.site().id();
            if (!ids.contains(siteId) || ("open_site".equals(x.type()) && siteId == a.site().id())) continue;
            String metric = "show_trend".equals(x.type()) ? (METRICS.contains(x.metric()) ? x.metric() : "lightAtDepth") : null;
            actions.add(new AiAction(x.type(), x.label().trim(), siteId, x.priority(), x.reason(), metric));
            if (actions.size() == 3) break;
        }
        return new Answer(mode, model, r.answer() == null ? "" : r.answer().trim(), used, actions);
    }

    private static final String REPORT_TASK = """
        Напиши екологичен доклад за участъка по оценката по-долу. Подреди находките по важност,
        обясни причинно-следствената връзка между индикаторите и дай план, който екип на терен може да
        изпълни. Използвай числата от оценката, когато обосноваваш. Отчети колко стари са данните (поле freshness).

        <assessment>
        %s
        </assessment>""";

    private static final String REPORT_SHAPE = """
        Върни САМО JSON с тази форма:
        {"headline": "едно изречение", "summary": "3-5 изречения",
         "findings": [{"title": "...", "severity": "висока|умерена|ниска|неизвестна", "explanation": "..."}],
         "plan": [{"action": "...", "priority": "Спешно|Висок|Среден|Рутинно", "rationale": "...", "successMetric": "..."}],
         "unknowns": ["..."], "caveat": "едно изречение"}""";

    private static Report toReport(String mode, String model, LlmReport r) {
        return new Report(mode, model, r.headline(), r.summary(),
            r.findings() == null ? List.of() : r.findings().stream().map(f -> new Finding(f.title(), f.severity(), f.explanation())).toList(),
            r.plan() == null ? List.of() : r.plan().stream().map(s -> new Step(s.action(), s.priority(), s.rationale(), s.successMetric())).toList(),
            r.unknowns() == null ? List.of() : r.unknowns(), r.caveat());
    }

    private static String stripFences(String text) {
        String t = text.trim();
        if (t.startsWith("```")) t = t.replaceFirst("^```[a-zA-Z]*\\s*", "").replaceFirst("\\s*```$", "");
        return t;
    }

    private MessageCreateParams.Builder base(long maxTokens) {
        return MessageCreateParams.builder()
            .model(model)
            .maxTokens(maxTokens)
            .system(EcologistKnowledge.SYSTEM_PROMPT)
            // Server-side fallback if the request is ever declined by a safety classifier.
            .putAdditionalHeader("anthropic-beta", "server-side-fallback-2026-07-01")
            .putAdditionalBodyProperty("fallbacks", JsonValue.from("default"));
    }

    // ------------------------------------------------------------------ rules fallback

    static Report rulesReport(Assessment a, String notice) {
        List<Finding> findings = a.indicators().stream()
            .filter(i -> i.level() != Ecology.Level.UNKNOWN)
            .sorted(Comparator.comparing(Indicator::level).reversed())
            .map(i -> new Finding(i.label() + ": " + i.value(), severity(i.level()), i.explanation())).toList();
        List<Step> plan = a.actions().stream().map(x -> new Step(x.title(), x.priority(), x.why(), x.verify())).toList();
        Cause top = a.causes().isEmpty() ? null : a.causes().get(0);
        String summary = "%s за участък %s (риск %d/100, увереност %d %%). %s".formatted(
            a.status(), a.site().name(), a.riskScore(), a.confidence(),
            top == null ? "" : "Най-вероятната причина е „" + top.title().toLowerCase(Locale.forLanguageTag("bg"))
                + "“ (" + top.confidence() + " %): " + top.reasoning());
        String caveat = "Оценката обединява архивна карта и данни за водата; тя не потвърждава текущото състояние на ливадата без подводно наблюдение."
            + (notice == null ? "" : " " + notice);
        return new Report("rules", null, a.headline(), summary, findings, plan, a.dataGaps(), caveat);
    }

    private static Answer rulesAnswer(Assessment a, String question, List<SiteRisk> sites, String notice) {
        String text = rulesText(a, question) + (notice == null ? "" : " [" + notice + "]");
        String q = question.toLowerCase(Locale.forLanguageTag("bg"));
        List<String> used = a.indicators().stream().filter(i -> i.level() == Ecology.Level.HIGH || i.level() == Ecology.Level.MODERATE)
            .map(Indicator::key).limit(3).toList();
        List<AiAction> actions = new ArrayList<>();
        if (!a.actions().isEmpty()) {
            Action first = a.actions().get(0);
            actions.add(new AiAction("add_task", first.title(), a.site().id(), first.priority(), first.why(), null));
        }
        if (q.contains("измер") || q.contains("засад")) actions.add(new AiAction("new_measurement", "Запиши теренно измерване тук", a.site().id(), null, "Теренните данни повишават увереността на оценката.", null));
        else actions.add(new AiAction("show_map", "Покажи на картата", a.site().id(), null, null, null));
        return new Answer("rules", null, text, used, actions);
    }

    private static String rulesText(Assessment a, String question) {
        String q = question.toLowerCase(Locale.forLanguageTag("bg"));
        StringBuilder sb = new StringBuilder();
        if (q.contains("засад") || q.contains("засаж") || q.contains("възстанов")) {
            boolean ok = a.indicators().stream().noneMatch(i -> i.level() == Ecology.Level.HIGH);
            sb.append(ok ? "Условията не показват силна пречка, но засаждане се препоръчва само след подводна проверка и изяснена причина за загубата."
                : "Засега не. Има висок рисков сигнал, който трябва да се изясни първо, иначе засадените растения ще срещнат същия проблем.");
        } else if (q.contains("котв") || q.contains("лодк") || q.contains("механ")) {
            a.indicators().stream().filter(i -> i.key().equals("mechanical")).findFirst()
                .ifPresent(i -> sb.append("Механичен натиск: ").append(i.value()).append(". ").append(i.explanation()));
        } else {
            sb.append(a.headline()).append(". ");
            a.causes().stream().limit(2).forEach(c -> sb.append(c.title()).append(" (").append(c.confidence()).append(" %): ").append(c.reasoning()).append(" "));
        }
        if (!a.actions().isEmpty()) sb.append(" Първа стъпка: ").append(a.actions().get(0).title()).append(".");
        sb.append(" (Отговор на експертната система. Добави GEMINI_API_KEY или ANTHROPIC_API_KEY за свободен разговор.)");
        return sb.toString().trim();
    }

    private static String severity(Ecology.Level l) {
        return switch (l) { case HIGH -> "висока"; case MODERATE -> "умерена"; case LOW -> "ниска"; default -> "неизвестна"; };
    }

    private String json(Assessment a) {
        try { return mapper.writerWithDefaultPrettyPrinter().writeValueAsString(a); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static String fingerprint(Assessment a) {
        return a.riskScore() + "|" + a.indicators().stream().map(i -> i.key() + "=" + i.value()).reduce("", String::concat);
    }

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }
}
