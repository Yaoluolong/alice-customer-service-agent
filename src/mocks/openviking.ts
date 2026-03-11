/**
 * OpenViking 模拟接口
 * 
 * OpenViking 是一个多模态检索组件，使用 viking:// 协议管理资源。
 * 它支持 VLM (Vision Language Model) 和 Embedding 混合检索，
 * 特别适用于商品目录的递归检索场景。
 * 
 * 设计思路：
 * 1. 文件系统范式：OpenViking 使用类似文件系统的层级结构组织资源
 *    例如：viking://resources/products/clothing/winter/coats/
 * 2. L1 概览层：顶层提供快速概览，支持语义搜索
 * 3. L2 详情层：深层提供详细信息，支持精确匹配
 * 4. 混合检索：结合图像特征和文本嵌入进行联合检索
 */

import { ProductInfo, ImageContext, UserPreference, StyleProfile } from "../types";

/**
 * OpenViking 检索请求接口
 */
export interface VikingSearchRequest {
  query: string;                    // 文本查询
  imageContext?: ImageContext;      // 可选的图片上下文
  namespace: string;                // 命名空间，如 "products"
  path?: string;                    // 路径，如 "clothing/winter"
  topK?: number;                    // 返回结果数量
  filters?: Record<string, any>;    // 过滤条件
}

/**
 * OpenViking 检索结果接口
 */
export interface VikingSearchResult {
  products: ProductInfo[];
  totalFound: number;
  searchTimeMs: number;
  queryEmbedding?: number[];        // 查询的嵌入向量（调试用）
}

export interface VikingContextEntry {
  id: string;
  userId: string;
  sessionId?: string;
  content: string;
  category: string;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

/**
 * 模拟商品数据库
 * 实际项目中这些数据来自真实的商品目录
 */
const MOCK_PRODUCTS: ProductInfo[] = [
  {
    id: "prod_001",
    name: "经典红色风衣",
    category: "clothing/outerwear/trench",
    colors: ["红色", "黑色", "卡其色"],
    sizes: ["S", "M", "L", "XL"],
    price: 899,
    description: "经典款双排扣风衣，防风防水面料，适合春秋季节穿着",
    imageUrl: "viking://resources/products/clothing/outerwear/trench/red-trench-coat.jpg",
    similarityScore: 0.95
  },
  {
    id: "prod_002",
    name: "商务黑色风衣",
    category: "clothing/outerwear/trench",
    colors: ["黑色", "深灰"],
    sizes: ["M", "L", "XL", "XXL"],
    price: 1299,
    description: "商务休闲风衣，修身剪裁，适合职场穿搭",
    imageUrl: "viking://resources/products/clothing/outerwear/trench/black-business-trench.jpg",
    similarityScore: 0.88
  },
  {
    id: "prod_003",
    name: "休闲卡其色风衣",
    category: "clothing/outerwear/trench",
    colors: ["卡其色", "米色"],
    sizes: ["S", "M", "L"],
    price: 699,
    description: "休闲款单排扣风衣，轻薄透气，适合日常出行",
    imageUrl: "viking://resources/products/clothing/outerwear/trench/casual-khaki-trench.jpg",
    similarityScore: 0.82
  },
  {
    id: "prod_004",
    name: "羊毛呢大衣",
    category: "clothing/outerwear/wool",
    colors: ["驼色", "黑色", "灰色"],
    sizes: ["S", "M", "L", "XL"],
    price: 1599,
    description: "100%羊毛面料，保暖性极佳，冬季必备",
    imageUrl: "viking://resources/products/clothing/outerwear/wool/wool-coat.jpg",
    similarityScore: 0.75
  }
];

/**
 * OpenViking 客户端类
 * 
 * 模拟真实的 OpenViking 多模态检索服务
 * 实际项目中，这里会调用 OpenViking 的 REST API 或 gRPC 接口
 */
export class OpenVikingClient {
  private baseUrl: string;
  private apiKey: string;
  private contextStore: Map<string, VikingContextEntry[]> = new Map();

