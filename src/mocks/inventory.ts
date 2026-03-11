/**
 * 库存 API 模拟接口
 * 
 * 模拟真实的 ERP/库存系统，提供商品库存查询功能
 */

import { ProductInfo } from "../types";

/**
 * 库存信息接口
 */
export interface InventoryInfo {
  productId: string;
  sku: string;
  color: string;
  size: string;
  quantity: number;
  warehouse: string;
  reserved: number;      // 已预留数量
  available: number;     // 可用数量 = quantity - reserved
}

/**
 * 库存查询结果
 */
export interface InventoryQueryResult {
  product: ProductInfo;
  inventory: InventoryInfo[];
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  estimatedRestock?: string;  // 预计补货时间
}

/**
 * 模拟库存数据库
 */
const MOCK_INVENTORY: InventoryInfo[] = [
  // 经典红色风衣 prod_001
  { productId: "prod_001", sku: "TC-RED-S", color: "红色", size: "S", quantity: 50, warehouse: "SH-01", reserved: 5, available: 45 },
  { productId: "prod_001", sku: "TC-RED-M", color: "红色", size: "M", quantity: 100, warehouse: "SH-01", reserved: 12, available: 88 },
  { productId: "prod_001", sku: "TC-RED-L", color: "红色", size: "L", quantity: 80, warehouse: "SH-01", reserved: 8, available: 72 },
  { productId: "prod_001", sku: "TC-RED-XL", color: "红色", size: "XL", quantity: 30, warehouse: "SH-01", reserved: 2, available: 28 },
  { productId: "prod_001", sku: "TC-BLK-M", color: "黑色", size: "M", quantity: 200, warehouse: "SH-01", reserved: 20, available: 180 },
  { productId: "prod_001", sku: "TC-KHK-L", color: "卡其色", size: "L", quantity: 150, warehouse: "SH-01", reserved: 15, available: 135 },
  
  // 商务黑色风衣 prod_002
  { productId: "prod_002", sku: "BT-BLK-M", color: "黑色", size: "M", quantity: 80, warehouse: "BJ-01", reserved: 10, available: 70 },
  { productId: "prod_002", sku: "BT-BLK-L", color: "黑色", size: "L", quantity: 120, warehouse: "BJ-01", reserved: 15, available: 105 },
  { productId: "prod_002", sku: "BT-GRY-XL", color: "深灰", size: "XL", quantity: 60, warehouse: "BJ-01", reserved: 5, available: 55 },
  
  // 休闲卡其色风衣 prod_003
  { productId: "prod_003", sku: "CT-KHK-S", color: "卡其色", size: "S", quantity: 40, warehouse: "GZ-01", reserved: 3, available: 37 },
  { productId: "prod_003", sku: "CT-KHK-M", color: "卡其色", size: "M", quantity: 60, warehouse: "GZ-01", reserved: 8, available: 52 },
  { productId: "prod_003", sku: "CT-BGE-M", color: "米色", size: "M", quantity: 45, warehouse: "GZ-01", reserved: 5, available: 40 },
];

/**
 * 库存服务类
 */
export class InventoryService {
  /**
   * 查询商品库存
   * 
   * @param productId 商品ID
   * @returns 库存查询结果
   */
  async queryInventory(productId: string, productInfo: ProductInfo): Promise<InventoryQueryResult> {
    console.log(`[Inventory] 查询商品 ${productId} 库存`);
    
    // 模拟 API 延迟
    await this.simulateDelay(50 + Math.random() * 100);
    
    const inventory = MOCK_INVENTORY.filter(item => item.productId === productId);
    
    // 计算整体库存状态
    const totalAvailable = inventory.reduce((sum, item) => sum + item.available, 0);
    let stockStatus: "in_stock" | "low_stock" | "out_of_stock" = "in_stock";
    
    if (totalAvailable === 0) {
      stockStatus = "out_of_stock";
    } else if (totalAvailable < 50) {
      stockStatus = "low_stock";
    }

    const result: InventoryQueryResult = {
      product: productInfo,
      inventory,
      stockStatus,
      estimatedRestock: stockStatus === "out_of_stock" ? "2024-03-15" : undefined
    };

    console.log(`[Inventory] 库存状态: ${stockStatus}, 可用总数: ${totalAvailable}`);
    
    return result;
  }

  /**
   * 检查特定 SKU 库存
   * 
   * @param sku SKU 编码
   * @returns 库存信息
   */
  async checkSkuStock(sku: string): Promise<InventoryInfo | null> {
    const item = MOCK_INVENTORY.find(i => i.sku === sku);
    return item || null;
  }

  /**
   * 检查颜色和尺码是否有库存
   * 
   * @param productId 商品ID
   * @param color 颜色
   * @param size 尺码
   * @returns 是否有库存
   */
  async checkAvailability(productId: string, color: string, size: string): Promise<boolean> {
    const items = MOCK_INVENTORY.filter(
      i => i.productId === productId && i.color === color && i.size === size
    );
    return items.some(i => i.available > 0);
  }

  /**
   * 获取商品的可选颜色和尺码
   * 
   * @param productId 商品ID
   * @returns 颜色和尺码选项
   */
  async getProductOptions(productId: string): Promise<{ colors: string[]; sizes: string[] }> {
    const inventory = MOCK_INVENTORY.filter(item => item.productId === productId);
    
    const colors = [...new Set(inventory.map(i => i.color))];
    const sizes = [...new Set(inventory.map(i => i.size))];
    
    return { colors, sizes };
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 导出单例实例
export const inventoryService = new InventoryService();