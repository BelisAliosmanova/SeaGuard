package bg.seagrass.guardian.community;

import bg.seagrass.guardian.ecologist.EcologistEngine;
import bg.seagrass.guardian.ecologist.Ecology.MonthPoint;
import bg.seagrass.guardian.ecologist.Ecology.Site;
import bg.seagrass.guardian.field.FieldTask;
import bg.seagrass.guardian.field.FieldTaskRepository;
import bg.seagrass.guardian.measurement.JpegFrame;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.ui.Model;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static bg.seagrass.guardian.community.CommunityTopic.Category;
import static bg.seagrass.guardian.community.CommunityPost.Metric;
import static bg.seagrass.guardian.community.CommunityPostRepository.Preview;

@Controller
public class CommunityController {
    private static final String TOPICS = "/api/community/topics";
    private static final String POST_HEADER = "X-Blue-Root-Community=1";
    private static final PageRequest POST_PAGE = PageRequest.of(0, 30);
    private final CommunityTopicRepository topics;
    private final CommunityPostRepository posts;
    private final FieldTaskRepository tasks;
    private final EcologistEngine engine;

    public CommunityController(CommunityTopicRepository topics, CommunityPostRepository posts,
                               FieldTaskRepository tasks, EcologistEngine engine) {
        this.topics = topics;
        this.posts = posts;
        this.tasks = tasks;
        this.engine = engine;
    }

    @GetMapping("/community")
    public String page(Model model) {
        model.addAttribute("sites", engine.sites().stream().sorted(Comparator.comparing(Site::name)).toList());
        model.addAttribute("categories", Arrays.stream(Category.values())
            .map(category -> new Choice(category.name(), category.label)).toList());
        model.addAttribute("metrics", Arrays.stream(Metric.values())
            .map(metric -> new Choice(metric.name(), metric.label)).toList());
        return "community";
    }

    @GetMapping(TOPICS)
    @ResponseBody
    public TopicPage list(@RequestParam(required = false) Category category,
                          @RequestParam(required = false) Integer siteId,
                          @RequestParam(defaultValue = "0") int page) {
        if (page < 0 || page > 1000) throw badRequest("Невалидна страница.");
        var found = topics.search(category, siteId, PageRequest.of(page, 24));
        return new TopicPage(found.map(this::card).getContent(), found.hasNext());
    }

    @GetMapping(TOPICS + "/{id}")
    @ResponseBody
    @Transactional(readOnly = true)
    public Discussion detail(@PathVariable long id, @RequestParam(required = false) Long before) {
        var topic = topics.findById(id).orElseThrow(CommunityController::missingTopic);
        var responses = posts.findByTopicIdAndIdLessThanOrderByIdDesc(id,
            before == null ? Long.MAX_VALUE : before, POST_PAGE);
        var task = topic.taskId == null ? null : tasks.findById(topic.taskId).orElse(null);
        return new Discussion(card(topic), responses.getContent().reversed().stream().map(this::post).toList(),
            responses.hasNext() ? responses.getContent().getLast().getId() : null, taskView(task));
    }

    @PostMapping(value = TOPICS, consumes = MediaType.MULTIPART_FORM_DATA_VALUE, headers = POST_HEADER)
    @ResponseStatus(HttpStatus.CREATED)
    @ResponseBody
    @Transactional
    public Created create(@RequestParam String title, @RequestParam Category category,
                          @RequestParam(required = false) Integer siteId, @RequestParam(defaultValue = "false") boolean investigation,
                          @RequestParam String author, @RequestParam String message,
                          @RequestParam(required = false) Metric metric, @RequestParam(required = false) MultipartFile photo) {
        if (investigation && siteId == null) throw badRequest("Избери участък за разследването.");
        if (siteId != null) site(siteId);
        var topic = new CommunityTopic(text(title, 120, "Заглавието"), category, siteId, investigation);
        var opening = newPost(topic, author, message, metric, photo);
        topics.save(topic);
        posts.save(opening);
        return new Created(topic.id);
    }

