import "./config/env";
import { customerServiceAgentService } from "./service";

const main = async (): Promise<void> => {
  // 第一轮：商品查询（匹配实际 Chanel 数据）
  const first = await customerServiceAgentService.chat({
    tenantId: "tenant_demo",
    customerId: "user_10001",
    userId: "user_10001",
    text: "我想看看 Chanel 的包包，有黑色 Classic Flap 吗？"
  });

  console.log("\n=== 第一轮（商品查询）===");
  console.log("route:", first.route);
  console.log("reply:", first.reply);
  console.log("sessionId:", first.sessionId);
  console.log("confidence:", first.confidence);

  // 第二轮：政策咨询
  const second = await customerServiceAgentService.chat({
    tenantId: "tenant_demo",
    customerId: "user_10001",
    userId: "user_10001",
    sessionId: first.sessionId,
    text: "你们的退换货政策是什么？"
  });

  console.log("\n=== 第二轮（政策咨询）===");
  console.log("route:", second.route);
  console.log("reply:", second.reply);
  console.log("confidence:", second.confidence);
};

main().catch((error: unknown) => {
  console.error("run failed", error);
  process.exitCode = 1;
});
