<script setup lang="ts">
import BalanceSheetSection from '@src/features/XIT/FINBS/BalanceSheetSection.vue';
import * as summary from '@src/core/balance/balance-sheet-summary';
import { SectionData } from '@src/features/XIT/FINBS/balance-section';
import { liveBalanceSheet } from '@src/core/balance/balance-sheet-live';
import { ddmmyyyy } from '@src/utils/format';
import { lastBalance, previousBalance } from '@src/store/user-data-balance';
import { userData } from '@src/store/user-data';

const currentAssets = computed<SectionData>(() => ({
  name: '流动资产',
  chartId: 'CURRENT ASSETS',
  value: summary.calcTotalCurrentAssets,
  children: [
    {
      name: '现金及现金等价物',
      chartId: 'CA CASH EQUIVALENTS',
      value: summary.calcTotalCashAndCashEquivalents,
      children: [
        {
          name: '现金',
          chartId: 'CA CASH',
          value: x => x.assets?.current?.cashAndCashEquivalents?.cash,
        },
        {
          name: '存款',
          chartId: 'CA DEPOSITS',
          value: summary.calcTotalDeposits,
          children: [
            {
              name: 'CX',
              chartId: 'CA DEPOSITS CX',
              value: x => x.assets?.current?.cashAndCashEquivalents?.deposits?.cx,
            },
            {
              name: 'FX',
              chartId: 'CA DEPOSITS FX',
              value: x => x.assets?.current?.cashAndCashEquivalents?.deposits?.fx,
            },
          ],
        },
        {
          name: 'MM 材料',
          chartId: 'CA MM MATERIALS',
          tooltip:
            '当前存放在 CX 仓库中的做市商材料。你可以通过 XIT SET FIN 自定义' +
            '这些材料的列表。由于这些材料可以立即转换为现金，' +
            '因此被视为现金等价物。',
          value: x => x.assets?.current?.cashAndCashEquivalents?.mmMaterials,
        },
      ],
    },
    {
      name: '应收账款',
      chartId: 'CA ACCOUNTS RECEIVABLE',
      value: x => x.assets?.current?.accountsReceivable,
    },
    {
      name: '应收贷款',
      chartId: 'CA LOANS RECEIVABLE',
      value: summary.calcTotalLoansReceivable,
      children: [
        {
          name: '本金',
          chartId: 'CA LOANS PRINCIPAL',
          value: x => x.assets?.current?.loansReceivable?.principal,
        },
        {
          name: '利息',
          chartId: 'CA LOANS INTEREST',
          value: x => x.assets?.current?.loansReceivable?.interest,
        },
      ],
    },
    {
      name: '库存',
      chartId: 'CA INVENTORY',
      value: summary.calcTotalInventory,
      children: [
        {
          name: 'CX 上市材料',
          chartId: 'CA CX LISTED MATERIALS',
          value: x => x.assets?.current?.inventory?.cxListedMaterials,
        },
        {
          name: 'CX 库存',
          chartId: 'CA CX INVENTORY',
          value: x => x.assets?.current?.inventory?.cxInventory,
        },
        {
          name: '在途材料',
          chartId: 'CA MATERIALS IN TRANSIT',
          value: x => x.assets?.current?.inventory?.materialsInTransit,
        },
        {
          name: '基地库存',
          chartId: 'CA BASE INVENTORY',
          value: summary.calcTotalBaseInventory,
          children: [
            {
              name: '产成品',
              chartId: 'CA FINISHED GOODS',
              value: x => x.assets?.current?.inventory?.baseInventory?.finishedGoods,
            },
            {
              name: '在制品 (WIP)',
              chartId: 'CA WORK IN PROGRESS',
              value: x => x.assets?.current?.inventory?.baseInventory?.workInProgress,
            },
            {
              name: '原材料',
              chartId: 'CA RAW MATERIALS',
              value: x => x.assets?.current?.inventory?.baseInventory?.rawMaterials,
            },
            {
              name: '劳动力消耗品',
              chartId: 'CA WORKFORCE CONSUMABLES',
              value: x => x.assets?.current?.inventory?.baseInventory?.workforceConsumables,
            },
            {
              name: '其他物品',
              chartId: 'CA OTHER ITEMS',
              value: x => x.assets?.current?.inventory?.baseInventory?.otherItems,
            },
          ],
        },
        {
          name: '燃料箱',
          chartId: 'CA FUEL TANKS',
          value: x => x.assets?.current?.inventory?.fuelTanks,
        },
        {
          name: '应收材料',
          chartId: 'CA MATERIALS RECEIVABLE',
          value: x => x.assets?.current?.inventory?.materialsReceivable,
        },
      ],
    },
  ],
}));

