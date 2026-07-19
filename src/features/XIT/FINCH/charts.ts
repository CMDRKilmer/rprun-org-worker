import { PartialBalanceSheet } from '@src/core/balance/balance-sheet';
import * as summary from '@src/core/balance/balance-sheet-summary';
import { userData } from '@src/store/user-data';

export type ChartDef = {
  value: string;
  label: string;
  getValue: (x: PartialBalanceSheet) => number | undefined;
  less?: boolean;
};

export const charts = computed<ChartDef[]>(() => {
  return [
    {
      value: 'EQUITY',
      label: userData.fullEquityMode ? '权益' : '权益（部分）',
      getValue: summary.calcEquity,
    },

    // =========================
    // 资产
    // =========================
    {
      value: 'TOTAL ASSETS',
      label: '总资产',
      getValue: summary.calcTotalAssets,
    },

    // =========================
    // 流动资产
    // =========================
    {
      value: 'CURRENT ASSETS',
      label: '流动资产',
      getValue: summary.calcTotalCurrentAssets,
    },
    {
      value: 'CA CASH EQUIVALENTS',
      label: '- 现金及现金等价物',
      getValue: summary.calcTotalCashAndCashEquivalents,
    },
    {
      value: 'CA CASH',
      label: '-- 现金',
      getValue: x => x.assets?.current?.cashAndCashEquivalents?.cash,
    },
    {
      value: 'CA DEPOSITS',
      label: '-- 存款',
      getValue: summary.calcTotalDeposits,
    },
    {
      value: 'CA DEPOSITS CX',
      label: '--- 存款：CX',
      getValue: x => x.assets?.current?.cashAndCashEquivalents?.deposits?.cx,
    },
    {
      value: 'CA DEPOSITS FX',
      label: '--- 存款：FX',
      getValue: x => x.assets?.current?.cashAndCashEquivalents?.deposits?.fx,
    },
    {
      value: 'CA MM MATERIALS',
      label: '-- MM 材料',
      getValue: x => x.assets?.current?.cashAndCashEquivalents?.mmMaterials,
    },
    {
      value: 'CA ACCOUNTS RECEIVABLE',
      label: '- 应收账款',
      getValue: x => x.assets?.current?.accountsReceivable,
    },
    {
      value: 'CA LOANS RECEIVABLE',
      label: '- 应收贷款',
      getValue: summary.calcTotalLoansReceivable,
    },
    {
      value: 'CA LOANS PRINCIPAL',
      label: '-- 应收贷款：本金',
      getValue: x => x.assets?.current?.loansReceivable?.principal,
    },
    {
      value: 'CA LOANS INTEREST',
      label: '-- 应收贷款：利息',
      getValue: x => x.assets?.current?.loansReceivable?.interest,
    },
    {
      value: 'CA INVENTORY',
      label: '- 库存',
      getValue: summary.calcTotalInventory,
    },
    {
      value: 'CA CX LISTED MATERIALS',
      label: '-- CX 挂牌材料',
      getValue: x => x.assets?.current?.inventory?.cxListedMaterials,
    },
    {
      value: 'CA CX INVENTORY',
      label: '-- CX 库存',
      getValue: x => x.assets?.current?.inventory?.cxInventory,
    },
    {
      value: 'CA MATERIALS IN TRANSIT',
      label: '-- 在途材料',
      getValue: x => x.assets?.current?.inventory?.materialsInTransit,
    },
    {
      value: 'CA BASE INVENTORY',
      label: '-- 基地库存',
      getValue: summary.calcTotalBaseInventory,
    },
    {
      value: 'CA FINISHED GOODS',
      label: '--- 成品',
      getValue: x => x.assets?.current?.inventory?.baseInventory?.finishedGoods,
    },
    {
      value: 'CA WORK IN PROGRESS',
      label: '--- 在制品 (WIP)',
      getValue: x => x.assets?.current?.inventory?.baseInventory?.workInProgress,
    },
    {
      value: 'CA RAW MATERIALS',
      label: '--- 原材料',
      getValue: x => x.assets?.current?.inventory?.baseInventory?.rawMaterials,
    },
    {
      value: 'CA WORKFORCE CONSUMABLES',
      label: '--- 劳动力消耗品',
      getValue: x => x.assets?.current?.inventory?.baseInventory?.workforceConsumables,
    },
    {
      value: 'CA OTHER ITEMS',
      label: '--- 其他物品',
      getValue: x => x.assets?.current?.inventory?.baseInventory?.otherItems,
    },
    {
      value: 'CA FUEL TANKS',
      label: '-- 燃料箱',
      getValue: x => x.assets?.current?.inventory?.fuelTanks,
    },
    {
      value: 'CA MATERIALS RECEIVABLE',
      label: '-- 应收材料',
      getValue: x => x.assets?.current?.inventory?.materialsReceivable,
    },

    // =========================
    // 非流动资产
    // =========================
    {
      value: 'NON CURRENT ASSETS',
      label: '非流动资产',
      getValue: summary.calcTotalNonCurrentAssets,
    },
    {
      value: 'NCA BUILDINGS',
      label: '- 建筑（净值）',
      getValue: summary.calcTotalBuildings,
    },
    {
      value: 'NCA BUILDINGS VALUE',
      label: '-- 建筑市值',
      getValue: summary.calcTotalBuildingsMarketValue,
    },
    {
      value: 'NCA BUILDINGS INFRASTRUCTURE',
      label: '--- 建筑：基础设施',
      getValue: x => x.assets?.nonCurrent?.buildings?.marketValue?.infrastructure,
    },
    {
      value: 'NCA BUILDINGS RESOURCE EXTRACTION',
      label: '--- 建筑：资源开采',
      getValue: x => x.assets?.nonCurrent?.buildings?.marketValue?.resourceExtraction,
    },
    {
      value: 'NCA BUILDINGS PRODUCTION',
      label: '--- 建筑：生产',
      getValue: x => x.assets?.nonCurrent?.buildings?.marketValue?.production,
    },
    {
      value: 'NCA BUILDINGS DEPRECIATION',
      label: '-- 建筑累计折旧',
      less: true,
      getValue: x => x.assets?.nonCurrent?.buildings?.accumulatedDepreciation,
    },
    {
      value: 'NCA SHIPS',
      label: '- 飞船（净值）',
      getValue: summary.calcTotalShips,
    },
    {
      value: 'NCA SHIPS VALUE',
      label: '-- 飞船市值',
      getValue: x => x.assets?.nonCurrent?.ships?.marketValue,
    },
    {
      value: 'NCA SHIPS DEPRECIATION',
      label: '-- 飞船累计折旧',
      less: true,
      getValue: x => x.assets?.nonCurrent?.ships?.accumulatedDepreciation,
    },
    {
      value: 'NCA LONG TERM RECEIVABLES',
      label: '- 长期应收款',
      getValue: summary.calcTotalLongTermReceivables,
    },
    {
      value: 'NCA ACCOUNTS RECEIVABLE',
      label: '-- 长期应收账款',
      getValue: x => x.assets?.nonCurrent?.longTermReceivables?.accountsReceivable,
    },
    {
      value: 'NCA MATERIALS IN TRANSIT',
      label: '-- 长期在途材料',
      getValue: x => x.assets?.nonCurrent?.longTermReceivables?.materialsInTransit,
    },
    {
      value: 'NCA MATERIALS RECEIVABLE',
      label: '-- 长期应收材料',
      getValue: x => x.assets?.nonCurrent?.longTermReceivables?.materialsReceivable,
    },
    {
      value: 'NCA LOANS PRINCIPAL',
      label: '-- 长期贷款本金',
      getValue: x => x.assets?.nonCurrent?.longTermReceivables?.loansPrincipal,
    },
    {
      value: 'NCA INTANGIBLE ASSETS',
      label: '- 无形资产',
      getValue: summary.calcTotalIntangibleAssets,
    },
    {
      value: 'NCA HQ UPGRADES',
      label: '-- 总部升级',
      getValue: x => x.assets?.nonCurrent?.intangibleAssets?.hqUpgrades,
    },
    {
      value: 'NCA ARC',
      label: '-- APEX 代表中心',
      getValue: x => x.assets?.nonCurrent?.intangibleAssets?.arc,
    },

    // =========================
    // 负债
    // =========================
    {
      value: 'TOTAL LIABILITIES',
      label: '总负债',
      getValue: summary.calcTotalLiabilities,
    },

    // =========================
    // 流动负债
    // =========================
    {
      value: 'CURRENT LIABILITIES',
      label: '流动负债',
      getValue: summary.calcTotalCurrentLiabilities,
    },
    {
      value: 'CL ACCOUNTS PAYABLE',
      label: '- 应付账款',
      getValue: x => x.liabilities?.current?.accountsPayable,
    },
    {
      value: 'CL MATERIALS PAYABLE',
      label: '- 应付材料',
      getValue: x => x.liabilities?.current?.materialsPayable,
    },
    {
      value: 'CL LOANS PAYABLE',
      label: '- 应付贷款',
      getValue: summary.calcTotalLoansPayable,
    },
    {
      value: 'CL LOANS PRINCIPAL',
      label: '-- 应付贷款：本金',
      getValue: x => x.liabilities?.current?.loansPayable?.principal,
    },
    {
      value: 'CL LOANS INTEREST',
      label: '-- 应付贷款：利息',
      getValue: x => x.liabilities?.current?.loansPayable?.interest,
    },

    // =========================
    // 非流动负债
    // =========================
    {
      value: 'NON CURRENT LIABILITIES',
      label: '非流动负债',
      getValue: summary.calcTotalNonCurrentLiabilities,
    },
    {
      value: 'NCL LONG TERM PAYABLES',
      label: '- 长期应付款',
      getValue: summary.calcTotalLongTermPayables,
    },
    {
      value: 'NCL ACCOUNTS PAYABLE',
      label: '-- 长期应付账款',
      getValue: x => x.liabilities?.nonCurrent?.longTermPayables?.accountsPayable,
    },
    {
      value: 'NCL MATERIALS PAYABLE',
      label: '-- 长期应付材料',
      getValue: x => x.liabilities?.nonCurrent?.longTermPayables?.materialsPayable,
    },
    {
      value: 'NCL LOANS PRINCIPAL',
      label: '-- 长期贷款本金',
      getValue: x => x.liabilities?.nonCurrent?.longTermPayables?.loansPrincipal,
    },
  ];
});
