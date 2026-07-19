import GIF from '@src/features/XIT/GIF/GIF.vue';

xit.add({
  command: 'GIF',
  name: '随机 GIF',
  description: '显示随机 GIF 图片。',
  optionalParameters: 'GIF 类别',
  component: () => GIF,
});
