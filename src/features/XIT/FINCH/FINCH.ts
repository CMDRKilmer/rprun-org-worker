import FINCH from '@src/features/XIT/FINCH/FINCH.vue';

xit.add({
  command: ['FINCH'],
  name: '财务图表',
  description: '权益和资产的财务图表。',
  optionalParameters: '图表标识符',
  contextItems: () => [
    { cmd: 'XIT FIN' },
    { cmd: 'XIT FINBS' },
    { cmd: 'XIT FINPR' },
    { cmd: 'XIT SET FIN' },
  ],
  component: () => FINCH,
});
