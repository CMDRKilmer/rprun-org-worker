import GenerateActDialog from '@src/features/XIT/BURN/GenerateActDialog.vue';

xit.add({
  command: 'BURNGEN',
  name: parameters => {
    if (parameters.length > 0) {
      return `生成 ACT 补充包 - ${parameters.join(' ')}`;
    }
    return '生成 ACT 补充包';
  },
  description: '为指定星球生成 ACT 补充包。',
  mandatoryParameters: '星球名称',
  component: () => GenerateActDialog,
  bufferSize: [500, 400],
});
