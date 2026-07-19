<script setup lang="ts">
import { storagesStore } from '@src/infrastructure/prun-api/data/storage';
import PrunButton from '@src/components/PrunButton.vue';
import ActionBar from '@src/components/ActionBar.vue';
import { showConfirmationOverlay, showTileOverlay } from '@src/infrastructure/prun-ui/tile-overlay';
import SortingModeEditor from './SortingModeEditor.vue';
import { useXitParameters } from '@src/hooks/use-xit-parameters';
import { isEmpty } from 'ts-extras';
import { objectId } from '@src/utils/object-id';
import { getSortingData } from '@src/store/user-data-sorting';
import removeArrayElement from '@src/utils/remove-array-element';
import { vDraggable } from 'vue-draggable-plus';
import { grip } from '@src/components/grip';
import GripCell from '@src/components/grip/GripCell.vue';
import GripHeaderCell from '@src/components/grip/GripHeaderCell.vue';

const parameters = useXitParameters();
const storeId = parameters[0];

const storage = computed(() => storagesStore.getById(storeId));
const sortingData = computed(() => getSortingData(storeId));

function createSortingMode(ev: Event) {
  showTileOverlay(ev, SortingModeEditor, {
    storeId,
    onSave: sorting => sortingData.value.modes.push(sorting),
  });
}

function editSortingMode(ev: Event, sorting: UserData.SortingMode) {
  showTileOverlay(ev, SortingModeEditor, {
    storeId,
    sorting,
    onSave: saved => Object.assign(sorting, saved),
  });
}

function deleteSortingMode(ev: Event, sorting: UserData.SortingMode) {
  showConfirmationOverlay(
    ev,
    () => {
      removeArrayElement(sortingData.value.modes, sorting);
    },
    {
      message: `确定要删除 ${sorting.label} 吗？`,
    },
  );
}

async function copySortingMode(sorting: UserData.SortingMode) {
  const json = JSON.stringify(sorting);
  await navigator.clipboard.writeText(json);
}

async function pasteSortingMode(ev: Event) {
  const clipText = await navigator.clipboard.readText();
  const sorting = JSON.parse(clipText);

  showTileOverlay(ev, SortingModeEditor, {
    storeId,
    sorting,
    onSave: sorting => sortingData.value.modes.push(sorting),
  });
}
</script>

<template>
  <div v-if="!storage">无效的库存 ID</div>
  <template v-else>
    <ActionBar>
      <PrunButton primary @click="createSortingMode">新建</PrunButton>
      <PrunButton primary @click="pasteSortingMode">粘贴</PrunButton>
    </ActionBar>
    <table>
      <thead>
        <tr>
          <GripHeaderCell />
          <th>名称</th>
          <th>分类</th>
          <th />
        </tr>
      </thead>
      <tbody v-if="!isEmpty(sortingData.modes)" v-draggable="[sortingData.modes, grip.draggable]">
        <tr v-for="mode in sortingData.modes" :key="objectId(mode)">
          <GripCell />
          <td>{{ mode.label }}</td>
          <td>{{ mode.categories.map(x => x.name).join(', ') }}</td>
          <td>
            <PrunButton primary @click="editSortingMode($event, mode)">编辑</PrunButton>
            <PrunButton primary @click="copySortingMode(mode)">复制</PrunButton>
            <PrunButton danger @click="deleteSortingMode($event, mode)">删除</PrunButton>
          </td>
        </tr>
      </tbody>
      <tbody v-else>
        <tr>
          <td colspan="3">没有排序选项</td>
        </tr>
      </tbody>
    </table>
  </template>
</template>
