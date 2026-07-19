<script setup lang="ts">
import PrunButton from '@src/components/PrunButton.vue';
import GenerateRepairActDialog from './GenerateRepairActDialog.vue';
import { showTileOverlay } from '@src/infrastructure/prun-ui/tile-overlay';

const { registration } = defineProps<{ registration?: string }>();

function onClick(ev: Event) {
  showTileOverlay(ev, GenerateRepairActDialog, { registration });
}
</script>

<template>
  <PrunButton dark @click="onClick">生成维修ACT</PrunButton>
</template>