const nonCurrentAssets = computed<SectionData>(() => ({
  name: '非流动资产',
  chartId: 'NON CURRENT ASSETS',
  value: summary.calcTotalNonCurrentAssets,
  children: [
    {
      name: '建筑物（净值）',
      chartId: 'NCA BUILDINGS',
      value: summary.calcTotalBuildings,
      children: [
        {
          name: '市场价值',
          chartId: 'NCA BUILDINGS VALUE',
          value: summary.calcTotalBuildingsMarketValue,
          children: [
            {
              name: '基础设施',
              chartId: 'NCA BUILDINGS INFRASTRUCTURE',
              value: x => x.assets?.nonCurrent?.buildings?.marketValue?.infrastructure,
            },
            {
              name: '资源开采',
              chartId: 'NCA BUILDINGS RESOURCE EXTRACTION',
              value: x => x.assets?.nonCurrent?.buildings?.marketValue?.resourceExtraction,
            },
            {
              name: '生产',
              chartId: 'NCA BUILDINGS PRODUCTION',
              value: x => x.assets?.nonCurrent?.buildings?.marketValue?.production,
            },
          ],
        },
        {
          name: '累计折旧',
          chartId: 'NCA BUILDINGS DEPRECIATION',
          less: true,
          value: x => x.assets?.nonCurrent?.buildings?.accumulatedDepreciation,
        },
      ],
    },
    {
      name: '船舶（净值）',
      chartId: 'NCA SHIPS',
      value: summary.calcTotalShips,
      excluded: !userData.fullEquityMode,
      children: [
        {
          name: '市场价值',
          chartId: 'NCA SHIPS VALUE',
          value: x => x.assets?.nonCurrent?.ships?.marketValue,
        },
        {
          name: '累计折旧',
          chartId: 'NCA SHIPS DEPRECIATION',
          less: true,
          value: x => x.assets?.nonCurrent?.ships?.accumulatedDepreciation,
        },
      ],
    },
    {
      name: '长期应收款',
      chartId: 'NCA LONG TERM RECEIVABLES',
      value: summary.calcTotalLongTermReceivables,
      children: [
        {
          name: '应收账款',
          chartId: 'NCA ACCOUNTS RECEIVABLE',
          value: x => x.assets?.nonCurrent?.longTermReceivables?.accountsReceivable,
        },
        {
          name: '在途材料',
          chartId: 'NCA MATERIALS IN TRANSIT',
          value: x => x.assets?.nonCurrent?.longTermReceivables?.materialsInTransit,
        },
        {
          name: '应收材料',
          chartId: 'NCA MATERIALS RECEIVABLE',
          value: x => x.assets?.nonCurrent?.longTermReceivables?.materialsReceivable,
        },
        {
          name: '贷款本金',
          chartId: 'NCA LOANS PRINCIPAL',
          value: x => x.assets?.nonCurrent?.longTermReceivables?.loansPrincipal,
        },
      ],
    },
    {
      name: '无形资产',
      chartId: 'NCA INTANGIBLE ASSETS',
      value: summary.calcTotalIntangibleAssets,
      excluded: !userData.fullEquityMode,
      children: [
        {
          name: '总部升级',
          chartId: 'NCA HQ UPGRADES',
          value: x => x.assets?.nonCurrent?.intangibleAssets?.hqUpgrades,
        },
        {
          name: 'APEX 代表中心',
          chartId: 'NCA ARC',
          value: x => x.assets?.nonCurrent?.intangibleAssets?.arc,
        },
      ],
    },
  ],
}));

