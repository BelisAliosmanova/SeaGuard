package bg.seagrass.guardian.community;

import bg.seagrass.guardian.ecologist.EcologistEngine;
import bg.seagrass.guardian.ecologist.Ecology.MonthPoint;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.util.List;

@Component
@Profile("h2")
class CommunityDemoData implements ApplicationRunner {
    private final CommunityTopicRepository topics;
    private final CommunityPostRepository posts;
    private final EcologistEngine engine;
    private final ObjectMapper mapper;
    private final Resource examples;

    CommunityDemoData(CommunityTopicRepository topics, CommunityPostRepository posts, EcologistEngine engine,
                      ObjectMapper mapper, @Value("classpath:community-demo.json") Resource examples) {
        this.topics = topics;
        this.posts = posts;
        this.engine = engine;
        this.mapper = mapper;
        this.examples = examples;
    }

    @Override
    @Transactional(rollbackFor = IOException.class)
    public void run(ApplicationArguments args) throws IOException {
        if (topics.count() != 0) return;
        try (var input = examples.getInputStream()) {
            for (DemoTopic demo : mapper.readValue(input, DemoTopic[].class)) {
                if (demo.siteId() != null && engine.site(demo.siteId()).isEmpty()) continue;
                var topic = topics.save(new CommunityTopic(demo.title(), demo.category(), demo.siteId(), demo.investigation()));
                for (int index = 0; index < demo.posts().size(); index++) {
                    posts.save(post(topic, demo.posts().get(index)));
                    if (index > 0) topic.addReply();
                }
            }
        }
    }

    private CommunityPost post(CommunityTopic topic, DemoPost demo) throws IOException {
        var point = latest(topic.siteId, demo.metric());
        var metric = point == null ? null : demo.metric();
        return new CommunityPost(topic, demo.author(), demo.message(), metric, point == null ? null : point.month(),
            metric == null ? null : value(point, metric), photo(demo.photo()));
    }

    private MonthPoint latest(Integer siteId, CommunityPost.Metric metric) {
        if (siteId == null || metric == null) return null;
        return engine.coastalTrend(siteId).reversed().stream()
            .filter(point -> value(point, metric) != null).findFirst().orElse(null);
    }

    private static Double value(MonthPoint point, CommunityPost.Metric metric) {
        return switch (metric) {
            case TURBIDITY -> point.turbidity();
            case CHLOROPHYLL -> point.chlorophyll();
        };
    }

    private static byte[] photo(String file) throws IOException {
        if (file == null) return null;
        try (var input = new ClassPathResource("community-demo/" + file).getInputStream()) {
            return input.readAllBytes();
        }
    }

    record DemoTopic(String title, CommunityTopic.Category category, Integer siteId, boolean investigation,
                     List<DemoPost> posts) {}
    record DemoPost(String author, String message, CommunityPost.Metric metric, String photo) {}
}
