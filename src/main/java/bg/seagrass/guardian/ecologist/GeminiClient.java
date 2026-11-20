package bg.seagrass.guardian.ecologist;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Google Gemini via its REST API (generateContent). Enabled when GEMINI_API_KEY (or GOOGLE_API_KEY) is set;
 * a free key comes from Google AI Studio. Only the computed assessment is sent, never raw user files.
 */
@Component
class GeminiClient {
    static class GeminiException extends Exception {
        final boolean retryable;
        GeminiException(String message, boolean retryable) { super(message); this.retryable = retryable; }
    }

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
    private final ObjectMapper mapper;
    private final String apiKey;
    private final String model;

    private final String fallbackModel;

    GeminiClient(ObjectMapper mapper, @Value("${seaguard.ai.gemini-model:gemini-3.5-flash}") String model,
                 @Value("${seaguard.ai.gemini-fallback-model:gemini-3.5-flash-lite}") String fallbackModel,
                 @Value("${seaguard.ai.gemini-key:}") String configuredKey) {
        this.mapper = mapper;
        this.model = model;
        this.fallbackModel = fallbackModel;
        // secrets.properties (git-ignored) first, then the environment.
        String key = configuredKey;
        if (key == null || key.isBlank()) key = System.getenv("GEMINI_API_KEY");
        if (key == null || key.isBlank()) key = System.getenv("GOOGLE_API_KEY");
        this.apiKey = key == null || key.isBlank() ? null : key.trim();
    }

    boolean enabled() { return apiKey != null; }
    String model() { return model; }

    /**
     * @param turns alternating {"role": "user"|"assistant", "text": ...}; the last one must be the user's.
     * @param json  ask for a JSON-only response
     */
    String generate(String system, List<Map<String, String>> turns, boolean json) throws GeminiException {
        List<Map<String, Object>> contents = new ArrayList<>();
        for (var t : turns) {
            String role = "assistant".equals(t.get("role")) ? "model" : "user";
            contents.add(Map.of("role", role, "parts", List.of(Map.of("text", t.get("text")))));
        }
        var config = new java.util.LinkedHashMap<String, Object>();
        config.put("temperature", 0.3);
        config.put("maxOutputTokens", 8192);
        if (json) config.put("responseMimeType", "application/json");
        var body = Map.of(
            "systemInstruction", Map.of("parts", List.of(Map.of("text", system))),
            "contents", contents,
            "generationConfig", config);
        // Retry the main model on overload, then fall back to a lighter model before giving up.
        GeminiException last = null;
        String[] plan = {model, model, fallbackModel, "gemini-2.5-flash"};
        for (int attempt = 0; attempt < plan.length; attempt++) {
            if (plan[attempt] == null || plan[attempt].isBlank()) continue;
            try {
                return call(plan[attempt], body);
            } catch (GeminiException e) {
                last = e;
                if (!e.retryable) throw e;
                try { Thread.sleep(700L * (attempt + 1)); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); throw e; }
            }
        }
        throw last;
    }

    private String call(String modelName, Object body) throws GeminiException {
        try {
            String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                + URLEncoder.encode(modelName, StandardCharsets.UTF_8) + ":generateContent";
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(90))
                .header("Content-Type", "application/json")
                .header("x-goog-api-key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            JsonNode root = mapper.readTree(response.body());
            int status = response.statusCode();
            if (status != 200) {
                // 404 shows up intermittently for valid models, so it is retried like an overload.
                boolean busy = status == 404 || status == 429 || status >= 500;
                System.err.println("Gemini " + modelName + " HTTP " + status + ": " + root.path("error").path("message").asText(""));
                throw new GeminiException(busy ? "Gemini е претоварен в момента." : "Gemini отказа заявката (" + status + ").", busy);
            }
            StringBuilder text = new StringBuilder();
            for (JsonNode part : root.path("candidates").path(0).path("content").path("parts")) {
                if (part.path("thought").asBoolean(false)) continue;
                text.append(part.path("text").asText(""));
            }
            if (text.isEmpty()) throw new GeminiException("Gemini не върна текст.", true);
            return text.toString().trim();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new GeminiException("Заявката към Gemini беше прекъсната.", false);
        } catch (java.io.IOException e) {
            throw new GeminiException("Няма връзка с Gemini.", true);
        }
    }
}
