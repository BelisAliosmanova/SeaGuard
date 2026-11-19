package bg.seagrass.guardian.ecologist;

import java.util.List;

/**
 * The ecologist's domain knowledge: screening thresholds for Black Sea seagrass (Zostera marina / Z. noltei)
 * and the context it reasons with. These are screening rules for prioritising field checks, not validated
 * ecological thresholds; each one names where it comes from so a marine biologist can adjust it.
 */
final class EcologistKnowledge {
    private EcologistKnowledge() {}

    // Light: Zostera marina needs roughly 11-20 % of surface irradiance at its depth limit
    // (Duarte 1991; Dennison et al. 1993). Below ~11 % meadows recede.
    static final double LIGHT_OK = 0.20;
    static final double LIGHT_CRITICAL = 0.11;

    /**
     * Rough empirical attenuation from satellite turbidity: Kd(PAR) ~= 0.12 + 0.065 * TUR (FNU).
     * Good enough to rank sites; a Secchi disk or PAR logger on site replaces it.
     */
    static double attenuation(double turbidityFnu) { return 0.12 + 0.065 * turbidityFnu; }

    static double lightAtDepth(double turbidityFnu, double depthM) {
        return Math.exp(-attenuation(turbidityFnu) * depthM);
    }

    // Chlorophyll-a as a eutrophication proxy, coastal Black Sea (screening bands, mg/m3).
    static final double CHL_MODERATE = 3.0;
    static final double CHL_HIGH = 6.0;

    // Heat: Z. marina growth declines above ~25 C and mortality rises with prolonged >28 C (Nejrup & Pedersen 2008).
    static final double HEAT_MODERATE = 25.0;
    static final double HEAT_HIGH = 28.0;
    /** Hours above the moderate threshold that count as a sustained (not one-off) event. */
    static final int HEAT_SUSTAINED_HOURS = 72;

    // Turbidity trend: a rise above 30 % between the early and late part of the satellite window.
    static final double TREND_WORSENING = 0.30;

    /** Ports, marinas and anchorages, approximate. Proximity is a proxy for anchoring and boating pressure. */
    record Harbour(String name, double latitude, double longitude) {}
    static final List<Harbour> HARBOURS = List.of(
        new Harbour("пристанище Варна", 43.193, 27.920),
        new Harbour("пристанище Бургас", 42.490, 27.480),
        new Harbour("Созопол", 42.420, 27.697),
        new Harbour("Несебър", 42.659, 27.733),
        new Harbour("Поморие", 42.558, 27.642),
        new Harbour("Черноморец", 42.444, 27.640),
        new Harbour("марина Св. Влас", 42.710, 27.760),
        new Harbour("Приморско", 42.268, 27.760),
        new Harbour("Царево", 42.170, 27.853),
        new Harbour("Балчик", 43.404, 28.163),
        new Harbour("Каварна", 43.412, 28.340));
    static final double HARBOUR_NEAR_KM = 1.5;
    static final double HARBOUR_MID_KM = 4.0;

    static final String SYSTEM_PROMPT = """
        Ти си AI морски еколог на системата SeaGuard за морските треви (Zostera marina, Zostera noltei) по българското
        Черноморие. Пилотната зона на проекта EfxINNOs е Созополският залив (ливади на 0,5–7 m дълбочина).

        Работиш като полеви еколог, който пише за учени, общини и екипи за опазване:
        - Опирай се САМО на подадената оценка (JSON): индикатори, стойности, прагове, източници и празноти в данните.
          Не измисляй измервания, дати, видове или проценти покритие, които ги няма.
        - Различавай ясно наблюдение, изчислена оценка и хипотеза. Архивната карта показва къде ЕДНА ливада е била
          картирана; сателитните и моделните данни описват водата, не тревата. Без нови подводни наблюдения не
          твърди, че ливадата днес е здрава, увредена или изчезнала.
        - Мисли причинно: светлина до дълбочинната граница (мътност, ресуспензия, речен отток), еутрофикация
          (хлорофил-а, хранителни вещества, сянка от фитопланктон), топлинен стрес през лятото и затопляне над
          нормата за сезона (отклонение от +2 °C за няколко поредни дни е морска гореща вълна, опасна дори под 25 °C), механично
          увреждане (котви, тралене, драгиране, строителство), и как се усилват взаимно.
        - Препоръките са конкретни и проверими: какво да се измери или направи, къде, защо, и по какво ще разберем,
          че е помогнало. Засаждане/възстановяване се препоръчва само когато причината е изяснена и условията го
          позволяват. Намеси в реалната среда изискват одобрение от морски биолог.
        - Отбелязвай какво не знаем и какви данни биха променили извода (ROV/AUV видео, PAR/Secchi, сонда, водолаз).
        Пиши на български, ясно и стегнато, без маркетингов тон и без емоджи.
        """;
}
