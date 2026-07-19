<script setup lang="ts">
import { showTileOverlay, showConfirmationOverlay } from '@src/infrastructure/prun-ui/tile-overlay';
import CreateCommandListOverlay from './CreateCommandListOverlay.vue';
import PrunButton from '@src/components/PrunButton.vue';
import ActionBar from '@src/components/ActionBar.vue';
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';
import { userData } from '@src/store/user-data';
import { vDraggable } from 'vue-draggable-plus';
import { grip } from '@src/components/grip';
import GripCell from '@src/components/grip/GripCell.vue';
import GripHeaderCell from '@src/components/grip/GripHeaderCell.vue';
import PrunLink from '@src/components/PrunLink.vue';
import { createId } from '@src/store/create-id';

function createNew(ev: Event) {
  showTileOverlay(ev, CreateCommandListOverlay, {
    onCreate: name => {
      const id = createId();
      userData.commandLists.push({
        id,
        name,
        commands: [],
      });
      return showBuffer(`XIT CMDL ${id.substring(0, 8)}`);
    },
  });
}

function confirmDelete(ev: Event, list: UserData.CommandList) {
  showConfirmationOverlay(
    ev,
    () => (userData.commandLists = userData.commandLists.filter(x => x !== list)),
    {
      message: `确定要删除列表 "${list.name}" 吗？`,
    },
  );
}
</script>

<template>
  <ActionBar>
    <PrunButton primary @click="createNew">新建</PrunButton>
  </ActionBar>
  <table>
    <thead>
      <tr>
        <GripHeaderCell />
        <th>名称</th>
        <th>长度</th>
        <th />
      </tr>
    </thead>
    <tbody v-draggable="[userData.commandLists, grip.draggable]">
      <tr v-for="list in userData.commandLists" :key="list.id">
        <GripCell />
        <td>
          <PrunLink inline :command="`XIT CMDL ${list.id.substring(0, 8)}`">
            {{ list.name }}
          </PrunLink>
        </td>
        <td>
          <span> {{ list.commands.length }} 个命令 </span>
        </td>
        <td>
          <PrunButton danger @click="confirmDelete($event, list)">删除</PrunButton>
        </td>
      </tr>
    </tbody>
  </table>
</template>
