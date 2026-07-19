import MATS from '@src/features/XIT/MATS.vue';

xit.add({
  command: 'MATS',
  name: '材料列表',
  description: '显示材料列表。',
  optionalParameters: '材料类别或代码',
  component: () => MATS,
});
