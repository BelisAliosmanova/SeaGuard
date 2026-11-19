package bg.seagrass.guardian.ecologist;

import bg.seagrass.guardian.measurement.MeasurementRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class EcologistEngineTests {
    @Test
    void waterUsesRiskOrderAndAlignsArchiveReadingsWithTheirMonths() throws Exception {
        var mapper = new ObjectMapper();
        var snapshot = new ClassPathResource("static/data/copernicus-coast.json");
        var archive = new ClassPathResource("static/data/zostera-bulgaria.geojson");
        var engine = new EcologistEngine(mapper, mock(SeaTemperatureClient.class),
            mock(MeasurementRepository.class), archive, snapshot);
        JsonNode source;
        try (var input = snapshot.getInputStream()) {
            source = mapper.readTree(input);
        }

        var water = engine.water();
        assertThat(water.months()).isSorted().doesNotHaveDuplicates()
            .startsWith(source.path("firstMonth").asText()).endsWith(source.path("lastMonth").asText());
        assertThat(water.sites()).hasSize(35);
        assertThat(water.sites()).extracting(Ecology.WaterSite::id)
            .containsExactlyElementsOf(engine.ranking().stream().map(Ecology.SiteRisk::id).toList());

        for (var site : water.sites()) {
            var values = site.values();
            int count = water.months().size();
            assertThat(values.lightAtDepth()).hasSize(count);
            assertThat(values.turbidity()).hasSize(count);
            assertThat(values.chlorophyll()).hasSize(count);
            Double depth = engine.site(site.id()).orElseThrow().depthLimitM();
            for (JsonNode row : source.path("sites").path(Integer.toString(site.id()))) {
                int index = water.months().indexOf(row.path("month").asText());
                assertThat(index).isNotNegative();
                if (row.path("turbidity").isNumber()) {
                    double turbidity = row.path("turbidity").asDouble();
                    assertThat(values.turbidity().get(index)).isEqualTo(turbidity);
                    assertThat(values.lightAtDepth().get(index))
                        .isEqualTo(100 * EcologistKnowledge.lightAtDepth(turbidity, depth == null ? 5 : depth));
                }
                if (row.path("chlorophyll").isNumber()) {
                    assertThat(values.chlorophyll().get(index)).isEqualTo(row.path("chlorophyll").asDouble());
                }
            }
        }
    }
}
