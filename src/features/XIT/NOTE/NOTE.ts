import NOTE from '@src/features/XIT/NOTE/NOTE.vue';

xit.add({
  command: ['NOTE', 'NOTES'],
  name: '笔记',
  description: '笔记工具。',
  optionalParameters: '笔记标识符或名称',
  component: () => NOTE,
});
