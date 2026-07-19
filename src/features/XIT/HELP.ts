import HELP from '@src/features/XIT/HELP.vue';

xit.add({
  command: 'HELP',
  name: '帮助',
  description: '开始使用 Refined PrUn 的有用信息。',
  optionalParameters: '操作',
  component: () => HELP,
});
