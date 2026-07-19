<script setup lang="ts">
import PrunButton from '@src/components/PrunButton.vue';
import SectionHeader from '@src/components/SectionHeader.vue';
import Active from '@src/components/forms/Active.vue';
import TextInput from '@src/components/forms/TextInput.vue';
import Commands from '@src/components/forms/Commands.vue';

const { onCreate } = defineProps<{ onCreate: (name: string) => void }>();

const emit = defineEmits<{ (e: 'close'): void }>();

const name = ref('');

function onCreateClick() {
  if (name.value.length === 0) {
    return;
  }
  onCreate(name.value);
  emit('close');
}
</script>

<template>
  <div :class="C.DraftConditionEditor.form">
    <SectionHeader>新建笔记</SectionHeader>
    <form>
      <Active label="笔记名称">
        <TextInput v-model="name" />
      </Active>
      <Commands>
        <PrunButton primary @click="onCreateClick">创建</PrunButton>
      </Commands>
    </form>
  </div>
</template>
