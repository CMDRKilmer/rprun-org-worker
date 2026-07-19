import TODO from './TODO.vue';

xit.add({
  command: ['TODO'],
  name: '待办事项列表',
  description: '提供待办事项列表以组织你的计划。',
  optionalParameters: '列表标识符或名称',
  component: () => TODO,
});
