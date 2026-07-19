<script setup lang="ts">
import ActionBar from '@src/components/ActionBar.vue';
import PrunButton from '@src/components/PrunButton.vue';
import { createId } from '@src/store/create-id';
import PrunLink from '@src/components/PrunLink.vue';
import TextInput from '@src/components/forms/TextInput.vue';
import { vDraggable } from 'vue-draggable-plus';
import { grip } from '@src/components/grip';
import GripCell from '@src/components/grip/GripCell.vue';
import GripHeaderCell from '@src/components/grip/GripHeaderCell.vue';

const { list } = defineProps<{ list: UserData.CommandList }>();

const edit = ref(false);

function addCommand() {
  list.commands.push({
    id: createId(),
    label: '帮助',
    command: 'XIT HELP',
  });
}

function deleteCommand(command: UserData.Command) {
  list.commands = list.commands.filter(x => x !== command);
}
</script>

<template>
  <template v-if="!edit">
    <table>
      <thead>
        <tr>
          <th>命令</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="list.commands.length === 0">
          <td>没有命令。</td>
        </tr>
        <template v-else>
          <tr v-for="command in list.commands" :key="command.id">
            <td>
              <PrunLink :command="command.command">{{ command.label }}</PrunLink>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <ActionBar>
      <PrunButton primary @click="edit = true">编辑</PrunButton>
    </ActionBar>
  </template>
  <template v-else>
    <table>
      <thead>
        <tr>
          <GripHeaderCell />
          <th>标签</th>
          <th>命令</th>
          <th />
        </tr>
      </thead>
      <template v-if="list.commands.length === 0">
        <tbody>
          <tr>
            <td>没有命令。</td>
          </tr>
        </tbody>
      </template>
      <template v-else>
        <tbody v-draggable="[list.commands, grip.draggable]">
          <tr v-for="command in list.commands" :key="command.id">
            <GripCell />
            <td>
              <div :class="[C.forms.input, $style.inline]">
                <TextInput v-model="command.label" />
              </div>
            </td>
            <td>
              <div :class="C.forms.input">
                <TextInput v-model="command.command" />
              </div>
            </td>
            <td>
              <PrunButton danger @click="deleteCommand(command)">删除</PrunButton>
            </td>
          </tr>
        </tbody>
      </template>
    </table>
    <ActionBar>
      <PrunButton primary @click="addCommand">添加命令</PrunButton>
      <PrunButton primary @click="edit = false">完成</PrunButton>
    </ActionBar>
  </template>
</template>

<style module>
.inline {
  display: inline-block;
}
</style>
