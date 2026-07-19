import PMMG from '@src/features/XIT/SET/PMMG.vue';
import SET from '@src/features/XIT/SET/SET.vue';

xit.add({
  command: ['SET', 'SETTINGS'],
  name: 'REFINED PRUN 设置',
  description: 'Refined PrUn 设置。',
  optionalParameters: '设置选项卡标识符',
  component: parameters => {
    switch (parameters[0]?.toUpperCase()) {
      case 'PMMG':
        return PMMG;
      default:
        return SET;
    }
  },
});
