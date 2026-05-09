import { HumanMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { getConfiguredModel } from "../config/models";
import { AgentState, MediaContext, TraceEntry } from "../types";
import { logger } from "../logger";

const getLastUserText = (state: AgentState): string => {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i] instanceof HumanMessage) {
      return String(state.messages[i].content ?? "");
    }
  }
  return "";
};

export const mediaDescribeNode = async (
  state: AgentState,
  _config?: RunnableConfig
): Promise<Partial<AgentState>> => {
  // 1. If media_description already set, skip VLM
  if (state.media_description) {
    const skipTrace: TraceEntry = {
      node: "media_describe",
      displayName: "Media Describe",
      output: "Skipped — description already exists",
      metadata: { skipped: true },
    };
    return { trace: [skipTrace] };
  }

  // 2. Get media from state
  const media: MediaContext | null = state.media_context ?? (
    state.image_context
      ? {
          mediaId: state.image_context.imageId,
          mediaType: "image" as const,
          base64Data: state.image_context.base64Data,
          mimeType: state.image_context.mimeType,
          description: state.image_context.description,
        }
      : null
  );

  // 3. If no media, return null
  if (!media) {
    const noMediaTrace: TraceEntry = {
      node: "media_describe",
      displayName: "Media Describe",
      output: "No media context available",
      metadata: { skipped: true, reason: "no_media" },
    };
    return { media_description: null, trace: [noMediaTrace] };
  }

  const userText = getLastUserText(state);

  // 4. Call VLM
  let description: string;
  try {
    const llm = getConfiguredModel("primary", 0);
    if (!llm) {
      description = userText || "product image";
    } else {
      const content: Array<{ type: string; [key: string]: unknown }> = [
        {
          type: "text",
          text: `Describe this product image in detail for search purposes. Include: color, material, style, brand (if visible), category. User says: '${userText}'. Respond in the same language as the user. Keep under 100 words.`,
        },
      ];

      if (media.base64Data) {
        content.unshift({
          type: "image_url",
          image_url: {
            url: `data:${media.mimeType};base64,${media.base64Data}`,
            detail: "high",
          },
        });
      } else if (media.url) {
        content.unshift({
          type: "image_url",
          image_url: { url: media.url, detail: "high" },
        });
      }

      const response = await llm.invoke([new HumanMessage({ content })]);
      description = String(response.content).trim();
    }
  } catch (err) {
    // 6. VLM failure fallback
    logger.warn({ err }, "mediaDescribeNode: VLM call failed, falling back to user text");
    description = userText || "product image";
  }

  const trace: TraceEntry = {
    node: "media_describe",
    displayName: "Media Describe",
    input: `media_type=${media.mediaType}, user="${userText.slice(0, 50)}"`,
    output: description.slice(0, 100),
    metadata: {
      descriptionLength: description.length,
      mediaType: media.mediaType,
      severity: "ok",
    },
  };

  return { media_description: description, trace: [trace] };
};
