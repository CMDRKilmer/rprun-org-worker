import CMDS from '@src/features/XIT/CMDS.vue';

xit.add({
  command: 'CMDS',
  name: 'XIT 命令列表',
  description: '可用的 XIT 命令列表。',
  component: () => CMDS,
});
