package bg.seagrass.guardian.field;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

@Component
class FieldMissionPlanner {
    record Coordinate(double latitude, double longitude) {}
    private record Point(double x, double y) {}
    private record Edge(Point a, Point b) {
        Point nearest(Point point) {
            double dx = b.x - a.x;
            double dy = b.y - a.y;
            double lengthSquared = dx * dx + dy * dy;
            if (lengthSquared == 0) return a;
            double fraction = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
            fraction = Math.max(0, Math.min(1, fraction));
            return new Point(a.x + fraction * dx, a.y + fraction * dy);
        }
    }
    private record Sample(Point interior, Point boundary, double clearanceSquared) {}

    private final Map<Integer, JsonNode> geometryBySite;

    FieldMissionPlanner(ObjectMapper mapper, @Value("classpath:static/data/zostera-bulgaria.geojson") Resource archive)
        throws IOException {
        Map<Integer, JsonNode> geometries = new HashMap<>();
        try (var input = archive.getInputStream()) {
            for (JsonNode feature : mapper.readTree(input).path("features")) {
                geometries.put(feature.path("id").asInt(), feature.path("geometry"));
            }
        }
        geometryBySite = Map.copyOf(geometries);
    }

    List<Coordinate> locations(int siteId) {
        JsonNode geometry = geometryBySite.get(siteId);
        if (geometry == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Участъкът не е намерен.");

        JsonNode coordinates = geometry.path("coordinates");
        List<JsonNode> polygons = new ArrayList<>();
        switch (geometry.path("type").asText()) {
            case "Polygon" -> polygons.add(coordinates);
            case "MultiPolygon" -> coordinates.forEach(polygons::add);
            default -> { }
        }

        Sample best = null;
        double longitudeScale = 1;
        for (JsonNode polygon : polygons) {
            double latitude = polygon.path(0).path(0).path(1).asDouble();
            double scale = Math.cos(Math.toRadians(latitude));
            Sample sample = sample(polygon, scale);
            if (sample != null && (best == null || sample.clearanceSquared > best.clearanceSquared)) {
                best = sample;
                longitudeScale = scale;
            }
        }
        if (best == null) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                "Архивният контур не позволява да се предложат две точки.");
        }

        // Leave a margin inside the outline instead of placing the first point on the boundary.
        Point inner = best.interior;
        Point boundary = best.boundary;
        Point edge = new Point(inner.x + .8 * (boundary.x - inner.x), inner.y + .8 * (boundary.y - inner.y));
        return List.of(new Coordinate(edge.y, edge.x / longitudeScale), new Coordinate(inner.y, inner.x / longitudeScale));
    }

    private static Sample sample(JsonNode polygon, double longitudeScale) {
        List<Edge> edges = new ArrayList<>();
        var latitudes = new TreeSet<Double>();
        for (JsonNode ring : polygon) {
            Point previous = null;
            Point first = null;
            for (JsonNode vertex : ring) {
                var point = new Point(vertex.path(0).asDouble() * longitudeScale, vertex.path(1).asDouble());
                latitudes.add(point.y);
                if (previous != null) edges.add(new Edge(previous, point));
                else first = point;
                previous = point;
            }
            if (previous != null && !previous.equals(first)) edges.add(new Edge(previous, first));
        }

        // Scan between vertex latitudes. Alternating intersection pairs are inside, including with holes.
        List<Double> levels = new ArrayList<>(latitudes);
        Sample best = null;
        for (int level = 1; level < levels.size(); level++) {
            double y = (levels.get(level - 1) + levels.get(level)) / 2;
            var crossings = new ArrayList<Double>();
            for (Edge edge : edges) {
                if ((edge.a.y > y) != (edge.b.y > y)) {
                    crossings.add(edge.a.x + (y - edge.a.y) * (edge.b.x - edge.a.x) / (edge.b.y - edge.a.y));
                }
            }
            crossings.sort(Double::compare);
            for (int i = 1; i < crossings.size(); i += 2) {
                double left = crossings.get(i - 1);
                double right = crossings.get(i);
                if (right <= left) continue;
                for (int quarter = 1; quarter <= 3; quarter++) {
                    Sample candidate = measure(new Point(left + quarter * (right - left) / 4, y), edges);
                    if (best == null || candidate.clearanceSquared > best.clearanceSquared) best = candidate;
                }
            }
        }
        return best;
    }

    private static Sample measure(Point point, List<Edge> edges) {
        Point boundary = null;
        double bestDistance = Double.POSITIVE_INFINITY;
        for (Edge edge : edges) {
            Point near = edge.nearest(point);
            double dx = near.x - point.x;
            double dy = near.y - point.y;
            double distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
                bestDistance = distance;
                boundary = near;
            }
        }
        return new Sample(point, boundary, bestDistance);
    }
}
