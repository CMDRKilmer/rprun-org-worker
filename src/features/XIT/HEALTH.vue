<script setup lang="ts">
import { sitesStore } from '@src/infrastructure/prun-api/data/sites';
import { getEntityNameFromAddress } from '@src/infrastructure/prun-api/data/addresses';
import { workforcesStore } from '@src/infrastructure/prun-api/data/workforces';
import { productionStore } from '@src/infrastructure/prun-api/data/production';
import { storagesStore } from '@src/infrastructure/prun-api/data/storage';
import { warehousesStore } from '@src/infrastructure/prun-api/data/warehouses';
import { contractsStore } from '@src/infrastructure/prun-api/data/contracts';
import { cxosStore } from '@src/infrastructure/prun-api/data/cxos';
import { fxosStore } from '@src/infrastructure/prun-api/data/fxos';
import { balancesStore } from '@src/infrastructure/prun-api/data/balances';
import { cxStore } from '@src/infrastructure/fio/cx';
import { dayjsEachSecond } from '@src/utils/dayjs';
import { objectId } from '@src/utils/object-id';

const bases = computed(() => {
  return (
    sitesStore.all.value?.map(site => ({
      name: getEntityNameFromAddress(site.address)!,
      workforce: !!workforcesStore.getById(site.siteId),
      production: !!productionStore.getBySiteId(site.siteId),
      storage: !!storagesStore.getByAddressableId(site.siteId),
    })) ?? []
  );
});

const otherData = computed(() => [
  ['基地站点', sitesStore.all.value?.length],
  ['仓库站点', warehousesStore.all.value?.length],
  ['基地存储', storagesStore.getByType('STORE')?.length],
  ['仓库存储', storagesStore.getByType('WAREHOUSE_STORE')?.length],
  ['船舶存储', storagesStore.getByType('SHIP_STORE')?.length],
  ['劳动力', workforcesStore.all.value?.length],
  ['生产站点', productionStore.all.value?.length],
  ['合同', contractsStore.all.value?.length],
  ['商品交易订单', cxosStore.all.value?.length],
  ['外汇订单', fxosStore.all.value?.length],
  ['货币', (balancesStore.all.value?.length ?? 0) > 0],
  ['上次CX价格更新', cxStore.fetched ? `${dayjsEachSecond.value.to(cxStore.age)}` : false],
]);

const positive = C.ColoredValue.positive;
const negative = C.ColoredValue.negative;
</script>

<template>
  <div :style="{ paddingTop: '4px' }">
    <span class="title">基地</span>
    <table>
      <thead>
        <tr>
          <th>星球</th>
          <th>劳动力</th>
          <th>生产</th>
          <th>存储</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="base in bases" :key="base.name">
          <td>{{ base.name }}</td>
          <td v-if="base.workforce" :class="positive">✓</td>
          <td v-else :class="negative">✗</td>
          <td v-if="base.production" :class="positive">✓</td>
          <td v-else :class="negative">✗</td>
          <td v-if="base.storage" :class="positive">✓</td>
          <td v-else :class="negative">✗</td>
        </tr>
      </tbody>
    </table>
    <span class="title" style="padding-top: 10px">其他数据</span>
    <table :style="{ tableLayout: 'fixed' }">
      <thead>
        <tr>
          <th>参数</th>
          <th>值</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="other in otherData" :key="objectId(other)">
          <td>{{ other[0] }}</td>
          <td>
            <span v-if="other[1] === true" :class="positive">✓</span>
            <span v-else-if="other[1] === false || other[1] === undefined" :class="negative">
              ✗
            </span>
            <template v-else>{{ other[1] }}</template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
