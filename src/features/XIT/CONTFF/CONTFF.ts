import CONTFF from '@src/features/XIT/CONTFF/CONTFF.vue';

xit.add({
  command: ['CONTFF'],
  name: '派系合同',
  description: '仅显示派系/政府合同',
  contextItems: () => [{ cmd: 'XIT CONTS' }, { cmd: 'XIT CONTSS' }, { cmd: 'XIT CONTC' }],
  component: () => CONTFF,
});
