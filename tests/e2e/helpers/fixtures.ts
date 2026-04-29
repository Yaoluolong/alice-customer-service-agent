import type { ChatRequest } from "./chat-client";

export const makeChatInput = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  tenantId: overrides.tenantId ?? "tenant_test_001",
  customerId: overrides.customerId ?? "cust_test_001",
  userId: overrides.userId ?? "cust_test_001",
  text: overrides.text ?? "你好",
  ...overrides
});

export const greetingInput = (): ChatRequest => makeChatInput({ text: "你好" });

export const productInquiryInput = (): ChatRequest =>
  makeChatInput({ text: "红色风衣有M码吗" });

export const orderStatusInput = (): ChatRequest =>
  makeChatInput({ text: "我的订单到哪了，快递还没到" });

export const mediaInput = (): ChatRequest =>
  makeChatInput({
    text: "[media]",
    media: {
      mediaId: "media_001",
      mediaType: "image" as const,
      base64Data: "dGVzdA==",
      mimeType: "image/jpeg",
      description: "A red coat"
    }
  });

export const imageContextInput = (): ChatRequest =>
  makeChatInput({
    text: "[media]",
    image: {
      imageId: "img_001",
      base64Data: "dGVzdA==",
      mimeType: "image/jpeg",
      description: "A red coat"
    }
  });

export const audioInput = (): ChatRequest =>
  makeChatInput({
    text: "红色风衣有M码吗",
    // No media context — audio is transcribed to text by the worker before reaching the service
  });
