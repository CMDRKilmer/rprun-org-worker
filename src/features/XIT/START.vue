<script setup lang="ts">
import PrunLink from '@src/components/PrunLink.vue';
import PrunButton from '@src/components/PrunButton.vue';
import { userData } from '@src/store/user-data';
import { saveUserData } from '@src/infrastructure/storage/user-data-serializer';

const needsToChoose = ref(userData.settings.mode === undefined);

function onBasicClick() {
  needsToChoose.value = false;
  userData.settings.mode = 'BASIC';
}

async function onFullClick() {
  needsToChoose.value = false;
  userData.settings.mode = 'FULL';
  await saveUserData();
  window.location.reload();
}
</script>

<template>
  <div :class="$style.container">
    <h1 :class="$style.title">感谢使用 Refined PrUn！</h1>
    <p>
      你可以通过
      <PrunLink inline command="XIT CMDS" />
      查看所有 XIT 命令列表
    </p>
    <p>
      你可以通过
      <PrunLink inline command="XIT SET" />
      更改设置
    </p>
    <p>
      获取更多帮助，请查看
      <PrunLink inline command="XIT HELP" />
    </p>
    <template v-if="needsToChoose">
      <p>
        请选择功能集（你可以稍后通过
        <PrunLink inline command="XIT SET FEAT" />
        更改）
      </p>
      <div :class="$style.features">
        <PrunButton primary :class="$style.feature" @click="onBasicClick">
          <div :class="$style.featureTitle">
            <div :class="$style.title">基础</div>
          </div>
          <div :class="$style.featureDescription">包含增强 APEX UI 的功能</div>
        </PrunButton>
        <PrunButton primary :class="$style.feature" @click="onFullClick">
          <div :class="$style.featureTitle">
            <div :class="$style.title">完整</div>
            <div>（需要重启）</div>
          </div>
          <div :class="$style.featureDescription">
            包含所有基础功能，以及面向资深玩家的额外 UI 优化
          </div>
        </PrunButton>
      </div>
    </template>
    <p v-else>
      你可以随时通过
      <PrunLink inline command="XIT SET FEAT" />
      更改功能集
    </p>
  </div>
</template>

<style module>
.container {
  font-size: 12px;
  padding-left: 4px;
}

.title {
  font-weight: bold;
  display: block;
  font-size: 16px;
}

.features {
  display: flex;
  flex-direction: row;
  justify-content: space-around;
}

.feature {
  width: 49%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4px;
  text-transform: none;
}

.featureTitle {
  display: flex;
  flex-direction: column;
  text-align: center;
}

.featureDescription {
  padding-top: 4px;
}
</style>
