// 基地规划磁贴状态。
import { createTileStateHook } from '@src/store/user-data-tiles';

export interface PlannedRecipe {
  recipeIdx: number;
  count: number;
}

export interface PlannedBuilding {
  ticker: string;
  // 建筑总数量（= recipes[].count 之和）。旧数据中保留，新代码读 recipes。
  count: number;
  recipes: PlannedRecipe[];
  // 旧数据兼容字段，新代码不写入。
  recipeIdx?: number;
}

export const useTileState = createTileStateHook({
  planet: '',
  permits: 1,
  exchange: 'IC1',
  buildings: [] as PlannedBuilding[],
  experts: {} as Record<string, number>,
  cogcIndustry: '',
  customInputPrices: {} as Record<string, number>,
  customOutputPrices: {} as Record<string, number>,
  customWfPrices: {} as Record<string, number>,
  jhPlanId: '',
});