    @PostMapping(value = TOPICS + "/{id}/posts", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, headers = POST_HEADER)
    @ResponseStatus(HttpStatus.CREATED)
    @ResponseBody
    @Transactional
    public Created reply(@PathVariable long id, @RequestParam String author, @RequestParam String message,
                         @RequestParam(required = false) Metric metric, @RequestParam(required = false) MultipartFile photo) {
        var topic = topics.forUpdate(id).orElseThrow(CommunityController::missingTopic);
        var post = posts.save(newPost(topic, author, message, metric, photo));
        topic.addReply();
        return new Created(post.id);
    }

    @GetMapping(value = TOPICS + "/{id}/posts/{postId}/photo", produces = MediaType.IMAGE_JPEG_VALUE)
    @ResponseBody
    public ResponseEntity<byte[]> photo(@PathVariable long id, @PathVariable long postId) {
        var jpeg = posts.findPhoto(id, postId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG)
            .header("X-Content-Type-Options", "nosniff")
            .cacheControl(CacheControl.maxAge(Duration.ofHours(1)).cachePrivate())
            .body(jpeg);
    }

    @GetMapping(TOPICS + "/{id}/summary")
    @ResponseBody
    @Transactional(readOnly = true)
    public Summary summary(@PathVariable long id) {
        var topic = topics.findById(id).orElseThrow(CommunityController::missingTopic);
        requireInvestigation(topic);
        var opening = posts.findFirstByTopicIdOrderByIdAsc(id).orElseThrow(CommunityController::missingTopic);
        var recent = posts.findByTopicIdAndIdLessThanOrderByIdDesc(id, Long.MAX_VALUE, PageRequest.of(0, 12)).getContent();
        var quoted = new HashSet<String>();
        quoted.add(opening.getMessage().strip());
        var notes = recent.stream().filter(entry -> entry.getId() != opening.getId())
            .filter(entry -> quoted.add(entry.getMessage().strip())).limit(3).map(this::quote).toList().reversed();
        var readings = Stream.concat(Stream.of(opening), recent.stream().filter(entry -> entry.getId() != opening.getId()))
            .filter(entry -> entry.getMetric() != null).limit(3).map(this::reading).toList();
        long frames = posts.countByTopicIdAndHasPhotoTrue(id);
        return new Summary(quote(opening), notes, readings, frames, topic.replies,
            "Публикациите са наблюдения от участници. За снимките са нужни потвърдени място и дата.",
            nextStep(topic.category));
    }

    @PostMapping(value = TOPICS + "/{id}/task", headers = POST_HEADER)
    @ResponseBody
    @Transactional
    public TaskView saveTask(@PathVariable long id) {
        var topic = topics.forUpdate(id).orElseThrow(CommunityController::missingTopic);
        requireInvestigation(topic);
        var previous = topic.taskId == null ? null : tasks.findById(topic.taskId).orElse(null);
        if (previous != null) return taskView(previous);
        var site = site(topic.siteId);
        FieldTask task = new FieldTask();
        task.setSiteId(site.id());
        task.setSiteName(site.name());
        task.setTitle("Проверка от общността · " + topic.title);
        task.setPriority("Среден");
        task.setReason(nextStep(topic.category));
        task.setOrigin("user");
        tasks.save(task);
        topic.taskId = task.getId();
        topic.updatedAt = Instant.now();
        return taskView(task);
    }

    private CommunityPost newPost(CommunityTopic topic, String author, String message, Metric metric, MultipartFile photo) {
        String name = text(author, 45, "Името");
        String body = text(message, 1600, "Съобщението");
        var point = metric == null ? null : latest(topic.siteId, metric);
        byte[] jpeg = photo == null || photo.isEmpty() ? null : JpegFrame.read(photo);
        return new CommunityPost(topic, name, body, metric, point == null ? null : point.month(),
            point == null ? null : value(point, metric), jpeg);
    }

    private MonthPoint latest(Integer siteId, Metric metric) {
        if (siteId == null) throw badRequest("Избери участък, за да добавиш показател.");
        return engine.coastalTrend(siteId).reversed().stream().filter(point -> value(point, metric) != null).findFirst()
            .orElseThrow(() -> badRequest("За този участък няма данни за избрания показател. Можеш да публикуваш без него."));
    }

