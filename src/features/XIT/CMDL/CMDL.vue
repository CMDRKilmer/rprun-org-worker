<script setup lang="ts">
import { useXitParameters } from '@src/hooks/use-xit-parameters';
import { userData } from '@src/store/user-data';
import { isEmpty } from 'ts-extras';
import PrunButton from '@src/components/PrunButton.vue';
import { createId } from '@src/store/create-id';
import CommandLists from '@src/features/XIT/CMDL/CommandLists.vue';
import CommandList from '@src/features/XIT/CMDL/CommandList.vue';

const parameters = useXitParameters();
const name = parameters.join(' ');
const list = computed(() => {
  const byId = userData.commandLists.find(x => x.id.startsWith(parameters[0]));
  if (byId) {
    return byId;
  }
  return userData.commandLists.find(x => x.name === name);
});

function onCreateClick() {
  userData.commandLists.push({
    id: createId(),
    name,
    commands: [],
  });
}
</script>

<template>
  <CommandLists v-if="isEmpty(parameters)" />
  <CommandList v-else-if="list" :list="list" />
  <div v-else :class="$style.create">
    <span>命令列表 "{{ name }}" 未找到。</span>
    <PrunButton primary :class="$style.button" @click="onCreateClick">创建</PrunButton>
  </div>
</template>

<style module>
.create {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.button {
  margin-top: 5px;
}
</style>
