import FINPR from '@src/features/XIT/FIN/FINPR.vue';

xit.add({
  command: ['FINPR'],
  name: '盈利报告',
  description: '基地盈利报告。',
  contextItems: () => [
    { cmd: 'XIT FIN' },
    { cmd: 'XIT FINBS' },
    { cmd: 'XIT FINCH' },
    { cmd: 'XIT SET FIN' },
  ],
  component: () => FINPR,
});
