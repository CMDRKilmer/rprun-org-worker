<script setup lang="ts">
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';

const props = defineProps<{ cmd: string; label?: string }>();

const commandParts = computed(() => {
  const words = props.cmd.split(' ');
  let command = words.shift();
  if (command === 'XIT') {
    command += ' ' + words.shift();
  }
  return [command, words.join(' ')];
});

const itemClasses = [C.ContextControls.item, C.fonts.fontRegular, C.type.typeSmall];
</script>

<template>
  <!-- 节点结构完全复制自 PrUn，不用在意冗余节点。 -->
  <div :class="itemClasses" @click="() => showBuffer(cmd)">
    <span>
      <span :class="C.ContextControls.cmd">{{ commandParts[0] }}</span>
      {{ commandParts[1] }}
    </span>
    <span v-if="label" :class="C.ContextControls.label">: {{ label }}</span>
  </div>
</template>
