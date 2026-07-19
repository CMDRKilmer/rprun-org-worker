import './shortcuts';
import WEB from '@src/features/XIT/WEB/WEB.vue';

xit.add({
  command: 'WEB',
  name: '网页',
  description: '打开一个网页。',
  mandatoryParameters: '网页 URL',
  component: () => WEB,
});
