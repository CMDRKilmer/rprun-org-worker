<script setup lang="ts">
import PieChart from '@src/features/XIT/FINCH/PieChart.vue';
import { liveBalanceSummary } from '@src/core/balance/balance-sheet-live';
</script>

<template>
  <PieChart
    :label-data="['流动', '非流动']"
    :numerical-data="[
      liveBalanceSummary.currentAssets ?? 0,
      liveBalanceSummary.nonCurrentAssets ?? 0,
    ]" />
</template>
