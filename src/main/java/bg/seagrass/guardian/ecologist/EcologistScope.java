package bg.seagrass.guardian.ecologist;

import bg.seagrass.guardian.ecologist.Ecology.Answer;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

final class EcologistScope {
    private static final Pattern SUBJECT = Pattern.compile("""
        (?Ux) \\b(?:
            seaguard | blue\\ root | pickle | seagrass | zostera | turbidity | eutrophication | chlorophyll | copernicus | seanoe |
            черно\\ море | морск\\p{L}* | ливад\\p{L}* | зостер\\p{L}* | водорасл\\p{L}* |
            еколог\\p{L}* | биоразнообраз\\p{L}* | подвод\\p{L}* | мътн\\p{L}* | хлорофил\\p{L}* |
            еутрофикац\\p{L}* | фитопланктон\\p{L}* |
            топлин\\p{L}*\\ стрес | горещ\\p{L}*\\ вълн\\p{L}* | температур\\p{L}*\\ аномали\\p{L}* |
            температур\\p{L}*\\ на\\ водата | разтворен\\ кислород | светлин\\p{L}*\\ до\\ дъното | котв\\p{L}* | закотв\\p{L}* |
            трал\\p{L}* | драгиран\\p{L}* | пристанищ\\p{L}* | марин[аи] |
            теренн\\p{L}* | гмуркан\\p{L}* | засажд\\p{L}* | възстановяван\\p{L}* |
            участъ\\p{L}*
        )\\b
        """);
    private static final Pattern NUTRIENTS = Pattern.compile(
        "(?U)\\b(?:хранителн\\p{L}* веществ\\p{L}*|нутриент\\p{L}*|nutrients?)\\b");
    private static final Pattern CLEARLY_UNRELATED = Pattern.compile(
        "(?U)\\b(?:столиц\\p{L}*|capital city|capital of)\\b");
    private static final Pattern SITE_QUESTION = Pattern.compile("""
        (?Ux) (?:
            какво\\ да\\ направим\\ първо | можем\\ ли\\ да\\ засаждаме\\ тук |
            какъв\\ е\\ рискът(?:\\ тук)? | защо\\ рискът\\ е\\ (?:нисък|висок|повишен) |
            как\\ (?:оценявате|изчислявате)\\ риска |
            (?:какви|кои)\\ са\\ (?:рисковите\\ сигнали|заплахите|вероятните\\ причини) |
            какво\\ показва\\ оценката | каква\\ е\\ увереността |
            (?:откъде|от\\ къде)\\ (?:са|идват)\\ данните |
            какви\\ данни\\ (?:имаме|липсват)(?:\\ тук)? |
            какво\\ (?:да\\ измерим|да\\ проверим)(?:\\ тук)? |
            (?:каква\\ е|колко\\ е)\\ температурата\\ тук |
            колко\\ (?:дълбоко|дълбока)\\ е\\ тук
        )
        """);
    private static final Pattern FOLLOW_UP = Pattern.compile("""
        (?Ux) (?:а\\ )?(?:
            защо(?:\\ така)? | как\\ точно | и\\ после | какво\\ следва |
            какво\\ означава\\ това | можеш\\ ли\\ да\\ обясниш(?:\\ това)? |
            може\\ ли\\ (?:пример|по\\ подробно) | може\\ ли\\ по\\ просто |
            откъде\\ знаем\\ това | доколко\\ сме\\ сигурни
        )
        """);
    private static final Pattern SEPARATORS = Pattern.compile("[^\\p{L}\\p{N}]+");

    private EcologistScope() {}

    static boolean allows(String question, List<Map<String, String>> history) {
        String normalized = normalize(question);
        if (onTopic(normalized)) return true;
        if (!FOLLOW_UP.matcher(normalized).matches()) return false;

        for (int i = history.size() - 1; i >= Math.max(0, history.size() - 6); i--) {
            Map<String, String> turn = history.get(i);
            if (turn == null || !"user".equals(turn.get("role")) || turn.get("text") == null) continue;
            String previous = normalize(turn.get("text"));
            if (!FOLLOW_UP.matcher(previous).matches()) return onTopic(previous);
        }
        return false;
    }

    private static boolean onTopic(String normalized) {
        return !CLEARLY_UNRELATED.matcher(normalized).find()
            && (SUBJECT.matcher(normalized).find() || NUTRIENTS.matcher(normalized).find()
                || SITE_QUESTION.matcher(normalized).matches());
    }

    static boolean mentionsNutrients(String question) {
        return NUTRIENTS.matcher(normalize(question)).find();
    }

    private static String normalize(String text) {
        return SEPARATORS.matcher(Normalizer.normalize(text, Normalizer.Form.NFC).toLowerCase(Locale.ROOT))
            .replaceAll(" ").strip();
    }

    static Answer redirect() {
        return new Answer("scope", null,
            "Аз съм Pickle. Отговарям на въпроси за морските ливади, екологичния риск и теренните проверки в Blue root. "
                + "Пример за въпрос е „Какво показва мътността тук?“", List.of(), List.of());
    }
}
