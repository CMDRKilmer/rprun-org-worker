<script setup lang="ts">
import SectionHeader from '@src/components/SectionHeader.vue';
import Active from '@src/components/forms/Active.vue';
import TextInput from '@src/components/forms/TextInput.vue';
import Commands from '@src/components/forms/Commands.vue';
import PrunButton from '@src/components/PrunButton.vue';
import RadioItem from '@src/components/forms/RadioItem.vue';
import { storagesStore } from '@src/infrastructure/prun-api/data/storage';
import { objectId } from '@src/utils/object-id';

const { onSave, sorting, storeId } = defineProps<{
  onSave: (sorting: UserData.SortingMode) => void;
  sorting?: UserData.SortingMode;
  storeId: string;
}>();

const storage = computed(() => storagesStore.getById(storeId));

const label = ref(sorting?.label ?? '');
const categories = ref(
  sorting?.categories.map(x => ({ name: x.name, materials: x.materials.join(', ') })) ?? [
    createCategory(),
  ],
);
const burn = ref(sorting?.burn ?? false);
const zero = ref(sorting?.zero ?? false);

const canRemoveCategory = computed(() => categories.value.length > 1);

function addCategory() {
  categories.value.push(createCategory());
}

function removeCategory() {
  if (canRemoveCategory.value) {
    categories.value.pop();
  }
}

function createCategory() {
  return { name: '', materials: '' };
}

const emit = defineEmits<{ (e: 'close'): void }>();

function onSaveClick() {
  if (!label.value) {
    return;
  }
  onSave({
    label: label.value,
    categories: categories.value.map(x => ({
      name: x.name,
      materials: x.materials.replaceAll(' ', '').split(','),
    })),
    burn: burn.value,
    zero: zero.value,
  });
  emit('close');
}
</script>

<template>
  <div :class="C.DraftConditionEditor.form">
    <SectionHeader>排序模式</SectionHeader>
    <form>
      <Active label="标签" tooltip="显示在库存顶部的标签 (ABC, CAT 等)。">
        <TextInput v-model="label" style="width: 80%" />
      </Active>
      <Active label="分类 1 名称" tooltip="第一个材料分类的名称。">
        <TextInput v-model="categories[0].name" style="width: 80%" />
      </Active>
      <Active label="分类 1 材料" tooltip="第一个分类中的材料列表。用逗号分隔代码 (RAT, DW 等)。">
        <TextInput v-model="categories[0].materials" style="width: 80%" />
      </Active>
      <template v-for="(category, i) in categories.slice(1)" :key="objectId(category)">
        <Active :label="`分类 ${i + 2} 名称`">
          <TextInput v-model="category.name" style="width: 80%" />
        </Active>
        <Active :label="`分类 ${i + 2} 材料`">
          <TextInput v-model="category.materials" style="width: 80%" />
        </Active>
      </template>
      <Active
        v-if="storage?.type === 'STORE'"
        label="消耗排序"
        tooltip="添加消耗排序作为二级排序方式。消耗分类将显示在上述分类下方。">
        <RadioItem v-model="burn">添加消耗排序</RadioItem>
      </Active>
      <Active label="显示零值" tooltip="显示数量为零的物品图标。">
        <RadioItem v-model="zero">显示零值</RadioItem>
      </Active>
      <Commands>
        <PrunButton primary @click="addCategory">添加分类</PrunButton>
        <PrunButton
          :primary="canRemoveCategory"
          :disabled="!canRemoveCategory"
          @click="removeCategory">
          删除分类
        </PrunButton>
        <PrunButton primary @click="onSaveClick">保存</PrunButton>
      </Commands>
    </form>
  </div>
</template>
