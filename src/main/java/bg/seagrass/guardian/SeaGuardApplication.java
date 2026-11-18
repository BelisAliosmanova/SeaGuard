package bg.seagrass.guardian;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@org.springframework.scheduling.annotation.EnableScheduling
public class SeaGuardApplication {
    public static void main(String[] args) {
        SpringApplication.run(SeaGuardApplication.class, args);
    }
}
