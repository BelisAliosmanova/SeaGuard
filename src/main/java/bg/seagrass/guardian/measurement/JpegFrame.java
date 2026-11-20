package bg.seagrass.guardian.measurement;

import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import javax.imageio.ImageIO;
import java.io.IOException;
import java.io.InputStream;

public final class JpegFrame {
    private JpegFrame() {}

    public static byte[] read(MultipartFile frame) {
        try (InputStream input = frame.getInputStream(); var image = ImageIO.createImageInputStream(input)) {
            if (image != null) {
                var readers = ImageIO.getImageReaders(image);
                if (readers.hasNext()) {
                    var reader = readers.next();
                    try {
                        reader.setInput(image);
                        if ("JPEG".equalsIgnoreCase(reader.getFormatName()) && reader.getWidth(0) <= 1000
                            && reader.getHeight(0) <= 1000) {
                            reader.read(0);
                            return frame.getBytes();
                        }
                    } finally {
                        reader.dispose();
                    }
                }
            }
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Кадърът е повреден.");
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Кадърът трябва да е JPEG с размер до 1000 × 1000 px.");
    }
}
