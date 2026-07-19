<script setup lang="ts">
import { showTileOverlay, showConfirmationOverlay } from '@src/infrastructure/prun-ui/tile-overlay';
import PrunButton from '@src/components/PrunButton.vue';
import ActionBar from '@src/components/ActionBar.vue';
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';
import { userData } from '@src/store/user-data';
import { vDraggable } from 'vue-draggable-plus';
import CreateTaskList from '@src/features/XIT/TODO/CreateTaskList.vue';
import { createId } from '@src/store/create-id';
import removeArrayElement from '@src/utils/remove-array-element';
import { sumBy } from '@src/utils/sum-by';
import PrunLink from '@src/components/PrunLink.vue';
import { ddmmyyyy } from '@src/utils/format';
import { grip } from '@src/components/grip';
import GripCell from '@src/components/grip/GripCell.vue';
import GripHeaderCell from '@src/components/grip/GripHeaderCell.vue';

function createNewList(ev: Event) {
  showTileOverlay(ev, CreateTaskList, {
    onCreate: name => {
      const id = createId();
      userData.todo.push({ id, name, tasks: [] });
      showBuffer(`XIT TODO ${id.substring(0, 8)}`);
    },
  });
}

function confirmDelete(ev: Event, list: UserData.TaskList) {
  showConfirmationOverlay(ev, () => removeArrayElement(userData.todo, list), {
    message: `确定要删除任务列表 "${list.name}" 吗？`,
  });
}

function countCompletedTasks(list: UserData.TaskList) {
  return sumBy(list.tasks, x => (x.completed ? 1 : 0));
}

function getDueDate(list: UserData.TaskList) {
  const dates: number[] = [];
  const add = (task: UserData.Task) => {
    if (task.dueDate !== undefined) {
      dates.push(task.dueDate);
    }
    for (const subtask of task.subtasks ?? []) {
      add(subtask);
    }
  };
  for (const task of list.tasks) {
    add(task);
  }
  if (dates.length === 0) {
    return undefined;
  }
  dates.sort();
  return ddmmyyyy(dates[0]);
}
</script>

<template>
  <ActionBar>
    <PrunButton primary @click="createNewList">新建</PrunButton>
  </ActionBar>
  <table>
    <thead>
      <tr>
        <GripHeaderCell />
        <th>名称</th>
        <th>任务</th>
        <th>截止日期</th>
        <th />
      </tr>
    </thead>
    <tbody v-draggable="[userData.todo, grip.draggable]">
      <tr v-for="list in userData.todo" :key="list.id">
        <GripCell />
        <td>
          <PrunLink inline :command="`XIT TODO ${list.id.substring(0, 8)}`">
            {{ list.name }}
          </PrunLink>
        </td>
        <td>
          <span>{{ countCompletedTasks(list) }}/{{ list.tasks.length }}</span>
        </td>
        <td>
          <span>{{ getDueDate(list) }}</span>
        </td>
        <td>
          <PrunButton danger @click="confirmDelete($event, list)">删除</PrunButton>
        </td>
      </tr>
    </tbody>
  </table>
</template>
