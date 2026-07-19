import CALC from '@src/features/XIT/CALC.vue';

xit.add({
  command: ['CALC', 'CALCULATOR'],
  name: '计算器',
  description: '提供游戏内计算器。',
  component: () => CALC,
  bufferSize: [275, 326],
});
