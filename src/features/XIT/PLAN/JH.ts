// 注册 XIT JH 命令（基地计划列表）。
import JH from '@src/features/XIT/PLAN/JH.vue';

xit.add({
  command: 'JH',
  name: '基地计划列表',
  description: '管理已保存的基地规划方案。',
  component: () => JH,
});
