import "./config/env";
import { customerServiceAgentService } from "./service";
import { ImageContext } from "./types";

const main = async (): Promise<void> => {
  const image: ImageContext = {
    imageId: "img_red_trench_001",
    filePath: "/tmp/red-trench.png",
    mimeType: "image/png"
  };

  const first = await customerServiceAgentService.chat({
    userId: "user_10001",
    text: "[上传了一张红色风衣图片] 这个有红色的吗？我平时穿M码。",
    image
  });

  console.log("\n=== 第一轮 ===");
  console.log(first);

  const second = await customerServiceAgentService.chat({
    userId: "user_10001",
    sessionId: first.sessionId,
    text: "那订单 ORD-20260308-1001 现在到哪了？"
  });

  console.log("\n=== 第二轮 ===");
  console.log(second);
};

main().catch((error: unknown) => {
  console.error("run failed", error);
  process.exitCode = 1;
});
