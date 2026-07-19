import HEALTH from '@src/features/XIT/HEALTH.vue';

xit.add({
  command: 'HEALTH',
  name: '数据健康',
  description: '显示已收集数据的统计信息。',
  component: () => HEALTH,
});
