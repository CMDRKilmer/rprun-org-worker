// 注册 XIT PLAN 命令。
import PLAN from '@src/features/XIT/PLAN/PLAN.vue';

xit.add({
  command: 'BPLAN',
  name: '基地规划',
  description: '模拟规划新基地的建筑布局和产线利润。',
  optionalParameters: '星球标识符',
  component: () => PLAN,
});
