#!/usr/bin/env ts-node
/**
 * seed-openviking.ts
 * 从 Railway PostgreSQL 导出商品数据，生成 Markdown，上传到 OpenViking。
 * 一次性脚本，不入生产代码。
 *
 * 用法：
 *   cd Alice
 *   npx ts-node --project tsconfig.scripts.json scripts/seed-openviking.ts [--limit 20] [--dry-run]
 */

import axios, { AxiosInstance } from "axios";
import FormData from "form-data";
import { Client } from "pg";

// ─── 配置 ───────────────────────────────────────────────────────────────────

const PG_URL =
  process.env.SEED_PG_URL ||
  "postgresql://postgres:CuSQTZVTtNtylgucLZvweBsKcmwEvAOz@switchback.proxy.rlwy.net:23489/railway";

const OV_BASE = process.env.OPENVIKING_BASE_URL || "http://127.0.0.1:1933";
const OV_TENANT = process.env.OV_TENANT || "tenant_demo";
const OV_API_KEY = process.env.OPENVIKING_API_KEY || "";

const BATCH_SIZE = 5;
const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 20;
})();
const DRY_RUN = process.argv.includes("--dry-run");

// ─── 类型 ───────────────────────────────────────────────────────────────────

interface ProductRow {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  category: string | null;
  material: string | null;
  color: string | null;
  size: string | null;
  hardware: string | null;
  closure: string | null;
  interior: string | null;
  strap: string | null;
  made_in: string | null;
  model_no: string | null;
  series: string | null;
  price_good: string | null;
  price_normal: string | null;
  price_premium_min: string | null;
  price_premium_max: string | null;
  images: string;
}

// ─── OV HTTP 客户端 ──────────────────────────────────────────────────────────

function buildOvClient(): AxiosInstance {
  const headers: Record<string, string> = {
    "X-OpenViking-Account": OV_TENANT,
    "X-OpenViking-User": "system",
    "X-OpenViking-Agent": "alice",
  };
  if (OV_API_KEY) headers["X-Api-Key"] = OV_API_KEY;
  return axios.create({
    baseURL: OV_BASE,
    timeout: 60_000,
    headers,
  });
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function slugify(brand: string | null, name: string, id: string): string {
  const base = `${brand ?? ""}-${name}`
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base}-${id.slice(0, 8)}`;
}

function formatPrice(p: string | null): string {
  if (!p) return "—";
  const n = parseFloat(p);
  return isNaN(n) ? "—" : `¥${n.toLocaleString("zh-CN")}`;
}

function buildMarkdown(p: ProductRow): string {
  const title = [p.brand, p.name].filter(Boolean).join(" ");
  const images = p.images
    ? p.images
        .split("|||")
        .filter(Boolean)
        .slice(0, 3)
        .map((url, i) => `![图${i + 1}](${url})`)
        .join("\n")
    : "";

  const lines: string[] = [
    `# ${title}`,
    "",
  ];

  const meta: [string, string | null][] = [
    ["品牌", p.brand],
    ["系列", p.series],
    ["型号", p.model_no],
    ["分类", p.category],
    ["材质", p.material],
    ["颜色", p.color],
    ["尺寸", p.size],
    ["五金", p.hardware],
    ["闭合方式", p.closure],
    ["内部", p.interior],
    ["背带", p.strap],
    ["产地", p.made_in],
  ];

  for (const [label, val] of meta) {
    if (val) lines.push(`- **${label}**: ${val}`);
  }

  if (p.description) {
    lines.push("", "## 描述", "", p.description);
  }

  lines.push(
    "",
    "## 价格",
    "",
    `- 良好成色：${formatPrice(p.price_good)}`,
    `- 普通成色：${formatPrice(p.price_normal)}`,
    `- 高级成色：${formatPrice(p.price_premium_min)} ~ ${formatPrice(p.price_premium_max)}`
  );

  if (images) {
    lines.push("", "## 图片", "", images);
  }

  return lines.join("\n");
}

// ─── OV 上传流程 ─────────────────────────────────────────────────────────────

async function ensureDirectory(ov: AxiosInstance, uri: string): Promise<void> {
  try {
    await ov.post("/api/v1/fs/mkdir", { uri });
    console.log(`  [mkdir] ${uri}`);
  } catch (e: unknown) {
    if (axios.isAxiosError(e)) {
      const msg: string = e.response?.data?.error?.message ?? "";
      if (e.response?.status === 409 || msg.includes("already exists")) {
        console.log(`  [mkdir] ${uri} (already exists)`);
        return;
      }
    }
    throw e;
  }
}

async function tempUpload(ov: AxiosInstance, filename: string, content: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", Buffer.from(content, "utf-8"), {
    filename,
    contentType: "text/markdown",
  });
  const res = await ov.post("/api/v1/resources/temp_upload", fd, {
    headers: { ...fd.getHeaders(), ...(OV_API_KEY ? { "X-Api-Key": OV_API_KEY } : {}) },
  });
  // response: { status: "ok", result: { temp_path: "..." } }
  return (res.data.result?.temp_path ?? res.data.result) as string;
}

