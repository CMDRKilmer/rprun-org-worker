import CONTC from '@src/features/XIT/CONTC/CONTC.vue';

xit.add({
  command: ['CONTC'],
  name: '待处理合同条件',
  description: '显示待处理的合同条件。',
  contextItems: () => [{ cmd: 'XIT CONTS' }, { cmd: 'CONTS' }, { cmd: 'CONTD' }],
  component: () => CONTC,
});