const currentLiabilities = computed<SectionData>(() => ({
  name: '流动负债',
  chartId: 'CURRENT LIABILITIES',
  value: summary.calcTotalCurrentLiabilities,
  children: [
    {
      name: '应付账款',
      chartId: 'CL ACCOUNTS PAYABLE',
      value: x => x.liabilities?.current?.accountsPayable,
    },
    {
      name: '应付材料',
      chartId: 'CL MATERIALS PAYABLE',
      value: x => x.liabilities?.current?.materialsPayable,
    },
    {
      name: '应付贷款',
      chartId: 'CL LOANS PAYABLE',
      value: summary.calcTotalLoansPayable,
      children: [
        {
          name: '本金',
          chartId: 'CL LOANS PRINCIPAL',
          value: x => x.liabilities?.current?.loansPayable?.principal,
        },
        {
          name: '利息',
          chartId: 'CL LOANS INTEREST',
          value: x => x.liabilities?.current?.loansPayable?.interest,
        },
      ],
    },
  ],
}));

const nonCurrentLiabilities = computed<SectionData>(() => ({
  name: '非流动负债',
  chartId: 'NON CURRENT LIABILITIES',
  value: summary.calcTotalNonCurrentLiabilities,
  children: [
    {
      name: '长期应付款',
      chartId: 'NCL LONG TERM PAYABLES',
      value: summary.calcTotalLongTermPayables,
      children: [
        {
          name: '应付账款',
          chartId: 'NCL ACCOUNTS PAYABLE',
          value: x => x.liabilities?.nonCurrent?.longTermPayables?.accountsPayable,
        },
        {
          name: '应付材料',
          chartId: 'NCL MATERIALS PAYABLE',
          value: x => x.liabilities?.nonCurrent?.longTermPayables?.materialsPayable,
        },
        {
          name: '贷款本金',
          chartId: 'NCL LOANS PRINCIPAL',
          value: x => x.liabilities?.nonCurrent?.longTermPayables?.loansPrincipal,
        },
      ],
    },
  ],
}));

const equity = computed<SectionData>(() => ({
  name: '权益',
  chartId: 'EQUITY',
  coloredChange: true,
  value: summary.calcEquity,
  children: [
    {
      name: '总资产',
      chartId: 'TOTAL ASSETS',
      value: summary.calcTotalAssets,
    },
    {
      name: '总负债',
      chartId: 'TOTAL LIABILITIES',
      less: true,
      value: summary.calcTotalLiabilities,
    },
  ],
}));

const sections = [
  currentAssets,
  nonCurrentAssets,
  currentLiabilities,
  nonCurrentLiabilities,
  equity,
];
</script>

<template>
  <table>
    <thead>
      <tr>
        <th>&nbsp;</th>
        <th>当前期间</th>
        <th>
          <template v-if="lastBalance">{{ ddmmyyyy(lastBalance.timestamp) }}</template>
          <template v-else>上一期间</template>
        </th>
        <th>
          <template v-if="previousBalance">{{ ddmmyyyy(previousBalance.timestamp) }}</template>
          <template v-else>前一期间</template>
        </th>
        <th>变化</th>
        <th />
      </tr>
    </thead>
    <BalanceSheetSection
      v-for="section in sections"
      :key="section.value.name"
      :current="liveBalanceSheet"
      :last="lastBalance"
      :previous="previousBalance"
      :section="section.value" />
  </table>
</template>

<style scoped>
table tr > :not(:first-child) {
  text-align: right;
}
</style>
