<script setup lang="ts">
import PrunButton from '@src/components/PrunButton.vue';
import GenerateBraRepairActDialog from './GenerateBraRepairActDialog.vue';
import { showTileOverlay } from '@src/infrastructure/prun-ui/tile-overlay';

const { planetNaturalId } = defineProps<{ planetNaturalId?: string }>();

function onClick(ev: Event) {
  showTileOverlay(ev, GenerateBraRepairActDialog, { planetNaturalId });
}
</script>

<template>
  <PrunButton dark @click="onClick">生成维修ACT</PrunButton>
</template>
