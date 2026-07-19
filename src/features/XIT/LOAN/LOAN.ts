import LOAN from '@src/features/XIT/LOAN/LOAN.vue';

xit.add({
  command: ['LOAN', 'LOANS'],
  name: '贷款合同',
  description: '分类展示借入贷款和放出贷款合同。',
  contextItems: () => [{ cmd: 'XIT CONTS' }, { cmd: 'XIT CONTC' }, { cmd: 'CONTS' }],
  component: () => LOAN,
});