  constructor(baseUrl: string = "https://api.openviking.ai", apiKey: string = "mock-api-key") {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private getUserContexts(userId: string): VikingContextEntry[] {
    return this.contextStore.get(userId) || [];
  }

  async searchContext(userId: string, query: string, limit: number = 5): Promise<VikingContextEntry[]> {
    const userContexts = this.getUserContexts(userId);
    const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results = userContexts.filter((entry) => {
      const raw = `${entry.category} ${entry.content} ${JSON.stringify(entry.metadata ?? {})}`.toLowerCase();
      return queryTokens.some((token) => raw.includes(token));
    });
    results.sort((a, b) => b.updatedAt - a.updatedAt);
    return results.slice(0, limit);
  }

  async getUserPreferences(userId: string): Promise<UserPreference[]> {
    const contexts = this.getUserContexts(userId).filter((entry) => entry.category.startsWith("preference:"));
    const seen = new Set<string>();
    const prefs: UserPreference[] = [];
    for (const item of contexts) {
      try {
        const parsed = JSON.parse(item.content) as UserPreference;
        const token = `${parsed.key}:${JSON.stringify(parsed.value)}`;
        if (!seen.has(token)) {
          seen.add(token);
          prefs.push(parsed);
        }
      } catch {
        continue;
      }
    }
    return prefs;
  }

  async getUserStyleProfile(userId: string): Promise<StyleProfile | null> {
    const contexts = this.getUserContexts(userId).filter((entry) => entry.category === "style:profile");
    contexts.sort((a, b) => b.updatedAt - a.updatedAt);
    const latest = contexts[0];
    if (!latest) return null;
    try {
      return JSON.parse(latest.content) as StyleProfile;
    } catch {
      return null;
    }
  }

  async addContext(params: {
    userId: string;
    sessionId?: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    preferences: UserPreference[];
    styleProfile?: StyleProfile;
    conversationSummary?: string | null;
  }): Promise<void> {
    const now = Date.now();
    const rows = this.getUserContexts(params.userId);
    for (const pref of params.preferences) {
      rows.push({
        id: `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        userId: params.userId,
        sessionId: params.sessionId,
        content: JSON.stringify(pref),
        category: `preference:${pref.category}`,
        metadata: {
          key: pref.key,
          value: pref.value,
          confidence: pref.confidence
        },
        createdAt: now,
        updatedAt: now
      });
    }
    rows.push({
      id: `ctx_${Date.now()}_summary`,
      userId: params.userId,
      sessionId: params.sessionId,
      content:
        params.conversationSummary ??
        params.messages.map((m) => `${m.role}: ${m.content.slice(0, 120)}`).join("\n"),
      category: "conversation:summary",
      createdAt: now,
      updatedAt: now
    });
    if (params.styleProfile) {
      rows.push({
        id: `ctx_${Date.now()}_style`,
        userId: params.userId,
        sessionId: params.sessionId,
        content: JSON.stringify(params.styleProfile),
        category: "style:profile",
        createdAt: now,
        updatedAt: now
      });
    }
    this.contextStore.set(params.userId, rows);
  }

  /**
   * 多模态检索核心方法
   * 
   * 设计思路：
   * 1. 如果提供了图片，先使用 VLM 生成图片描述
   * 2. 将文本查询和图片特征融合成联合嵌入
   * 3. 在指定的 viking:// 路径下进行向量检索
   * 4. 返回最匹配的商品列表
   * 
   * @param request 检索请求
   * @returns 检索结果
   */
  async search(request: VikingSearchRequest): Promise<VikingSearchResult> {
    console.log(`[OpenViking] 开始检索: "${request.query}"`);
    console.log(`[OpenViking] 命名空间: ${request.namespace}, 路径: ${request.path || "root"}`);
    
    if (request.imageContext) {
      console.log(`[OpenViking] 包含图片上下文: ${request.imageContext.imageId}`);
      // 实际项目中，这里会调用 VLM 分析图片
      // 例如：const imageDescription = await this.vlm.describe(request.imageContext);
    }

    // 模拟异步检索延迟
    await this.simulateDelay(100 + Math.random() * 200);

    // 模拟检索逻辑：基于关键词匹配
    const query = request.query.toLowerCase();
    let results = MOCK_PRODUCTS.filter(product => {
      const matchText = `${product.name} ${product.description} ${product.colors.join(" ")}`.toLowerCase();
      return matchText.includes(query) || 
             query.includes("风衣") && product.category.includes("trench") ||
             query.includes("红色") && product.colors.includes("红色");
    });

    // 如果有图片上下文，提升视觉匹配度高的商品
    if (request.imageContext) {
      // 模拟 VLM 识别出图片是红色风衣，提升相关商品分数
      results = results.map(product => ({
        ...product,
        similarityScore: product.colors.includes("红色") && product.category.includes("trench")
          ? Math.min(1, (product.similarityScore || 0.8) + 0.1)
          : product.similarityScore
      }));
    }

    // 按相似度排序
    results.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));

    // 限制返回数量
    const topK = request.topK || 3;
    const finalResults = results.slice(0, topK);

    console.log(`[OpenViking] 检索完成，找到 ${finalResults.length} 个匹配商品`);
    finalResults.forEach(p => console.log(`  - ${p.name} (相似度: ${p.similarityScore})`));

    return {
      products: finalResults,
      totalFound: results.length,
      searchTimeMs: Math.floor(Math.random() * 100 + 50)
    };
  }

  /**
   * 目录递归检索
   * 
   * OpenViking 的特色功能：可以递归检索指定路径下的所有子目录
   * 例如：viking://resources/products/clothing/ 会检索所有服装类商品
   * 
   * @param basePath 基础路径
   * @param query 查询条件
   */
  async recursiveSearch(basePath: string, query: string): Promise<VikingSearchResult> {
    console.log(`[OpenViking] 递归检索路径: ${basePath}, 查询: "${query}"`);
    
    // 实际项目中，这里会遍历 viking:// 文件系统的目录树
    // 使用 L1 概览层快速筛选，再深入 L2 详情层精确匹配
    
    return this.search({
      query,
      namespace: "products",
      path: basePath.replace("viking://resources/products/", ""),
      topK: 5
    });
  }

  /**
   * 模拟延迟
   */
  private simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 导出单例实例
export const vikingClient = new OpenVikingClient();

export function extractPreferences(text: string): UserPreference[] {
  const preferences: UserPreference[] = [];
  const timestamp = Date.now();
  const colorKeywords = ["红色", "黑色", "白色", "蓝色", "绿色", "黄色", "紫色", "粉色", "橙色", "灰色", "卡其色", "米色", "驼色"];

  const colorMatches = text.match(new RegExp(`(${colorKeywords.join("|")})`, "g"));
  if (colorMatches) {
    const colors = colorMatches.filter((c): c is string => Boolean(c));
    if (colors.length > 0) {
      preferences.push({
        key: "preferred_colors",
        value: [...new Set(colors)],
        category: "color",
        confidence: 0.85,
        timestamp
      });
    }
  }

  const sizeMatches = text.match(/\b(XXXL|XXL|XL|L|M|S|XS)\b/gi);
  if (sizeMatches && sizeMatches.length > 0) {
    preferences.push({
      key: "preferred_sizes",
      value: [...new Set(sizeMatches.map((s) => s.toUpperCase()))],
      category: "size",
      confidence: 0.9,
      timestamp
    });
  }

  const styleKeywords = ["商务", "休闲", "经典", "简约", "时尚", "复古", "运动"];
  const styleMatches = styleKeywords.filter((keyword) => text.includes(keyword));
  if (styleMatches.length > 0) {
    preferences.push({
      key: "preferred_styles",
      value: [...new Set(styleMatches)],
      category: "style",
      confidence: 0.7,
      timestamp
    });
  }

  return preferences;
}