    private static Double value(MonthPoint point, Metric metric) {
        return metric == Metric.TURBIDITY ? point.turbidity() : point.chlorophyll();
    }

    private Site site(int id) {
        return engine.site(id).orElseThrow(() -> badRequest("Участъкът не е намерен."));
    }

    private TopicCard card(CommunityTopic topic) {
        String siteName = topic.siteId == null ? null : engine.site(topic.siteId).map(Site::name).orElse(null);
        return new TopicCard(topic.id, topic.title, topic.category.label, topic.siteId, siteName,
            topic.investigation, topic.replies, topic.updatedAt);
    }

    private PostView post(Preview entry) {
        return new PostView(entry.getId(), entry.getAuthor(), entry.getMessage(), entry.getCreatedAt(),
            entry.getHasPhoto(), entry.getMetric() == null ? null : reading(entry));
    }

    private Reading reading(Preview entry) {
        return new Reading(entry.getId(), entry.getMetric().label, entry.getMetricValue(), entry.getMetric().unit,
            entry.getMetricMonth(), "Copernicus Marine");
    }

    private Quote quote(Preview entry) {
        String message = entry.getMessage();
        if (message.codePointCount(0, message.length()) > 240) {
            message = message.substring(0, message.offsetByCodePoints(0, 220)).stripTrailing() + "…";
        }
        return new Quote(entry.getId(), entry.getAuthor(), message);
    }

    private static TaskView taskView(FieldTask task) {
        return task == null ? null : new TaskView(task.getId(), task.isDone());
    }

    private static String nextStep(Category category) {
        return switch (category) {
            case WATER -> "Измерете видимостта на място и запишете координати, час и дълбочина. Сравнете с повторно измерване при сходни условия.";
            case SEAGRASS -> "Заснемете общ план на дъното и близък план на листата по един маршрут. Запишете координати, дата и дълбочина.";
            case OBSERVATIONS, GENERAL -> "Повторете наблюдението на място. Запишете координати, дата и дълбочина и заснемете кадър за сравнение.";
        };
    }

    private static void requireInvestigation(CommunityTopic topic) {
        if (!topic.investigation) throw badRequest("Избери разследване на участък.");
    }

    private static String text(String input, int max, String label) {
        String value = input.strip();
        if (value.isEmpty() || value.length() > max) {
            throw badRequest(label + " трябва да е между 1 и " + max + " знака.");
        }
        return value;
    }

    private static ResponseStatusException missingTopic() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Темата не е намерена.");
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    @ExceptionHandler(ResponseStatusException.class)
    @ResponseBody
    ResponseEntity<Map<String, String>> statusError(ResponseStatusException error) {
        String message = error.getReason() == null ? "Записът не е намерен." : error.getReason();
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("message", message));
    }

    @ExceptionHandler({MethodArgumentTypeMismatchException.class, MissingServletRequestParameterException.class})
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ResponseBody
    Map<String, String> invalidInput() { return Map.of("message", "Провери попълнените полета."); }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    @ResponseStatus(HttpStatus.PAYLOAD_TOO_LARGE)
    @ResponseBody
    Map<String, String> largeImage() { return Map.of("message", "Снимката е прекалено голяма."); }

    public record Choice(String value, String label) {}
    record Created(long id) {}
    record TopicCard(long id, String title, String category, Integer siteId, String siteName,
                     boolean investigation, int replies, Instant updatedAt) {}
    record TopicPage(List<TopicCard> topics, boolean hasMore) {}
    record Discussion(TopicCard topic, List<PostView> posts, Long before, TaskView task) {}
    record PostView(long id, String author, String message, Instant createdAt, boolean hasPhoto, Reading reading) {}
    record Reading(long postId, String label, double value, String unit, String month, String source) {}
    record Quote(long postId, String author, String excerpt) {}
    record Summary(Quote opening, List<Quote> notes, List<Reading> readings, long photos, int replies,
                   String limitations, String nextStep) {}
    record TaskView(long id, boolean done) {}
}
