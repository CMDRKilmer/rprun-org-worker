<script setup lang="ts">
const model = defineModel<boolean>();

const $style = useCssModule();
const buttonClass = computed(() => ({
  [$style.expanded]: model.value,
}));
</script>

<template>
  <span :class="[$style.button, buttonClass]" @click="model = !model">▶</span>
</template>

<style module>
.button {
  display: inline-block;
  cursor: pointer;
  user-select: none;
  position: relative;
  transform: scale(0.7);
  transition: 0.1s ease-out;
}

.button::before {
  content: '';
  position: absolute;
  /* 增大可点击区域 */
  top: -5px;
  bottom: -5px;
  left: -5px;
  right: -5px;
  /* 不可见但扩展点击区域 */
  background: transparent;
  z-index: -1;
}

.expanded {
  transform: scale(0.7) rotate(90deg);
}
</style>
