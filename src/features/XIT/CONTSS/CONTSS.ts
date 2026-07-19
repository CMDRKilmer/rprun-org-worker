import CONTSS from '@src/features/XIT/CONTSS/CONTSS.vue';

xit.add({
  command: ['CONTSS'],
  name: '合同总览(增强)',
  description: '增强版合同总览，显示待收款/应付款和进度。',
  contextItems: () => [{ cmd: 'XIT CONTS' }, { cmd: 'XIT CONTC' }],
  component: () => CONTSS,
});
