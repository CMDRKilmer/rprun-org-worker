<script setup lang="ts">
import ActionBar from '@src/components/ActionBar.vue';
import PrunButton from '@src/components/PrunButton.vue';
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';
import { showConfirmationOverlay, showTileOverlay } from '@src/infrastructure/prun-ui/tile-overlay';
import CreateActionPackage from '@src/features/XIT/ACT/CreateActionPackage.vue';
import ImportActionPackage from '@src/features/XIT/ACT/ImportActionPackage.vue';
import Quickstart from '@src/features/XIT/ACT/Quickstart.vue';
import { userData } from '@src/store/user-data';
import PrunLink from '@src/components/PrunLink.vue';
import removeArrayElement from '@src/utils/remove-array-element';
import { objectId } from '@src/utils/object-id';
import { stripDeletedActions } from '@src/features/XIT/ACT/utils';
import { vDraggable } from 'vue-draggable-plus';
import { grip } from '@src/components/grip';
import GripCell from '@src/components/grip/GripCell.vue';
import GripHeaderCell from '@src/components/grip/GripHeaderCell.vue';

const actionPackages = computed(() => userData.actionPackages);
const showQuickstart = computed(() => userData.actionPackages.length === 0);

function onQuickstartClick(ev: Event) {
  showTileOverlay(ev, Quickstart);
}

function onCreateClick(ev: Event) {
  showTileOverlay(ev, CreateActionPackage, {
    onCreate: name => {
      userData.actionPackages.push({
        global: { name },
        groups: [],
        actions: [],
      });
      showBuffer('XIT ACT_EDIT_' + name.split(' ').join('_'));
    },
  });
}

function onImportClick(ev: Event) {
  showTileOverlay(ev, ImportActionPackage, {
    onImport: json => {
      stripDeletedActions(json);
      const existing = userData.actionPackages.find(x => x.global.name === json.global.name);
      if (existing) {
        const index = userData.actionPackages.indexOf(existing);
        userData.actionPackages[index] = json;
      } else {
        userData.actionPackages.push(json);
      }
    },
  });
}

function onDeleteClick(ev: Event, pkg: UserData.ActionPackageData) {
  showConfirmationOverlay(ev, () => removeArrayElement(userData.actionPackages, pkg), {
    message: `确定要删除操作包 "${pkg.global.name}" 吗？`,
    confirmLabel: '删除',
  });
}

function onDeleteAllClick(ev: Event) {
  showConfirmationOverlay(ev, () => userData.actionPackages.splice(0), {
    message: '确定要删除全部操作包吗？',
    confirmLabel: '删除全部',
  });
}

function friendlyName(pkg: UserData.ActionPackageData) {
  return (pkg.global.name ?? '').split('_').join(' ');
}

function paramName(pkg: UserData.ActionPackageData) {
  return (pkg.global.name ?? '').split(' ').join('_');
}
</script>

<template>
  <ActionBar>
    <div v-if="showQuickstart">点击这里开始<br />快速入门！</div>
    <div v-if="showQuickstart">→</div>
    <PrunButton v-if="showQuickstart" primary @click="onQuickstartClick">快速开始</PrunButton>
    <PrunButton primary @click="onCreateClick">新建</PrunButton>
    <PrunButton primary @click="onImportClick">导入</PrunButton>
    <PrunButton v-if="actionPackages.length > 0" dark @click="onDeleteAllClick"
      >删除全部</PrunButton
    >
  </ActionBar>
  <table>
    <thead>
      <tr>
        <GripHeaderCell />
        <th>名称</th>
        <th>执行</th>
        <th>编辑</th>
        <th>删除</th>
      </tr>
    </thead>
    <tbody v-if="userData.actionPackages.length === 0">
      <tr>
        <td colspan="5">没有操作包。</td>
      </tr>
    </tbody>
    <tbody v-else v-draggable="[actionPackages, grip.draggable]">
      <tr v-for="pkg in actionPackages" :key="objectId(pkg)">
        <GripCell />
        <td>
          <PrunLink inline :command="`XIT ACT_${paramName(pkg)}`">
            {{ friendlyName(pkg) }}
          </PrunLink>
        </td>
        <td>
          <PrunButton primary @click="showBuffer(`XIT ACT_${paramName(pkg)}`)"> 执行 </PrunButton>
        </td>
        <td>
          <PrunButton primary @click="showBuffer(`XIT ACT_EDIT_${paramName(pkg)}`)">
            编辑
          </PrunButton>
        </td>
        <td>
          <PrunButton dark inline @click="onDeleteClick($event, pkg)">删除</PrunButton>
        </td>
      </tr>
    </tbody>
  </table>
</template>
