import HAUL from '@src/features/XIT/HAUL/HAUL.vue';

xit.add({
  command: ['HAUL', 'HAULS'],
  name: '运输合同',
  description: '分类展示承运和委托运输合同。',
  contextItems: () => [{ cmd: 'XIT CONTS' }, { cmd: 'XIT CONTC' }, { cmd: 'CONTS' }],
  component: () => HAUL,
});
