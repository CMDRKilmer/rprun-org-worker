import CONTS from '@src/features/XIT/CONTS/CONTS.vue';

xit.add({
  command: ['CONTS', 'CONTRACTS'],
  name: '合同总览',
  description: '显示活跃合同。',
  contextItems: () => [{ cmd: 'XIT CONTC' }, { cmd: 'CONTS' }, { cmd: 'CONTD' }],
  component: () => CONTS,
});
