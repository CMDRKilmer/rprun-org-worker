<script setup lang="ts">
import ActionBar from '@src/components/ActionBar.vue';
import PrunButton from '@src/components/PrunButton.vue';
import SectionHeader from '@src/components/SectionHeader.vue';
import { userData } from '@src/store/user-data';
import removeArrayElement from '@src/utils/remove-array-element';
import { vDraggable } from 'vue-draggable-plus';
import TextInput from '@src/components/forms/TextInput.vue';
import { grip } from '@src/components/grip';
import GripCell from '@src/components/grip/GripCell.vue';
import GripHeaderCell from '@src/components/grip/GripHeaderCell.vue';
import Tooltip from '@src/components/Tooltip.vue';
import NumberInput from '@src/components/forms/NumberInput.vue';
import { objectId } from '@src/utils/object-id';
import InlineFlex from '@src/components/InlineFlex.vue';

const $style = useCssModule();

const picking = ref(false);

const overlay = useTemplateRef<HTMLElement>('overlay');

const pickedBuffer = ref(null as Element | null | undefined);

const overlayCursor = computed(() => (pickedBuffer.value ? 'pointer' : 'default'));

function onOverlayMouseMove(e: MouseEvent) {
  if (!picking.value) {
    return;
  }

  const lastPickedBuffer = pickedBuffer.value;
  pickedBuffer.value = getBufferUnderCursor(e);
  lastPickedBuffer?.classList.remove($style.highlight);
  pickedBuffer.value?.classList.add($style.highlight);
}

async function onOverlayMouseClick(e: MouseEvent) {
  const buffer = getBufferUnderCursor(e);
  pickedBuffer.value?.classList.remove($style.highlight);
  pickedBuffer.value = null;
  picking.value = false;
  if (!buffer) {
    return;
  }

  const cmd = await $(buffer, C.TileFrame.cmd);
  if (!cmd.textContent) {
    return;
  }

  const body = await $(buffer, C.Window.body);
  const width = parseInt(body.style.width.replace('px', ''), 10);
  const height = parseInt(body.style.height.replace('px', ''), 10);
  userData.settings.buffers.unshift([cmd.textContent, width, height]);
}

function getBufferUnderCursor(e: MouseEvent) {
  const element = getElementUnderCursor(e);
  if (!element) {
    return undefined;
  }
  const window = element.closest(`.${C.Window.window}`);
  if (!window) {
    return undefined;
  }

  const cmd = _$(window, C.TileFrame.cmd);
  if (!cmd) {
    return undefined;
  }

  return window;
}

function getElementUnderCursor(e: MouseEvent) {
  overlay.value!.style.pointerEvents = 'none';
  const element = document.elementFromPoint(e.clientX, e.clientY);
  overlay.value!.style.pointerEvents = 'all';
  return element;
}

function addNewRule() {
  userData.settings.buffers.unshift(['', 450, 300]);
}

function deleteRule(rule: [string, number, number]) {
  removeArrayElement(userData.settings.buffers, rule);
}
</script>

<template>
  <SectionHeader>
    覆盖默认缓冲区大小
    <Tooltip
      position="bottom"
      :class="$style.tooltip"
      tooltip="将使用第一个匹配的规则。如果没有规则匹配，将使用默认缓冲区大小。
        你可以通过拖拽来重新组织规则顺序。" />
  </SectionHeader>
  <ActionBar>
    <template v-if="picking">
      <PrunButton neutral>
        {{ pickedBuffer ? '点击选择此缓冲区' : '点击任意位置取消' }}
      </PrunButton>
    </template>
    <template v-else>
      <PrunButton primary @click="picking = true">选择缓冲区</PrunButton>
      <PrunButton primary @click="addNewRule">添加新规则</PrunButton>
    </template>
  </ActionBar>
  <table>
    <thead>
      <tr>
        <GripHeaderCell />
        <th>
          <InlineFlex>
            命令
            <Tooltip
              position="right"
              tooltip="可以是完整命令、部分命令或正则表达式。不区分大小写。" />
          </InlineFlex>
        </th>
        <th>宽度</th>
        <th>高度</th>
        <th />
      </tr>
    </thead>
    <tbody v-if="userData.settings.buffers.length === 0">
      <tr>
        <td colspan="5">还没有内容。</td>
      </tr>
    </tbody>
    <template v-else>
      <tbody v-draggable="[userData.settings.buffers, grip.draggable]">
        <tr v-for="rule in userData.settings.buffers" :key="objectId(rule)">
          <GripCell />
          <td :class="$style.commandCell">
            <div :class="[C.forms.input, $style.inline]">
              <TextInput v-model="rule[0]" />
            </div>
          </td>
          <td :class="$style.sizeCell">
            <div :class="[C.forms.input, $style.inline]">
              <NumberInput v-model="rule[1]" />
            </div>
          </td>
          <td :class="$style.sizeCell">
            <div :class="[C.forms.input, $style.inline]">
              <NumberInput v-model="rule[2]" />
            </div>
          </td>
          <td>
            <PrunButton danger @click="deleteRule(rule)">删除</PrunButton>
          </td>
        </tr>
      </tbody>
    </template>
  </table>
  <Teleport to="body">
    <div
      v-if="picking"
      ref="overlay"
      :class="$style.overlay"
      :style="{ cursor: overlayCursor }"
      @click="onOverlayMouseClick"
      @mousemove="onOverlayMouseMove" />
  </Teleport>
</template>

<style module>
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.2);
  z-index: 999999;
}

.highlight {
  z-index: 999998 !important;
}

.highlight:after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  background-color: rgba(63, 162, 222, 0.3);
  z-index: 999998;
}

.inline {
  display: inline-block;
}

.commandCell * {
  width: 100%;
}

.sizeCell {
  width: 60px;

  input {
    width: 60px;
    text-align: left;
  }
}

.tooltip {
  float: revert;
  font-size: 12px;
  margin-top: -4px;
}
</style>
