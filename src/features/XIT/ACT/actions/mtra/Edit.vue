<script setup lang="ts">
import Active from '@src/components/forms/Active.vue';
import SelectInput from '@src/components/forms/SelectInput.vue';
import { storagesStore } from '@src/infrastructure/prun-api/data/storage';
import { serializeStorage, storageSort } from '@src/features/XIT/ACT/actions/utils';
import { configurableValue } from '@src/features/XIT/ACT/shared-types';

const { action, pkg } = defineProps<{
  action: UserData.ActionData;
  pkg: UserData.ActionPackageData;
}>();

const materialGroups = computed(() => pkg.groups.map(x => x.name!).filter(x => x));
const materialGroup = ref(action.group ?? materialGroups.value[0]);

const storages = computed(() => {
  const storages = [...(storagesStore.nonFuelStores.value ?? [])]
    .sort(storageSort)
    .map(serializeStorage);
  storages.unshift(configurableValue);
  return storages;
});

const origin = ref(action.origin ?? storages.value[0]);
const destination = ref(action.dest ?? storages.value[0]);

function validate() {
  return true;
}

function save() {
  action.group = materialGroup.value;
  action.origin = origin.value;
  action.dest = destination.value;
}

defineExpose({ validate, save });
</script>

<template>
  <Active label="材料组">
    <SelectInput v-model="materialGroup" :options="materialGroups" />
  </Active>
  <Active label="来源">
    <SelectInput v-model="origin" :options="storages" />
  </Active>
  <Active label="目标">
    <SelectInput v-model="destination" :options="storages" />
  </Active>
</template>
