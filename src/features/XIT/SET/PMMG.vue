<script setup lang="ts">
import SectionHeader from '@src/components/SectionHeader.vue';
import PrunButton from '@src/components/PrunButton.vue';
import Commands from '@src/components/forms/Commands.vue';
import {
  importPmmgActions,
  importPmmgFinancialHistory,
  importPmmgNotes,
  importPmmgSettings,
  importPmmgCommandLists,
} from '@src/infrastructure/storage/pmmg-import';
</script>

<template>
  <SectionHeader>导入 PMMG 文件</SectionHeader>
  <form>
    <Commands label="pmmg-settings.json">
      <PrunButton primary @click="importPmmgSettings">导入设置</PrunButton>
    </Commands>
    <Commands label="pmmg-finance.json">
      <PrunButton primary @click="importPmmgFinancialHistory">导入财务</PrunButton>
    </Commands>
    <Commands label="pmmg-notes.json">
      <PrunButton primary @click="importPmmgNotes">导入笔记</PrunButton>
    </Commands>
    <Commands label="pmmg-action.json">
      <PrunButton primary @click="importPmmgActions">导入操作</PrunButton>
    </Commands>
    <Commands label="pmmg-lists.json">
      <PrunButton primary @click="importPmmgCommandLists">导入命令列表</PrunButton>
    </Commands>
  </form>
</template>

<style scoped></style>
