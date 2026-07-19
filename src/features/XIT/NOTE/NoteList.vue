<script setup lang="ts">
import { showTileOverlay, showConfirmationOverlay } from '@src/infrastructure/prun-ui/tile-overlay';
import CreateNoteOverlay from '@src/features/XIT/NOTE/CreateNoteOverlay.vue';
import PrunButton from '@src/components/PrunButton.vue';
import ActionBar from '@src/components/ActionBar.vue';
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';
import { userData } from '@src/store/user-data';
import { createNote, deleteNote } from '@src/store/notes';
import { vDraggable } from 'vue-draggable-plus';
import { grip } from '@src/components/grip';
import GripCell from '@src/components/grip/GripCell.vue';
import GripHeaderCell from '@src/components/grip/GripHeaderCell.vue';
import PrunLink from '@src/components/PrunLink.vue';

function createNewNote(ev: Event) {
  showTileOverlay(ev, CreateNoteOverlay, {
    onCreate: name => {
      const id = createNote(name);
      showBuffer(`XIT NOTE ${id}`);
    },
  });
}

function confirmDelete(ev: Event, note: UserData.Note) {
  showConfirmationOverlay(ev, () => deleteNote(note), {
    message: `确定要删除笔记 "${note.name}" 吗？`,
  });
}
</script>

<template>
  <ActionBar>
    <PrunButton primary @click="createNewNote">新建</PrunButton>
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
    <tbody v-draggable="[userData.notes, grip.draggable]">
      <tr v-for="note in userData.notes" :key="note.id">
        <GripCell />
        <td>
          <PrunLink inline :command="`XIT NOTE ${note.id.substring(0, 8)}`">
            {{ note.name }}
          </PrunLink>
        </td>
        <td>
          <span> {{ note.text.length.toLocaleString() }} 个字符 </span>
        </td>
        <td>
          <PrunButton danger @click="confirmDelete($event, note)">删除</PrunButton>
        </td>
      </tr>
    </tbody>
  </table>
</template>
