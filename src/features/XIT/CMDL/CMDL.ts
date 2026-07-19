import CMDL from '@src/features/XIT/CMDL/CMDL.vue';

xit.add({
  command: 'CMDL',
  name: '命令列表',
  description: '提供可自定义的命令链接列表。',
  optionalParameters: '列表标识符或名称',
  component: () => CMDL,
});
