<script setup lang="ts">
import { castArray } from '@src/utils/cast-array';
import PrunLink from '@src/components/PrunLink.vue';
import { objectId } from '@src/utils/object-id';

const sorted = xit.registry.sort((a, b) => {
  const commandA = castArray(a.command)[0];
  const commandB = castArray(b.command)[0];
  return commandA.localeCompare(commandB);
});
</script>

<template>
  <table>
    <thead>
      <tr>
        <th>命令</th>
        <th>描述</th>
        <th>必选参数</th>
        <th>可选参数</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="command in sorted" :key="objectId(command)">
        <td>
          <PrunLink
            :command="'XIT ' + castArray(command.command)[0]"
            :auto-submit="!command.mandatoryParameters">
            {{ castArray(command.command)[0] }}
          </PrunLink>
        </td>
        <td>{{ command.description }}</td>
        <td>{{ command.mandatoryParameters }}</td>
        <td>{{ command.optionalParameters }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped></style>