async function registerResource(
  ov: AxiosInstance,
  tempPath: string,
  targetUri: string
): Promise<void> {
  await ov.post("/api/v1/resources", {
    temp_path: tempPath,
    to: targetUri,
  });
}

async function uploadProduct(
  ov: AxiosInstance,
  p: ProductRow,
  index: number,
  total: number
): Promise<boolean> {
  const slug = slugify(p.brand, p.name, p.id);
  const filename = `${slug}.md`;
  const targetUri = `viking://resources/products/${filename}`;
  const markdown = buildMarkdown(p);

  console.log(`  [${index + 1}/${total}] ${p.brand ?? ""} ${p.name} → ${targetUri}`);

  if (DRY_RUN) {
    console.log("    [dry-run] skipping upload");
    return true;
  }

  try {
    const tempPath = await tempUpload(ov, filename, markdown);
    console.log(`    temp_path: ${tempPath}`);
    await registerResource(ov, tempPath, targetUri);
    console.log(`    registered ✓`);
    return true;
  } catch (e: unknown) {
    if (axios.isAxiosError(e) && e.response) {
      console.error(`    FAILED: ${e.response.status} ${JSON.stringify(e.response.data)}`);
    } else if (axios.isAxiosError(e)) {
      console.error(`    FAILED (no response): ${e.message}`);
    } else {
      console.error(`    FAILED:`, e);
    }
    return false;
  }
}

async function waitForQueue(ov: AxiosInstance): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await ov.get("/api/v1/observer/queue");
      const q = res.data.result ?? res.data;
      const pending = q.pending ?? q.total ?? 0;
      if (pending === 0) {
        console.log("  embedding queue empty ✓");
        return;
      }
      console.log(`  waiting for embedding queue (pending=${pending})...`);
    } catch {
      console.log("  queue endpoint unavailable, skipping wait");
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.warn("  timed out waiting for embedding queue");
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n=== seed-openviking ===`);
  console.log(`OV base: ${OV_BASE}`);
  console.log(`Tenant:  ${OV_TENANT}`);
  console.log(`Limit:   ${LIMIT}`);
  console.log(`Dry-run: ${DRY_RUN}`);
  console.log("");

  // 1. 连接 PG
  const pg = new Client({ connectionString: PG_URL, ssl: false });
  await pg.connect();
  console.log("PG connected ✓");

  // 2. 查询商品（优先有完整字段的）
  const { rows } = await pg.query<ProductRow>(`
    SELECT
      p.id,
      p.name,
      p.brand,
      p.description,
      p.category,
      p.material,
      p.color,
      p.size,
      p.hardware,
      p.closure,
      p.interior,
      p.strap,
      p."madeIn"     AS made_in,
      p."modelNo"    AS model_no,
      p.series,
      p."priceGood"::text        AS price_good,
      p."priceNormal"::text      AS price_normal,
      p."pricePremiumMin"::text  AS price_premium_min,
      p."pricePremiumMax"::text  AS price_premium_max,
      COALESCE(
        string_agg(m.url, '|||' ORDER BY m.sort ASC, m."showInFrontend" DESC),
        ''
      ) AS images
    FROM "Product" p
    LEFT JOIN "ProductMedia" m
      ON m."productId" = p.id AND m.url IS NOT NULL
    WHERE p.status = 'active'
      AND p.brand   IS NOT NULL
      AND p.material IS NOT NULL
      AND p.color    IS NOT NULL
      AND p."priceGood" IS NOT NULL
    GROUP BY p.id
    ORDER BY p.brand, p.name
    LIMIT $1
  `, [LIMIT]);

  await pg.end();
  console.log(`Fetched ${rows.length} products from PG ✓\n`);

  if (rows.length === 0) {
    console.log("No products found — check query filters.");
    return;
  }

  // 3. 初始化 OV 客户端
  const ov = buildOvClient();

  // 4. 确保目录存在
  console.log("Ensuring OV directories...");
  await ensureDirectory(ov, "viking://resources/products/");
  console.log("");

  // 5. 分批上传
  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}:`);

    const results: boolean[] = [];
    for (let j = 0; j < batch.length; j++) {
      results.push(await uploadProduct(ov, batch[j], i + j, rows.length));
    }

    success += results.filter(Boolean).length;
    failed += results.filter((r) => !r).length;
    console.log("");

    // 等待 embedding 队列处理完当前批次再继续
    if (!DRY_RUN && i + BATCH_SIZE < rows.length) {
      await waitForQueue(ov);
      console.log("");
    }
  }

  // 6. 最终等待
  if (!DRY_RUN) {
    console.log("Waiting for final embedding...");
    await waitForQueue(ov);
  }

  console.log(`\n=== Done: ${success} uploaded, ${failed} failed ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
