import DEV from '@src/features/XIT/DEV/DEV.vue';

xit.add({
  command: 'DEV',
  name: '开发菜单',
  description: '开发菜单。',
  component: () => DEV,
});
